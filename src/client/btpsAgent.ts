/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import {
  BTPErrorException,
  BTP_ERROR_VALIDATION,
  transformToBTPErrorException,
} from '@core/error/index.js';
import { BtpsClient } from './btpsClient.js';
import { BTPClientResponse, BtpsClientOptions } from './types/index.js';
import {
  AgentAction,
  AgentActionRequiringDocument,
  BTPAgentArtifact,
  BTPIdsPayload,
  BTPAgentMutation,
  BTPAgentQuery,
  BTPArtifactType,
  BTPAuthReqDoc,
  BTPDocType,
  BTPServerResponse,
  BTPTransporterArtifact,
} from 'server/index.js';
import {
  BTPCryptoArtifact,
  BTPCryptoOptions,
  BTPCryptoResponse,
  VerifyEncryptedPayload,
} from '@core/crypto/types.js';
import { BtpsAgentCommandCallSchema } from './libs/schema.js';
import { validate } from '@core/utils/validation.js';
import { AGENT_ACTIONS_REQUIRING_DOCUMENT } from '@core/server/constants/index.js';
import { resolvePublicKey } from '@core/utils/index.js';
const mappedTransporterAction = {
  'trust.request': 'TRUST_REQ',
  'trust.respond': 'TRUST_RES',
  'trust.update': 'TRUST_RES',
  'trust.delete': 'TRUST_RES',
  'artifact.send': 'BTPS_DOC',
};

export class BtpsAgent extends BtpsClient {
  private agentId: string;

  constructor(
    options: BtpsClientOptions & {
      agentId: string;
    },
  ) {
    super(options);
    this.agentId = options.agentId;
  }

  private async signEncryptTransportArtifact(
    payload: {
      to: string;
      document: BTPDocType | BTPAuthReqDoc | BTPAgentMutation | BTPIdsPayload | BTPAgentQuery;
      actionType: AgentAction;
      from: string;
    },
    options?: BTPCryptoOptions,
  ): Promise<BTPCryptoResponse<BTPDocType | BTPAuthReqDoc>> {
    const artifactType = mappedTransporterAction[
      payload.actionType as keyof typeof mappedTransporterAction
    ] as BTPArtifactType;

    const transporterArtifact: Omit<
      BTPTransporterArtifact,
      'signature' | 'encryption' | 'issuedAt' | 'id'
    > = {
      version: this.getProtocolVersion(),
      type: artifactType,
      document: payload.document as BTPDocType,
      from: payload.from as string,
      to: payload.to,
    };

    const { payload: transporterPayload, error: transporterError } = await this.signEncryptArtifact(
      transporterArtifact,
      options,
    );

    if (transporterError) {
      return this.buildClientErrorResponse(transporterError);
    }

    return {
      payload: transporterPayload as BTPCryptoArtifact<BTPDocType>,
      error: undefined,
    };
  }

