/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */
import { decryptBtpPayload, verifySignature } from './index.js';
import { BTPCryptoResponse, VerifyEncryptedPayload } from './types.js';
import { BTPErrorException } from '@core/error/index.js';
import { BTP_ERROR_VALIDATION } from '@core/error/constant.js';
import { decryptedEventProblem } from '@core/server/schemas/helpers.js';
import isEmpty from 'lodash/isEmpty.js';

const genDecryptError = (error: BTPErrorException) => ({
  payload: undefined,
  error,
});

export const decryptVerify = async <T = unknown>(
  senderPubPem: string,
  encryptedPayload: VerifyEncryptedPayload<T>,
  receiverPrivatePem?: string,
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

  const needsDecryption =
    !isEmpty(encryption) &&
    !isEmpty(receiverPrivatePem) &&
    !isEmpty(document) &&
    typeof document === 'string';
  const { data: decryptedData, error: decryptionErrors } = needsDecryption
    ? decryptBtpPayload(document, encryption, receiverPrivatePem!)
    : { data: document, error: undefined };

  if (decryptionErrors) return genDecryptError(decryptionErrors);

  // An encrypted event is checked once it can be read, as an unencrypted one is on arrival.
  if (needsDecryption && restEncryptedPayload.type === 'BTPS_EVENT') {
    const problem = decryptedEventProblem(decryptedData, restEncryptedPayload);
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
