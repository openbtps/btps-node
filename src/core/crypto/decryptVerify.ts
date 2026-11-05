/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */
import { decryptBtpPayload, decryptBtpPayloadWithDecrypter, verifySignature } from './index.js';
import { BTPCryptoResponse, BTPDecryptionKey, VerifyEncryptedPayload } from './types.js';
import { BTPErrorException } from '@core/error/index.js';
import { BTP_ERROR_SIG_VERIFICATION, BTP_ERROR_VALIDATION } from '@core/error/constant.js';
import { decryptedDocumentProblem } from '@core/server/schemas/helpers.js';
import isEmpty from 'lodash/isEmpty.js';

const genDecryptError = (error: BTPErrorException) => ({
  payload: undefined,
  error,
});

/**
 * Verifies an artifact's signature, then decrypts its document and checks it.
 * Since 1.2, `contentKey` is the document's content key wrapped to the
 * receiver's own key instead of the envelope's (a device's `agentKey.key`): the
 * signature is checked over the artifact as sent, and only the decryption uses it.
 */
export const decryptVerify = async <T = unknown>(
  senderPubPem: string,
  encryptedPayload: VerifyEncryptedPayload<T>,
  receiverKey?: BTPDecryptionKey,
  contentKey?: string,
): Promise<BTPCryptoResponse<T>> => {
  const { signature, delegation, ...restEncryptedPayload } = encryptedPayload;

  const { isValid, error: sigError } = verifySignature(
    restEncryptedPayload,
    signature,
    senderPubPem,
  );

  if (!isValid) {
    return genDecryptError(sigError ?? new BTPErrorException(BTP_ERROR_SIG_VERIFICATION));
  }

  const { encryption, document } = restEncryptedPayload;

  // A Decrypter's methods may all sit on its prototype, so only a PEM string is tested for emptiness.
  const hasReceiverKey =
    typeof receiverKey === 'string' ? !isEmpty(receiverKey) : receiverKey !== undefined;
  const needsDecryption =
    !isEmpty(encryption) && hasReceiverKey && !isEmpty(document) && typeof document === 'string';
  let decrypted: { data?: unknown; error?: BTPErrorException } = { data: document };
  if (needsDecryption && receiverKey !== undefined) {
    const wrapped =
      contentKey !== undefined && encryption
        ? { ...encryption, encryptedKey: contentKey }
        : encryption;
    decrypted =
      typeof receiverKey === 'string'
        ? decryptBtpPayload(document, wrapped, receiverKey)
        : await decryptBtpPayloadWithDecrypter(document, wrapped, receiverKey);
  }
  const { data: decryptedData, error: decryptionErrors } = decrypted;

  if (decryptionErrors) return genDecryptError(decryptionErrors);

  // An encrypted document is checked once it can be read, as an unencrypted one is on arrival.
  if (needsDecryption) {
    const problem = decryptedDocumentProblem(decryptedData, restEncryptedPayload);
    if (problem) {
      return genDecryptError(new BTPErrorException(BTP_ERROR_VALIDATION, { cause: problem }));
    }
  }

  const decryptedPayload: VerifyEncryptedPayload<T> = {
    ...restEncryptedPayload,
    signature,
  };

  if (decryptedData) {
    decryptedPayload.document = decryptedData as T;
  }

  if (delegation) {
    decryptedPayload.delegation = delegation;
  }

  return {
    payload: decryptedPayload as BTPCryptoResponse<T>['payload'],
    error: undefined,
  };
};
