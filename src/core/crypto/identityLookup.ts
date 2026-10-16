/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { createPublicKey } from 'crypto';
import {
  BTP_ERROR_IDENTITY_NOT_FOUND,
  BTP_ERROR_RESOLVE_PUBKEY,
  BTP_ERROR_SIG_VERIFICATION,
  BTP_ERROR_VALIDATION,
} from '@core/error/constant.js';
import { BTPErrorException, transformToBTPErrorException } from '@core/error/index.js';
import { parseIdentity, resolvePublicKey } from '@core/utils/index.js';
import { validate } from '@core/utils/validation.js';
import {
  BtpIdentityResDocSchema,
  BtpServerResponseSchema,
} from '@core/server/schemas/responseSchema.js';
import type { BTPError } from '@core/error/types.js';
import type { BTPIdentityResDoc, BTPServerResponse } from '@core/server/types.js';
import { decryptVerify } from './decryptVerify.js';
import type { BTPDecryptionKeys, VerifyEncryptedPayload } from './types.js';

export type BTPIdentityLookupResult =
  | { record: BTPIdentityResDoc; error: undefined }
  | { record: undefined; error: BTPErrorException };

const refuse = (
  error: BTPError,
  cause: string,
  meta?: Record<string, unknown>,
): BTPIdentityLookupResult => ({
  record: undefined,
  error: new BTPErrorException(error, { cause, meta }),
});

const domainOf = (identity: string) => parseIdentity(identity)?.domainName.toLowerCase();

/**
 * Checks a host's answer to an identity lookup (fix list 1, EBA-442) and
 * returns the key record it carries.
 *
 * The answer is accepted only when it:
 * - is a valid `btps_response` that answers `request.id`;
 * - is signed (`signature`, `signedBy`, `signatureSelector`) by an identity
 *   of the looked-up address's own domain: a domain vouches only for its own
 *   addresses;
 * - verifies, over the bytes as received, with the key `signedBy` publishes
 *   in DNS at `signatureSelector`;
 * - carries a key record whose `publicKey` is a public key.
 *
 * An encrypted answer is opened with `receiverKeys`.
 */
export const verifyIdentityLookupResponse = async (
  response: unknown,
  request: { identity: string; id: string },
  receiverKeys?: BTPDecryptionKeys,
): Promise<BTPIdentityLookupResult> => {
  const parsed = validate(BtpServerResponseSchema, response);
  if (!parsed.success) {
    return refuse(BTP_ERROR_VALIDATION, 'The host answer is not a valid server response', {
      issues: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    });
  }
  const msg = response as BTPServerResponse;

  if (msg.type === 'btps_error' || !msg.status.ok) {
    return refuse(
      BTP_ERROR_IDENTITY_NOT_FOUND,
      `The host answered an error for ${request.identity}: ${msg.status.message ?? msg.status.code}`,
      { status: msg.status },
    );
  }

  if (msg.reqId !== request.id) {
    return refuse(BTP_ERROR_VALIDATION, 'The host answer is not for this request', {
      reqId: msg.reqId,
      expected: request.id,
    });
  }

  const { signature, signedBy, signatureSelector } = msg;
  if (!signature || !signedBy || !signatureSelector) {
    return refuse(BTP_ERROR_SIG_VERIFICATION, 'An identity lookup answer must be signed');
  }

  const domain = domainOf(request.identity);
  if (!domain || domainOf(signedBy) !== domain) {
    return refuse(
      BTP_ERROR_SIG_VERIFICATION,
      `The answer for ${request.identity} is signed by ${signedBy}, outside its domain`,
      { signedBy },
    );
  }

  let hostPublicKey: string | undefined;
  try {
    hostPublicKey = await resolvePublicKey(signedBy, signatureSelector);
  } catch (error) {
    return { record: undefined, error: transformToBTPErrorException(error) };
  }
  if (!hostPublicKey) {
    return refuse(
      BTP_ERROR_RESOLVE_PUBKEY,
      `No key published for ${signedBy} at signatureSelector ${signatureSelector}`,
      { signedBy, signatureSelector },
    );
  }

  // Verified as received: nothing is added before verifying (defect 5).
  const { payload, error } = await decryptVerify<BTPServerResponse>(
    hostPublicKey,
    msg as unknown as VerifyEncryptedPayload<BTPServerResponse>,
    receiverKeys,
  );
  if (error) return { record: undefined, error };

  const document = (payload as { document?: unknown } | undefined)?.document;
  const record = validate(BtpIdentityResDocSchema, document);
  if (!record.success) {
    return refuse(BTP_ERROR_VALIDATION, 'The host answer does not carry a key record');
  }

  try {
    createPublicKey(record.data.publicKey);
  } catch {
    return refuse(BTP_ERROR_VALIDATION, 'The key record does not hold a public key');
  }

  return { record: record.data, error: undefined };
};