  public async command(
    actionType: AgentAction,
    to: string,
    document?: BTPDocType | BTPAuthReqDoc | BTPAgentMutation | BTPIdsPayload | BTPAgentQuery,
    options?: BTPCryptoOptions,
  ): Promise<BTPClientResponse> {
    // Validate command parameters using schema
    const commandParams = {
      actionType,
      to,
      document,
      options,
    };

    const validationResult = validate(BtpsAgentCommandCallSchema, commandParams);
    if (!validationResult.success) {
      const errorDetails = validationResult.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(', ');

      return this.buildClientErrorResponse(
        new BTPErrorException(BTP_ERROR_VALIDATION, {
          cause: `Command validation failed: ${errorDetails}`,
          meta: { validationErrors: validationResult.error.issues },
        }),
      );
    }

    try {
      return await new Promise<BTPClientResponse>((resolve) => {
        let messageReceived = false;
        this.connect(this.options.identity, (events) => {
          events.on('connected', async () => {
            const agentArtifact: Record<string, unknown> = {
              action: actionType,
              agentId: this.agentId,
              to,
            };

            const needForTransport = Object.keys(mappedTransporterAction).includes(actionType);

            if (needForTransport) {
              // Document validation is already handled by schema validation above
              // This check is redundant but kept for clarity
              if (!document) {
                resolve(
                  await this.buildClientErrorResponse(
                    new BTPErrorException(BTP_ERROR_VALIDATION, {
                      cause: `Document is required for ${actionType}`,
                    }),
                  ),
                );
                return;
              }

              const { payload: transporterPayload, error: transporterError } =
                await this.signEncryptTransportArtifact(
                  { to, document, actionType, from: this.options.identity as string },
                  options,
                );

              if (transporterError) {
                resolve(await this.buildClientErrorResponse(transporterError));
                return;
              }

              agentArtifact.document = transporterPayload;
            }

            const documentRequired = AGENT_ACTIONS_REQUIRING_DOCUMENT.includes(
              actionType as AgentActionRequiringDocument,
            );
            if (documentRequired) {
              if (!document) {
                resolve(
                  await this.buildClientErrorResponse(
                    new BTPErrorException(BTP_ERROR_VALIDATION, {
                      cause: `Document is required for ${actionType}`,
                    }),
                  ),
                );
                return;
              }
            }
            // If document is provided, add it to the agent artifact
            if (document) {
              agentArtifact.document = document;
            }

            const cryptoOptions = options ? { ...options } : undefined;
            if (cryptoOptions && actionType === 'auth.request') {
              delete cryptoOptions.encryption;
            }

            const { payload: agentPayload, error: agentError } = await this.signEncryptArtifact(
              agentArtifact,
              cryptoOptions,
            );

            if (agentError) {
              resolve(await this.buildClientErrorResponse(agentError));
              return;
            }

            this.sendArtifact(agentPayload as unknown as BTPAgentArtifact);
          });

          events.on('message', async (msg) => {
            messageReceived = true;
            const { signature, signedBy } = msg;
            /* If the message is not signed and also not encrypted, no need to decrypt and verify as it is system message */
            if (!msg.signature && !msg.encryption) {
              resolve({ response: msg, error: undefined });
              return;
            }

            if (signature && signedBy) {
              const senderPubPem = await resolvePublicKey(signedBy);
              if (!senderPubPem) {
                resolve(
                  this.buildClientErrorResponse(
                    new BTPErrorException(BTP_ERROR_VALIDATION, {
                      cause: 'SignedBy is present but public key is not found',
                      meta: msg,
                    }),
                  ),
                );
                return;
              }

              const encryptedPayload = {
                ...msg,
                encryption: msg?.encryption ?? null,
              } as VerifyEncryptedPayload<BTPServerResponse>;
              const { payload: decryptedPayload, error: decryptError } =
                await this.decryptVerifyArtifact(encryptedPayload, senderPubPem);

              if (decryptError) {
                resolve(this.buildClientErrorResponse(decryptError));
                return;
              }

              resolve({ response: decryptedPayload as BTPServerResponse, error: undefined });
              return;
            }

            resolve({
              response: undefined,
              error: new BTPErrorException(BTP_ERROR_VALIDATION, {
                cause: 'Message is not signed',
                meta: msg,
              }),
            });
          });

          events.on('error', (errors) => {
            const { error, ...restErrors } = errors;
            if (!messageReceived && !restErrors.willRetry) {
              const btpError = new BTPErrorException(error, { cause: restErrors });
              resolve(this.buildClientErrorResponse(btpError));
            }
            // If willRetry is true, don't resolve - let retry logic handle it
          });

          events.on('end', ({ willRetry }) => {
            if (!messageReceived && !willRetry) {
              resolve(
                this.buildClientErrorResponse(
                  new BTPErrorException({
                    message: 'Connection ended before message was received',
                  }),
                ),
              );
            }
            // If willRetry is true, don't resolve - let retry logic handle it
          });
        });
      });
    } catch (error) {
      return this.buildClientErrorResponse(transformToBTPErrorException(error));
    }
  }
}
