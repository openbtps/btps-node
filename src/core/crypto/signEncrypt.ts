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
} from './types.js';
import { parseIdentity, resolvePublicKey } from '@core/utils/index.js';
import { ParsedIdentity } from '@core/utils/types.js';
import { BTPErrorException } from '@core/error/index.js';
import { BTPArtifactType, BTPDocType } from '@core/server/types.js';
import isEmpty from 'lodash/isEmpty.js';

const genEncryptError = (error: BTPErrorException) => ({
  payload: undefined,
  error,
});

export const signEncrypt = async <T extends BTPDocType>(
  to: string,
  sender: ParsedIdentity & { pemFiles: PemKeys },
  payload: {
    document: T;
    id?: string;
    issuedAt?: string;
    type: BTPArtifactType;
  },
  options?: BTPCryptoOptions,
): Promise<BTPCryptoResponse<T>> => {
  const parsedReceiver = parseIdentity(to);
  if (!parsedReceiver) return genEncryptError(new BTPErrorException(BTP_ERROR_IDENTITY));

  const receiverPubPem = await resolvePublicKey(to);
  if (!receiverPubPem) return genEncryptError(new BTPErrorException(BTP_ERROR_RESOLVE_PUBKEY));

  let encryption: BTPEncryption | null;
  let encryptedDoc: string | T;
  let signature: BTPSignature;

  const { document, id, issuedAt, type } = payload;

  try {
    const encryptedData = isEmpty(options?.encryption)
      ? { encryption: null, data: document }
      : encryptBtpPayload(document, receiverPubPem, options?.encryption);
    encryption = encryptedData.encryption;
    encryptedDoc = encryptedData.data;
  } catch (error) {
    return genEncryptError(error as BTPErrorException);
  }

  const uuid = id ?? randomUUID();
  const timestamp = issuedAt ? new Date(issuedAt).toISOString() : new Date().toISOString();

  const docToSign = {
    id: uuid,
    to,
    from: `${sender.accountName}$${sender.domainName}`,
    type,
    issuedAt: timestamp,
    document: encryptedDoc,
    encryption,
  };

  try {
    signature = signBtpPayload(docToSign, sender.pemFiles);
  } catch (error) {
    return genEncryptError(error as BTPErrorException);
  }

  return {
    payload: {
      ...docToSign,
      signature,
    },
    error: undefined,
  };
};
