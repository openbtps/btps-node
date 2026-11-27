/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */
import { decryptBtpPayload, decryptBtpPayloadWithDecrypter, verifySignature } from './index.js';
import { BTPCryptoResponse, BTPDecryptionKey, VerifyEncryptedPayload } from './types.js';
import { BTPErrorException } from '@core/error/index.js';
import { BTP_ERROR_SIG_VERIFICATION } from '@core/error/constant.js';
import { boundViewResultOf } from '@core/server/schemas/boundViewChecks.js';
import { checkDecryptedDocument } from './documentChecks.js';
import isEmpty from 'lodash/isEmpty.js';
import { sameIdentity } from '@core/server/schemas/helpers.js';
import { openCosignature } from '@core/trust/cosignatures.js';
import type { BTPAgreementRef, BTPAgreementStatement, BTPCosignature } from '@core/trust/types.js';

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

  // An encrypted document is checked once it can be read, as an unencrypted one is on arrival
  // (documentChecks.ts: the same checks a platform runs on one it decrypted a piece at a time).
  if (needsDecryption) {
    const problem = await checkDecryptedDocument(decryptedData, restEncryptedPayload);
    if (problem) return genDecryptError(problem);
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

  // Since 1.2: a BoundView is checked wherever its document is opened.
  const boundView =
    restEncryptedPayload.type === 'BTPS_DOC' ? boundViewResultOf(decryptedData) : undefined;

  // Since 1.2 (rc.4): each cosignature the receiver is a recipient of, opened and held to what it signed.
  const cosigned = await openedCosignatures(restEncryptedPayload, decryptedData, receiverKey);
  if (cosigned instanceof BTPErrorException) return genDecryptError(cosigned);

  return {
    payload: decryptedPayload as BTPCryptoResponse<T>['payload'],
    error: undefined,
    ...(boundView && { boundView }),
    ...(cosigned && { cosigned }),
  };
};

/**
 * Since 1.2 (rc.4): the statements in an event's cosignatures, by position: each one the receiver (`to`) is a
 * recipient of, opened with its key and held to its cosignature (openCosignature), and null for one it is not. They
 * must all name the document the opened event is about. An error when one that is the receiver's does not hold.
 */
const openedCosignatures = async (
  artifact: Record<string, unknown>,
  opened: unknown,
  receiverKey: BTPDecryptionKey | undefined,
): Promise<(BTPAgreementStatement | null)[] | BTPErrorException | undefined> => {
  const cosignatures = artifact.cosignatures as BTPCosignature[] | undefined;
  if (cosignatures === undefined || typeof artifact.to !== 'string') return undefined;
  const fail = (reason: string) => new BTPErrorException(BTP_ERROR_SIG_VERIFICATION, { meta: { reason } });
  // A statement addressed to the receiver is never left unchecked for want of the key that opens it.
  if (receiverKey === undefined || receiverKey === '') {
    const to = artifact.to;
    const forYou = cosignatures.some(({ recipients }) => recipients.some(({ identity }) => sameIdentity(identity, to)));
    return forYou ? fail('a cosignature for you is opened with your key: give receiverKey') : undefined;
  }
  const about = (opened as { agreement?: BTPAgreementRef } | undefined)?.agreement;
  const statements: (BTPAgreementStatement | null)[] = [];
  for (const cosignature of cosignatures) {
    if (
      about === undefined ||
      !sameIdentity(about.originator, cosignature.ref.originator) ||
      about.id !== cosignature.ref.id ||
      about.contentSha256 !== cosignature.ref.contentSha256
    ) {
      return fail('a cosignature names the document its event is about');
    }
    const result = await openCosignature(cosignature, { identity: artifact.to, key: receiverKey });
    if (result !== undefined && 'problem' in result) return fail(`a cosignature for you: ${result.problem}`);
    statements.push(result === undefined ? null : result.statement);
  }
  return statements;
};
