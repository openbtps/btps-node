/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { BTPErrorException, transformToBTPErrorException } from '@core/error/index.js';
import { validate } from '@core/utils/validation.js';
import type { BTPArtifactType, BTPDocType, BTPTransporterArtifact } from '@core/server/types.js';
import { BtpsClient } from './btpsClient.js';
import type { BTPClientResponse, BtpsClientOptions } from './types/index.js';
import { BTPCryptoResponse } from '@core/crypto/types.js';
import { BtpDocSchema } from '@core/server/schemas/btpsDocsSchema.js';
import { BtpTransporterArtifactSchema } from '@core/server/schemas/artifacts/transporterSchema.js';

export class BtpsTransporter extends BtpsClient {
  constructor(options: BtpsClientOptions) {
    super(options);
  }

  async transport(artifact: BTPTransporterArtifact): Promise<BTPClientResponse> {
    const validationResult = validate(BtpTransporterArtifactSchema, artifact);
    if (!validationResult.success) {
      return this.buildClientErrorResponse(
        new BTPErrorException(
          { message: 'Invalid artifact' },
          { cause: { validationZodError: validationResult.error }, meta: { artifact } },
        ),
      );
    }

    try {
      return await new Promise<BTPClientResponse>((resolve) => {
        let messageReceived = false;
        this.connect(artifact.to, (events) => {
          events.on('connected', async () => {
            this.sendArtifact(artifact);
          });

          events.on('message', (msg) => {
            messageReceived = true;
            resolve({ response: msg, error: undefined });
          });

          events.on('error', (errors) => {
            const { error, ...restErrors } = errors;
            // Only resolve if no message received and no more retries
            if (restErrors.willRetry) {
              console.log(
                `[BtpsClient]:: Retrying...for...${artifact.to}`,
                JSON.stringify(errors, null, 2),
              );
            }
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
    } catch (err: unknown) {
      return { response: undefined, error: transformToBTPErrorException(err) };
    }
  }

  async signEncrypt(payload: {
    to: string;
    document: BTPDocType;
    type: BTPArtifactType;
  }): Promise<BTPCryptoResponse> {
    const validationResult = validate(BtpDocSchema, payload.document);
    if (!validationResult.success) {
      return this.buildClientErrorResponse(
        new BTPErrorException(
          { message: 'Invalid artifact' },
          { cause: { validationZodError: validationResult.error }, meta: { payload } },
        ),
      );
    }
    const preDocToSign: Record<string, unknown> = {
      ...payload,
      version: this.getProtocolVersion(),
      from: this.options.identity,
    };

    return this.signEncryptArtifact(preDocToSign);
  }
}
