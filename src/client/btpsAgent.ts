/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import {
  BTPErrorException,
  BTP_ERROR_RESOLVE_DNS,
  BTP_ERROR_RESOLVE_PUBKEY,
  BTP_ERROR_UNSUPPORTED_ENCRYPT,
  BTP_ERROR_VALIDATION,
  transformToBTPErrorException,
} from '@core/error/index.js';
import { BtpsClient } from './btpsClient.js';
import type {
  BTPClientResponse,
  BtpsAgentCommandParams,
  BtpsAgentDoc,
  BtpsClientOptions,
} from './types/index.js';
import type {
  AgentActionRequiringDocument,
  BTPAgentArtifact,
  BTPArtifactType,
  BTPDocType,
  BTPTransporterArtifact,
  BTPIdentityResDoc,
  BTPServerResponse,
  AgentAction,
  BTPAgentDocument,
} from 'server/index.js';
import type {
  BTPCryptoArtifact,
  BTPCryptoOptions,
  BTPCryptoResponse,
  BTPEncryption,
  VerifyEncryptedPayload,
} from '@core/crypto/types.js';
import { BtpsAgentCommandCallSchema } from './libs/schema.js';
import { validate } from '@core/utils/validation.js';
import { AGENT_ACTIONS_REQUIRING_DOCUMENT } from '@core/server/constants/index.js';
import EventEmitter from 'events';
import { encryptBtpPayload, signBtpPayload } from '@core/crypto/index.js';
import { randomUUID } from 'crypto';

const mappedTransporterAction = {
  'trust.request': 'TRUST_REQ',
  'trust.respond': 'TRUST_RES',
  'trust.update': 'TRUST_RES',
  'trust.delete': 'TRUST_RES',
  'artifact.send': 'BTPS_DOC',
};

export class BtpsAgent {
  private agentId: string;
  private readonly client: BtpsClient;
  private readonly clientOptions: BtpsClientOptions;
  private queue: Map<
    string,
    {
      commandParams: BtpsAgentCommandParams;
      emitter: EventEmitter;
    }
  > = new Map();

  constructor(
    options: BtpsClientOptions & {
      agentId: string;
    },
  ) {
    const { agentId, ...clientOptions } = options;
    this.agentId = agentId;
    this.clientOptions = clientOptions;
    this.client = new BtpsClient(this.clientOptions);
  }

  protected async getAgentArtifact(
    commandParams: BtpsAgentCommandParams,
  ): Promise<BTPCryptoResponse<BTPDocType>> {
    const { actionType, options, document: providedDocument } = commandParams;
    const agentArtifact: Partial<BTPAgentArtifact> = {
      action: actionType,
      agentId: this.agentId,
      to: commandParams.to,
    };

    const documentRequired = AGENT_ACTIONS_REQUIRING_DOCUMENT.includes(
      commandParams.actionType as AgentActionRequiringDocument,
    );

    if (documentRequired) {
      if (!providedDocument) {
        return await this.client.buildClientErrorResponse(
          new BTPErrorException(BTP_ERROR_VALIDATION, {
            cause: `Document is required for ${commandParams.actionType}`,
          }),
        );
      }
    }
    // If document is provided, add it to the agent artifact
    if (providedDocument) {
      agentArtifact.document = providedDocument as BTPAgentDocument;
    }

    const needForTransport = Object.keys(mappedTransporterAction).includes(actionType);
    if (needForTransport) {
      const { payload: transporterPayload, error: transporterError } =
        await this.buildTransportArtifact({
          ...commandParams,
          to: commandParams.to,
        });

      if (transporterError) {
        return await this.client.buildClientErrorResponse(transporterError);
      }
      if (transporterPayload) {
        agentArtifact.document = transporterPayload as BTPTransporterArtifact;
      }
    }

    const cryptoOptions = options ? { ...options } : undefined;
    /* If the action is auth.request, we don't need to encrypt the document as its authentication request */
    if (cryptoOptions && actionType === 'auth.request') {
      delete cryptoOptions.encryption;
    }

    agentArtifact.encryption = null;
    agentArtifact.id = crypto.randomUUID();
    agentArtifact.issuedAt = new Date().toISOString();
    agentArtifact.version = this.client.getProtocolVersion();

    try {
      const signature = signBtpPayload(agentArtifact, {
        publicKey: this.clientOptions.bptIdentityCert,
        privateKey: this.clientOptions.btpIdentityKey,
      });
      agentArtifact.signature = signature;

      return {
        payload: agentArtifact as BTPCryptoArtifact<BTPDocType>,
        error: undefined,
      };
    } catch (error) {
      return await this.client.buildClientErrorResponse(transformToBTPErrorException(error));
    }
  }

