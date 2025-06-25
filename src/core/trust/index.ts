import crypto from 'crypto';
import {
  BTP_ERROR_TRUST_ALREADY_ACTIVE,
  BTP_ERROR_TRUST_BLOCKED,
  BTP_ERROR_TRUST_NOT_ALLOWED,
  BTPErrorException,
} from '@core/error/index.js';
import { BTPTrustRecord } from './types.js';
import isEmpty from 'lodash/isEmpty.js';
import { AbstractTrustStore } from './storage/AbstractTrustStore.js';
export { default as JsonTrustStore } from './storage/JsonTrustStore.js';
export { AbstractTrustStore } from './storage/AbstractTrustStore.js';
export * from './types.js';

/**
 * Checks if a trust record is active.
 * Used in for artifact type other than btp_trust_response and btp_trust_request
 * only allow message to be sent if trust record is active
 * @param trust - The trust record to check
 * @returns True if the trust record is active, false otherwise
 */
export const isTrustActive = (trust?: BTPTrustRecord): boolean => {
  if (isEmpty(trust)) return false;
  if (trust.status !== 'accepted') return false;
  if (trust.expiresAt && new Date(trust.expiresAt).getTime() < Date.now()) return false;
  return true;
};

/**
 * Validates a trust request.
 * Used in for artifact type btp_trust_request
 * only allow message to be sent if trust record is not active
 * considers blocked and retryAfterDate as one can send new trust request after the retryAfterDate
 * @param trust - The trust record to check
 * @returns Object indicating validity and optional BTP error
 */
export const validateTrustRequest = (
  trust?: BTPTrustRecord,
): { isValid: boolean; error?: BTPErrorException } => {
  const isActive = isTrustActive(trust);
  if (isActive)
    return { isValid: false, error: new BTPErrorException(BTP_ERROR_TRUST_ALREADY_ACTIVE) };

  if (trust?.status === 'blocked')
    return { isValid: false, error: new BTPErrorException(BTP_ERROR_TRUST_BLOCKED) };

  if (trust?.retryAfterDate && new Date(trust.retryAfterDate).getTime() > Date.now()) {
    return { isValid: false, error: new BTPErrorException(BTP_ERROR_TRUST_NOT_ALLOWED) };
  }

  return { isValid: true, error: undefined };
};

/**
 * Computes a globally unique, deterministic trust ID
 * for a given `from` and `to` identity pair using SHA-256.
 *
 * This ID is:
 * - Directional: `from:to` ≠ `to:from`
 * - Collision-resistant: suitable for billions of records
 * - Index-safe: 64-character hex string for database keys
 * - Human-debuggable: logs clearly as a hash
 *
 * @param from - Sender identity (e.g. "finance$company.com")
 * @param to - Receiver identity (e.g. "billing$vendor.org")
 * @returns 64-character hexadecimal SHA-256 hash of "from:to"
 */
export function computeTrustId(senderId: string, receiverId: string): string {
  const input = `${senderId}:${receiverId}`.toLowerCase(); // Ensure consistent direction-sensitive format
  const hash = crypto.createHash('sha256').update(input).digest('hex');
  return hash;
}

/**
 * Validates a btp_trust_response by checking if the response is authorized.
 * Ensures that only the original receiver of a trust request is allowed to respond.
 *
 * @param senderId - The identity sending the trust response (e.g., userB$domain)
 * @param receiverId - The identity receiving the trust response (e.g., userA$domain)
 * @param trustStore - The TrustStore instance
 * @returns Object indicating validity and optional BTP error
 */
export async function validateTrustResponse(
  senderId: string, // The responder
  receiverId: string, // The original requester
  trustStore: AbstractTrustStore<BTPTrustRecord>,
): Promise<{ isValid: boolean; error?: BTPErrorException }> {
  const flippedId = computeTrustId(receiverId, senderId);
  const trustRecord = await trustStore.getById(flippedId);

  const buildError = (cause: string) => ({
    isValid: false,
    error: new BTPErrorException(BTP_ERROR_TRUST_NOT_ALLOWED, { cause }),
  });

  if (!trustRecord) {
    return buildError(`No pending trust request found from ${receiverId} to ${senderId}`);
  }

  if (trustRecord.status !== 'pending') {
    return buildError(`Trust request from ${receiverId} to ${senderId} is not pending`);
  }

  if (trustRecord.receiverId !== senderId) {
    return buildError(`Only ${trustRecord.receiverId} can respond to this trust request`);
  }

  return { isValid: true };
}

/**
 * Determines whether a trust request can be retried.
 * Applies to previously rejected, revoked, or pending trusts.
 *
 * @param trust - The trust record to check
 * @returns True if retry is allowed, false otherwise
 */
export function canRetryTrust(trust?: BTPTrustRecord): boolean {
  if (isEmpty(trust)) return true; // No prior trust → retry allowed

  if (trust.status === 'accepted' || trust.status === 'blocked') return false;

  if (trust.retryAfterDate) {
    const retryTime = new Date(trust.retryAfterDate).getTime();
    return retryTime <= Date.now(); // Only allow if retryAfterDate has passed
  }

  return true; // No block, no retry timer = allow
}
