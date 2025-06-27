/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { BTP_ERROR_IDENTITY, BTP_ERROR_RESOLVE_PUBKEY } from '@core/error/constant.js';
import { decryptBtpPayload, verifySignature } from './index.js';
import { BTPCryptoArtifact, BTPCryptoResponse, PemKeys } from './types.js';
import { parseIdentity, resolvePublicKey } from '@core/utils/index.js';
import { BTPErrorException } from '@core/error/index.js';
import { BTPDocType } from '@core/server/types.js';
import isEmpty from 'lodash/isEmpty.js';

const genDecryptError = (error: BTPErrorException) => ({
  payload: undefined,
  error,
});

export const decryptVerify = async <T extends BTPDocType>(
  pemFiles: PemKeys,
  encryptedPayload: BTPCryptoArtifact<T>,
): Promise<BTPCryptoResponse> => {
  const { from, to } = encryptedPayload;
  const parsedSender = parseIdentity(from);
  if (!parsedSender) return genDecryptError(new BTPErrorException(BTP_ERROR_IDENTITY));

  const senderPubPem = await resolvePublicKey(from);
  if (!senderPubPem) return genDecryptError(new BTPErrorException(BTP_ERROR_RESOLVE_PUBKEY));
  const { signature, ...signedArtifact } = encryptedPayload;

  const docToVerify = {
    ...signedArtifact,
    from,
    to,
  };

  const { isValid, error: sigError } = verifySignature(docToVerify, signature, senderPubPem);

  if (!isValid && sigError) {
    return genDecryptError(sigError);
  }

  const { encryption, document } = signedArtifact;
  const needsDecryption = !isEmpty(encryption);

  const { privateKey } = pemFiles;
  const { data: decryptedPayload, error: decryptionErrors } = needsDecryption
    ? decryptBtpPayload(document, encryption, privateKey)
    : { data: document, error: undefined };

  if (!decryptedPayload && decryptionErrors) return genDecryptError(decryptionErrors);

  return {
    payload: {
      ...signedArtifact,
      document: decryptedPayload as T,
      signature,
    },
    error: undefined,
  };
};
