/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { randomUUID } from 'crypto';
import {
  BTP_ERROR_IDENTITY,
  BTP_ERROR_RESOLVE_PUBKEY,
  BTP_ERROR_VALIDATION,
} from '@core/error/constant.js';
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

/**
 * Signs a payload with the sender's key and, when `to` and
 * `payload.encryptionSelector` are given, encrypts its document to the
 * receiver's key at that selector.
 *
 * The signed artifact names both keys apart: `signatureSelector` is
 * `sender.selector`, the sender key in `sender.pemFiles`; `encryptionSelector`
 * is the receiver key, and is present only when the document is encrypted.
 */
export const signEncrypt = async <T = unknown>(
  to: string | undefined,
  sender: ParsedIdentity & { pemFiles: PemKeys; selector: string },
  payload: {
    document: T;
    encryptionSelector?: string;
    [key: string]: unknown;
  },
  options?: BTPCryptoOptions,
): Promise<BTPCryptoResponse<T>> => {
  const { document, encryptionSelector, ...restPayload } = payload;
  let encryption: BTPEncryption | null = null;
  let encryptedDoc: string | T = document;

  if ('selector' in restPayload) {
    return genEncryptError(
      new BTPErrorException(BTP_ERROR_VALIDATION, {
        cause:
          'selector is not part of BTPS 1.1: pass encryptionSelector for the receiver key, and sender.selector for the signing key',
      }),
    );
  }
  if (!sender.selector) {
    return genEncryptError(
      new BTPErrorException(BTP_ERROR_VALIDATION, {
        cause: 'sender.selector is required: it names the key that signs the artifact',
      }),
    );
  }

  if (to && encryptionSelector) {
    const parsedReceiver = parseIdentity(to);
    if (!parsedReceiver) return genEncryptError(new BTPErrorException(BTP_ERROR_IDENTITY));
    const receiverPubPem = await resolvePublicKey(to, encryptionSelector);
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
    signatureSelector: sender.selector,
    ...(encryption ? { encryptionSelector } : {}),
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