  protected async buildTransportArtifact(
    commandParams: BtpsAgentCommandParams,
  ): Promise<BTPCryptoResponse<BTPDocType>> {
    const { document, actionType, to, options } = commandParams;

    // Document validation is already handled by schema validation above
    // This check is redundant but kept for clarity
    if (!document) {
      return await this.client.buildClientErrorResponse(
        new BTPErrorException(BTP_ERROR_VALIDATION, {
          cause: `Document is required for ${actionType}`,
        }),
      );
    }
    // Get the selector for the to identity
    const receiverDnsTxt = options?.encryption
      ? (await this.client.resolveIdentity(to, this.clientOptions.identity)).response
      : await this.client.resolveBtpsHostDnsTxt(to);

    if (!receiverDnsTxt) {
      return await this.client.buildClientErrorResponse(
        new BTPErrorException(BTP_ERROR_RESOLVE_DNS, {
          cause: options?.encryption
            ? `Could not resolve identity or host and selector for: ${to}`
            : `Could not resolve host and selector for: ${to}`,
        }),
      );
    }

    let encryptedDocument: BtpsAgentDoc | string = document;
    let encryption: BTPEncryption | null = null;

    if (options?.encryption) {
      const { publicKey } = receiverDnsTxt as BTPIdentityResDoc & {
        hostname: string;
        port: number;
        version: string;
      };
      try {
        const { data, encryption: encryptionInfo } = encryptBtpPayload(
          document,
          publicKey,
          options.encryption,
        );
        encryptedDocument = data;
        encryption = encryptionInfo;
      } catch (error) {
        return await this.client.buildClientErrorResponse(
          new BTPErrorException(BTP_ERROR_UNSUPPORTED_ENCRYPT, {
            cause: `Failed to encrypt document for ${to}`,
            meta: {
              error: error,
            },
          }),
        );
      }
    }

    const artifactType = mappedTransporterAction[
      actionType as keyof typeof mappedTransporterAction
    ] as BTPArtifactType;

    const transporterArtifact: Omit<BTPTransporterArtifact, 'signature'> = {
      id: crypto.randomUUID(),
      issuedAt: new Date().toISOString(),
      version: this.client.getProtocolVersion(),
      type: artifactType,
      document: encryptedDocument as BTPDocType | string,
      from: this.agentId,
      to: this.clientOptions.identity,
      selector: receiverDnsTxt.selector,
      encryption: encryption,
    };

    try {
      const signature = signBtpPayload(transporterArtifact, {
        publicKey: this.clientOptions.bptIdentityCert,
        privateKey: this.clientOptions.btpIdentityKey,
      });

      return {
        payload: {
          ...transporterArtifact,
          signature,
        } as BTPCryptoArtifact<BTPDocType>,
        error: undefined,
      };
    } catch (error) {
      return this.client.buildClientErrorResponse(error as BTPErrorException);
    }
  }

  protected async processMessage(msg: BTPServerResponse): Promise<BTPClientResponse> {
    const { signature, signedBy, selector } = msg;
    /* If the message is not signed and also not encrypted, no need to decrypt and verify as it is system message */
    if (!msg.signature && !msg.encryption) {
      return {
        response: msg,
        error: undefined,
      };
    }

    if (signature && signedBy && selector) {
      const { response, error } = await this.client.resolveIdentity(
        signedBy,
        this.clientOptions.identity,
      );
      if (error) {
        return await this.client.buildClientErrorResponse(error);
      }

      const { publicKey: senderPubPem } = response;

      if (!senderPubPem) {
        return await this.client.buildClientErrorResponse(
          new BTPErrorException(BTP_ERROR_RESOLVE_PUBKEY, {
            cause: `SignedBy is present but public key is not found for identity: ${signedBy} and selector: ${selector}`,
            meta: msg,
          }),
        );
      }

      const encryptedPayload = {
        ...msg,
        encryption: msg?.encryption ?? null,
      } as VerifyEncryptedPayload<BTPServerResponse>;
      const { payload: decryptedPayload, error: decryptError } =
        await this.client.decryptVerifyArtifact(encryptedPayload, senderPubPem);

      if (decryptError) {
        return await this.client.buildClientErrorResponse(decryptError);
      }

      return {
        response: decryptedPayload as BTPServerResponse,
        error: undefined,
      };
    }

    return await this.client.buildClientErrorResponse(
      new BTPErrorException(BTP_ERROR_VALIDATION, {
        cause: 'Message is either not signed or does not have signedBy',
        meta: msg,
      }),
    );
  }

