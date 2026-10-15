/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */
import { decryptBtpPayload, verifySignature } from './index.js';
import { BTPCryptoResponse, BTPDecryptionKeys, VerifyEncryptedPayload } from './types.js';
import { selectDecryptionKey } from './keySelection.js';
import { isDecrypter } from './custody.js';
import type { Decrypter } from '../../decrypter-interface.js';
import { BTPErrorException } from '@core/error/index.js';
import isEmpty from 'lodash/isEmpty.js';

const genDecryptError = (error: BTPErrorException) => ({
  payload: undefined,
  error,
});

/**
 * Verifies a signed payload with the sender's key and decrypts its document.
 *
 * `senderPubPem` is the sender's key at the payload's `signatureSelector`
 * (see `resolveSignatureKey`). `receiverKeys` is the receiver's `Decrypter`
 * (or private key PEM, for tests and the interim), or a lookup that is asked
 * for the key at the payload's `encryptionSelector`.
 */
export const decryptVerify = async <T = unknown>(
  senderPubPem: string,
  encryptedPayload: VerifyEncryptedPayload<T>,
  receiverKeys?: BTPDecryptionKeys,
): Promise<BTPCryptoResponse<T>> => {
  const { signature, delegation, ...restEncryptedPayload } = encryptedPayload;

  const { isValid, error: sigError } = verifySignature(
    restEncryptedPayload,
    signature,
    senderPubPem,
  );

  if (!isValid && sigError) {
    return genDecryptError(sigError);
  }

  const { encryption, document } = restEncryptedPayload;

  const hasReceiverKeys =
    typeof receiverKeys === 'function' ||
    isDecrypter(receiverKeys) ||
    (typeof receiverKeys === 'string' && receiverKeys.length > 0);

  const needsDecryption =
    !isEmpty(encryption) && hasReceiverKeys && !isEmpty(document) && typeof document === 'string';

  let decrypter: Decrypter | undefined;
  if (needsDecryption) {
    const selected = await selectDecryptionKey(
      restEncryptedPayload.encryptionSelector,
      receiverKeys!,
    );
    if (selected.error) return genDecryptError(selected.error);
    decrypter = selected.decrypter;
  }

  const { data: decryptedData, error: decryptionErrors } = needsDecryption
    ? await decryptBtpPayload(document, encryption!, decrypter!)
    : { data: document, error: undefined };

  if (decryptionErrors) return genDecryptError(decryptionErrors);

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
