/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { randomUUID } from 'crypto';
import { BTP_ERROR_IDENTITY, BTP_ERROR_RESOLVE_PUBKEY } from '@core/error/constant.js';
import { signBtpPayload, encryptBtpPayload } from './index.js';
import {
  BTPCryptoResponse,
  PemKeys,
  BTPCryptoOptions,
  BTPSignature,
  BTPEncryption,
  BTPCryptoArtifact,
} from './types.js';
import { parseIdentity, resolvePublicKey } from '@core/utils/index.js';
import { ParsedIdentity } from '@core/utils/types.js';
import { BTPErrorException } from '@core/error/index.js';
import isEmpty from 'lodash/isEmpty.js';

const genEncryptError = (error: BTPErrorException) => ({
  payload: undefined,
  error,
});

export const signEncrypt = async <T = unknown>(
  to: string | undefined,
  sender: ParsedIdentity & { pemFiles: PemKeys },
  payload: {
    document: T;
    selector?: string;
    [key: string]: unknown;
  },
  options?: BTPCryptoOptions,
): Promise<BTPCryptoResponse<T>> => {
  const { document, ...restPayload } = payload;
  let encryption: BTPEncryption | null = null;
  let encryptedDoc: string | T = document;

  if (to && payload.selector) {
    const parsedReceiver = parseIdentity(to);
    if (!parsedReceiver) return genEncryptError(new BTPErrorException(BTP_ERROR_IDENTITY));
    const receiverPubPem = await resolvePublicKey(to, payload.selector);
    if (!receiverPubPem) return genEncryptError(new BTPErrorException(BTP_ERROR_RESOLVE_PUBKEY));

    try {
      const encryptedData = isEmpty(options?.encryption)
        ? { encryption: null, data: encryptedDoc }
        : encryptBtpPayload(encryptedDoc, receiverPubPem, options?.encryption);

      encryption = encryptedData.encryption;
      encryptedDoc = encryptedData.data;
    } catch (error) {
      return genEncryptError(error as BTPErrorException);
    }
  }

  const docToSign: Record<string, unknown> = {
    ...restPayload,
    id: restPayload?.id ?? randomUUID(),
    issuedAt: restPayload?.issuedAt ?? new Date().toISOString(),
    document: encryption ? (encryptedDoc as string) : (document as T),
    encryption: encryption,
  };

  let signature: BTPSignature;
  try {
    signature = signBtpPayload(docToSign, sender.pemFiles);
  } catch (error) {
    return genEncryptError(error as BTPErrorException);
  }

  return {
    payload: {
      ...docToSign,
      signature,
    } as BTPCryptoArtifact<T>,
    error: undefined,
  };
};
