/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import {
  BTPErrorException,
  BTP_ERROR_RESOLVE_DNS,
  BTP_ERROR_UNSUPPORTED_ENCRYPT,
  BTP_ERROR_VALIDATION,
  transformToBTPErrorException,
} from '@core/error/index.js';
import { BtpsClient } from './btpsClient.js';
import type {
  BTPAgentOptions,
  BTPClientResponse,
  BtpsAgentCommandOptions,
  BtpsAgentCommandParams,
  BtpsAgentDoc,
} from './types/index.js';
import type {
  AgentActionRequiringDocument,
  BTPAgentArtifact,
  BTPArtifactType,
  BTPDocType,
  BTPTransporterArtifact,
  BTPIdentityResDoc,
  AgentAction,
  BTPAgentDocument,
} from 'server/index.js';
import type {
  BTPCryptoArtifact,
  BTPCryptoResponse,
  BTPDecryptionKey,
  BTPEncryption,
  BTPSigningKey,
} from '@core/crypto/types.js';
import { BtpsAgentCommandCallSchema } from './libs/schema.js';
import { BtpLifecycleEventSchema } from '@core/server/schemas/btpsDocsSchema.js';
import { validate } from '@core/utils/validation.js';
import {
  AGENT_ACTIONS_REQUIRING_DOCUMENT,
  AGENT_TRANSPORTER_ACTIONS,
} from '@core/server/constants/index.js';
import { encryptBtpPayload, signBtpPayload, signBtpPayloadWithSigner } from '@core/crypto/index.js';
import { randomUUID } from 'crypto';
import { isValidIdentity } from '@core/utils/index.js';

const mappedTransporterAction = AGENT_TRANSPORTER_ACTIONS;

export class BtpsAgent extends BtpsClient {
  private agentId: string;
  private readonly signingKey: BTPSigningKey;
  private readonly decryptionKey?: BTPDecryptionKey;

  constructor(agentOptions: BTPAgentOptions) {
    const { agent, btpIdentity, ...restOptions } = agentOptions;
    super({
      to: btpIdentity,
      ...restOptions,
    });

    if ('signer' in agent) {
      this.signingKey = agent.signer;
      this.decryptionKey = agent.decrypter;
    } else {
      this.signingKey = {
        publicKey: agent.identityCert,
        privateKey: agent.identityKey,
      };
      this.decryptionKey = agent.identityKey;
    }

    this.agentId = agent.id;

    const hasKey =
      'signer' in agent ? Boolean(agent.signer) : Boolean(agent.identityKey && agent.identityCert);
    if (!agent.id || !hasKey || !btpIdentity || !isValidIdentity(btpIdentity)) {
      throw new BTPErrorException({ message: 'Invalid agent or btpIdentity' });
    }
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
        return await this.buildClientErrorResponse(
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
        return await this.buildClientErrorResponse(transporterError);
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
    agentArtifact.id = randomUUID();
    agentArtifact.issuedAt = new Date().toISOString();
    agentArtifact.version = this.getProtocolVersion();

    try {
      const signature =
        'sign' in this.signingKey
          ? await signBtpPayloadWithSigner(agentArtifact, this.signingKey)
          : signBtpPayload(agentArtifact, this.signingKey);
      agentArtifact.signature = signature;

      return {
        payload: agentArtifact as BTPCryptoArtifact<BTPDocType>,
        error: undefined,
      };
    } catch (error) {
      return await this.buildClientErrorResponse(transformToBTPErrorException(error));
    }
  }

  protected async buildTransportArtifact(
    commandParams: BtpsAgentCommandParams,
  ): Promise<BTPCryptoResponse<BTPDocType>> {
    const { document, actionType, to, options } = commandParams;

    // Document validation is already handled by schema validation above
    // This check is redundant but kept for clarity
    if (!document) {
      return await this.buildClientErrorResponse(
        new BTPErrorException(BTP_ERROR_VALIDATION, {
          cause: `Document is required for ${actionType}`,
        }),
      );
    }
    // Get the selector for the to identity
    const receiverDnsTxt = options?.encryption
      ? (await this.resolveIdentity(to, this.options.to, this.decryptionKey)).response
      : await this.resolveBtpsHostDnsTxt(to);

    if (!receiverDnsTxt) {
      return await this.buildClientErrorResponse(
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
        return await this.buildClientErrorResponse(
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

    // An event travels in an artifact with the event's own id.
    const event =
      artifactType === 'BTPS_EVENT' ? BtpLifecycleEventSchema.safeParse(document) : undefined;

    // An artifact names the sender's own selector, the one its key is published at.
    const senderSelector = (await this.resolveBtpsHostDnsTxt(this.options.to))?.selector;
    if (!senderSelector) {
      return await this.buildClientErrorResponse(
        new BTPErrorException(BTP_ERROR_RESOLVE_DNS, {
          cause: `Could not resolve the selector of ${this.options.to}`,
        }),
      );
    }

    const transporterArtifact: Omit<BTPTransporterArtifact, 'signature'> = {
      id: event?.success ? event.data.id : randomUUID(),
      issuedAt: new Date().toISOString(),
      version: this.getProtocolVersion(),
      type: artifactType,
      document: encryptedDocument as BTPDocType | string,
      from: this.options.to,
      to: to,
      selector: senderSelector,
      encryption: encryption,
      ...(options?.relatesTo !== undefined && { relatesTo: options.relatesTo }),
    };

    try {
      const signature =
        'sign' in this.signingKey
          ? await signBtpPayloadWithSigner(transporterArtifact, this.signingKey)
          : signBtpPayload(transporterArtifact, this.signingKey);

      return {
        payload: {
          ...transporterArtifact,
          signature,
        } as BTPCryptoArtifact<BTPDocType>,
        error: undefined,
      };
    } catch (error) {
      return this.buildClientErrorResponse(error as BTPErrorException);
    }
  }

  async command(
    actionType: AgentAction,
    identity: string,
    document?: BtpsAgentDoc,
    options?: BtpsAgentCommandOptions,
    timeoutMs?: number,
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

      return await this.buildClientErrorResponse(
        new BTPErrorException(BTP_ERROR_VALIDATION, {
          cause: `Command validation failed: ${errorDetails}`,
          meta: { validationErrors: validationResult.error.issues },
        }),
      );
    }

    const { payload, error } = await this.getAgentArtifact(commandParams);
    if (error) {
      return await this.buildClientErrorResponse(error);
    }

    return this.send(payload as BTPAgentArtifact, timeoutMs);
  }

  destroy(soft: boolean = false) {
    if (soft) {
      super.end();
    } else {
      super.destroy();
    }
  }
}