  protected resolveOnMessageQueue(
    response: BTPClientResponse,
    queueId?: string,
  ): Promise<BTPClientResponse> {
    return new Promise((resolve) => {
      if (queueId && this.queue.has(queueId)) {
        this.queue.get(queueId)?.emitter.emit('processed', response);
        this.removeQueue(queueId);
      }
      resolve(response);
    });
  }

  protected resolveOnErrorQueue(response: BTPClientResponse): Promise<BTPClientResponse> {
    return new Promise((resolve) => {
      const queues = Array.from(this.queue.entries());
      for (const [queueId, { emitter }] of queues) {
        emitter.emit('processed', response);
        this.removeQueue(queueId);
      }
      resolve(response);
    });
  }

  protected async processQueue(queueId: string) {
    const queue = this.queue.get(queueId);
    if (!queue) return;
    const { commandParams, emitter } = queue;
    const { payload, error } = await this.getAgentArtifact(commandParams);
    if (error) {
      emitter.emit('processed', { response: undefined, error });
      return;
    }

    if (payload) {
      this.client.sendArtifact(payload as BTPAgentArtifact);
    }
  }

  protected removeAllQueues() {
    const queues = Array.from(this.queue.entries());
    for (const [queueId, { emitter }] of queues) {
      emitter.removeAllListeners();
      this.queue.delete(queueId);
    }
  }

  protected removeQueue(queueId: string) {
    if (queueId) {
      const queue = this.queue.get(queueId);
      if (!queue) return;
      const { emitter } = queue;
      emitter.removeAllListeners();
      this.queue.delete(queueId);
    }
  }

  async command(
    actionType: AgentAction,
    identity: string,
    document?: BtpsAgentDoc,
    options?: BTPCryptoOptions,
  ): Promise<BTPClientResponse> {
    // Validate command parameters using schema

    const commandParams: BtpsAgentCommandParams = {
      actionType: actionType,
      document,
      to: identity,
      options,
    };
    const validationResult = validate(BtpsAgentCommandCallSchema, commandParams);
    if (!validationResult.success) {
      const errorDetails = validationResult.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(', ');

      return await this.client.buildClientErrorResponse(
        new BTPErrorException(BTP_ERROR_VALIDATION, {
          cause: `Command validation failed: ${errorDetails}`,
          meta: { validationErrors: validationResult.error.issues },
        }),
      );
    }

    const states = this.client.getConnectionStates();
    if (states.isConnecting || states.isConnected) {
      const queueId = randomUUID();
      this.queue.set(queueId, { commandParams, emitter: new EventEmitter() });
      try {
        return await new Promise<BTPClientResponse>((resolve) => {
          this.queue.get(queueId)?.emitter.on('processed', (response) => {
            resolve(response);
            return;
          });
        });
      } catch (error) {
        return await this.client.buildClientErrorResponse(transformToBTPErrorException(error));
      }
    }

    try {
      return await new Promise<BTPClientResponse>((resolve) => {
        let messageReceived = false;
        let currentQueueId: string | undefined = undefined;
        this.client.connect(this.clientOptions.identity, (events) => {
          events.on('connected', async () => {
            const { payload, error } = await this.getAgentArtifact(commandParams);
            if (error) {
              resolve(await this.client.buildClientErrorResponse(error));
              return;
            }
            this.client.sendArtifact(payload as BTPAgentArtifact);
          });

          events.on('message', async (msg) => {
            messageReceived = true;
            const processedResponse = await this.processMessage(msg);
            // console.log('processedResponse', processedResponse, currentQueueId);
            resolve(this.resolveOnMessageQueue(processedResponse, currentQueueId));

            const firstQueueId = this.queue.keys().next().value;
            if (firstQueueId) {
              currentQueueId = firstQueueId;
              if (this.queue.has(firstQueueId)) {
                messageReceived = false;
                this.processQueue(firstQueueId);
              }
            } else {
              // If there are no more queues, destroy the client
              this.destroy(false);
            }
          });

          events.on('error', async (errors) => {
            const { error, ...restErrors } = errors;
            if (!messageReceived && !restErrors.willRetry) {
              const response = await this.client.buildClientErrorResponse(
                transformToBTPErrorException(error),
              );

              resolve(this.resolveOnErrorQueue(response));
            }
          });

          events.on('end', async ({ willRetry }) => {
            if (!messageReceived && !willRetry) {
              const response = await this.client.buildClientErrorResponse(
                new BTPErrorException({
                  message: 'Connection ended before message was received',
                }),
              );

              resolve(this.resolveOnErrorQueue(response));
            }
          });
        });
      });
    } catch (error) {
      return await this.client.buildClientErrorResponse(transformToBTPErrorException(error));
    }
  }

  destroy(soft: boolean = false) {
    if (soft) {
      this.client.end();
    } else {
      this.client.destroy();
    }
    this.removeAllQueues();
  }
}
