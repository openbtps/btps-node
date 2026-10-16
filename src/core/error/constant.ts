/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { BTPError } from './types.js';

export const BTP_ERROR_SOCKET_CLOSED: BTPError = {
  code: 'BTP_ERROR_SOCKET_CLOSED',
  message: 'Socket already closed',
};

export const BTP_ERROR_IDENTITY: BTPError = {
  code: 'BTP_ERROR_IDENTITY',
  message: 'BTPS identity is expected in the format username$domain.',
};

export const BTP_ERROR_IDENTITY_NOT_FOUND: BTPError = {
  code: 'BTP_ERROR_IDENTITY_NOT_FOUND',
  message: 'Identity not found',
};

export const BTP_ERROR_TRUST_NON_EXISTENT: BTPError = {
  code: 'BTP_ERROR_TRUST_NON_EXISTENT',
  message: 'BTPS trust record does not exist',
};

export const BTPS_ERROR_ACTION_TYPE: BTPError = {
  code: 'BTPS_ERROR_ACTION_TYPE',
  message: 'BTPS action type is not valid',
};

export const BTP_ERROR_TRUST_BLOCKED: BTPError = {
  code: 'BTP_ERROR_TRUST_BLOCKED',
  message: 'BTPS trust request is not allowed. Contact receiver',
};

export const BTP_ERROR_TRUST_NOT_ALLOWED: BTPError = {
  code: 'BTP_ERROR_TRUST_NOT_ALLOWED',
  message: 'BTPS trust request is not allowed at this time. Contact receiver',
};

/**
 * EBA-124 (option B, decided 2026-10-06): the one trust refusal a sender can
 * tell apart on the wire. It goes out with its own `code`; every other
 * refusal goes out as BTP_ERROR_TRUST_NOT_ALLOWED (see BTP_WIRE_ERRORS).
 */
export const BTP_ERROR_TRUST_EXPIRED: BTPError = {
  code: 'BTP_ERROR_TRUST_EXPIRED',
  message: 'BTPS trust record has expired',
};

/**
 * EBA-124: the precise, server-side-only reason for a revoked trust record.
 * On the wire this collapses onto BTP_ERROR_TRUST_NOT_ALLOWED (option B) -
 * same `code`, `message` and `status.code` - so a revoked sender cannot
 * distinguish their refusal from a never-trusted one.
 */
export const BTP_ERROR_TRUST_REVOKED: BTPError = {
  code: 'BTP_ERROR_TRUST_REVOKED',
  message: 'BTPS trust record has been revoked',
};

/**
 * EBA-444 (fix list 8): a `BTPS_DOC` or `BTPS_EVENT` whose encryption does
 * not match the trust's agreed `privacyType`: unencrypted on an `encrypted`
 * trust, or encrypted on an `unencrypted` one. Sent with its own code: the
 * sender agreed the privacy type, so telling it costs nothing, and only a
 * resend in the other form can succeed.
 */
export const BTP_ERROR_TRUST_PRIVACY: BTPError = {
  code: 'BTP_ERROR_TRUST_PRIVACY',
  message: "The artifact's encryption does not match the trust's privacy type",
};

export const BTP_ERROR_TRUST_ALREADY_ACTIVE: BTPError = {
  code: 'BTP_ERROR_TRUST_ALREADY_ACTIVE',
  message: 'BTPS trust record already exist. Request invalid',
};

export const BTP_ERROR_RESOLVE_DNS: BTPError = {
  code: 'BTP_ERROR_RESOLVE_DNS',
  message: 'No valid DNS record found',
};

export const BTP_ERROR_RESOLVE_PUBKEY: BTPError = {
  code: 'BTP_ERROR_RESOLVE_PUBKEY',
  message: 'No valid public-key found',
};

export const BTP_ERROR_RATE_LIMITER: BTPError = {
  code: 'BTP_ERROR_RATE_LIMITER',
  message: 'Too many request than its allowed',
};

export const BTP_ERROR_INVALID_ACTION: BTPError = {
  code: 'BTP_ERROR_INVALID_ACTION',
  message: 'Invalid action',
};

export const BTP_ERROR_INVALID_JSON = {
  code: 'BTP_ERROR_INVALID_JSON',
  message: 'Invalid JSON format',
};

export const BTP_ERROR_VALIDATION = {
  code: 'BTP_ERROR_VALIDATION',
  message: 'BTPS artifact validation failed',
};

export const BTP_ERROR_SIG_MISMATCH: BTPError = {
  code: 'BTP_ERROR_SIG_MISMATCH',
  message: 'fingerprint mis-match',
};

export const BTP_ERROR_SIG_VERIFICATION: BTPError = {
  code: 'BTP_ERROR_SIG_VERIFICATION',
  message: 'Signature verification failed',
};

export const BTP_ERROR_CANONICAL_JSON: BTPError = {
  code: 'BTP_ERROR_CANONICAL_JSON',
  message: 'Payload cannot be canonicalized (RFC 8785)',
};

export const BTP_ERROR_DELEGATION_SIG_VERIFICATION: BTPError = {
  code: 'BTP_ERROR_DELEGATION_SIG_VERIFICATION',
  message: 'Delegation signature verification failed',
};

export const BTP_ERROR_ATTESTATION_VERIFICATION: BTPError = {
  code: 'BTP_ERROR_ATTESTATION_VERIFICATION',
  message: 'Attestation verification failed',
};

export const BTP_ERROR_DELEGATION_INVALID: BTPError = {
  code: 'BTP_ERROR_DELEGATION_INVALID',
  message: 'Delegation is invalid',
};

export const BTP_ERROR_UNSUPPORTED_ENCRYPT: BTPError = {
  code: 'BTP_ERROR_UNSUPPORTED_ENCRYPT',
  message: 'Unsupported encryption algorithm',
};

export const BTP_ERROR_DECRYPTION_UNINTENDED: BTPError = {
  code: 'BTP_ERROR_DECRYPTION_UNINTENDED',
  message: 'Decryption failed: Message was not intended for this receiver.',
};

export const BTP_ERROR_UNKNOWN: BTPError = {
  code: 'BTP_ERROR_UNKNOWN',
  message: 'Unknown error',
};

export const BTP_ERROR_SOCKET_TIMEOUT: BTPError = {
  code: 'BTP_ERROR_SOCKET_TIMEOUT',
  message: 'Socket timeout. Connection closed',
};

export const BTP_ERROR_AUTHENTICATION_INVALID: BTPError = {
  code: 'BTP_ERROR_AUTHENTICATION_INVALID',
  message: 'Authentication failed',
};

export const BTP_ERROR_TIMEOUT: BTPError = {
  code: 'BTP_ERROR_TIMEOUT',
  message: 'Timeout',
};

export const BTP_ERROR_CONNECTION_CLOSED: BTPError = {
  code: 'BTP_ERROR_CONNECTION_CLOSED',
  message: 'Connection closed',
};

export const BTP_ERROR_CONNECTION_ENDED: BTPError = {
  code: 'BTP_ERROR_CONNECTION_ENDED',
  message: 'Connection ended',
};

export const BTP_ERROR_MONEY_NOT_INTEGER: BTPError = {
  code: 'BTP_ERROR_MONEY_NOT_INTEGER',
  message: 'Money amount must be an integer in minor units',
};

export const BTP_ERROR_MONEY_CURRENCY_MISMATCH: BTPError = {
  code: 'BTP_ERROR_MONEY_CURRENCY_MISMATCH',
  message: 'Money amounts are in different currencies',
};

export const BTP_ERROR_MONEY_OUT_OF_RANGE: BTPError = {
  code: 'BTP_ERROR_MONEY_OUT_OF_RANGE',
  message: 'Money amount is outside the safe integer range',
};

/**
 * Replay protection (item F, EBA-114): the artifact's `issuedAt` is more than
 * ISSUED_AT_WINDOW_MS from the server's clock (too old or too far ahead), or
 * cannot be read. Resending the same artifact cannot succeed: sign a new one,
 * with a new id, and check the sender's clock.
 */
export const BTP_ERROR_ISSUED_AT_WINDOW: BTPError = {
  code: 'BTP_ERROR_ISSUED_AT_WINDOW',
  message: 'Artifact issuedAt is outside the accepted window',
};

/**
 * Replay protection (item F, EBA-114): this server already accepted an
 * artifact with the same `(from, id)`. After a timed-out send this means the
 * first copy arrived. Any new artifact must be signed with a new id.
 */
export const BTP_ERROR_ALREADY_RECEIVED: BTPError = {
  code: 'BTP_ERROR_ALREADY_RECEIVED',
  message: 'Artifact already received',
};

/**
 * Key-rotating refresh (item D, EBA-112, threat T-24): an `auth.refresh` was
 * not signed by the agent's current trusted key. A refresh, rotating or not,
 * is signed by the key the server already holds; a new key alone proves
 * nothing, because a stolen refresh token is enough to make one.
 */
export const BTP_ERROR_REFRESH_NOT_CURRENT_KEY: BTPError = {
  code: 'BTP_ERROR_REFRESH_NOT_CURRENT_KEY',
  message: 'Refresh must be signed by the current agent key',
};

/**
 * Key-rotating refresh (item D, EBA-112): an `auth.refresh` carries a new
 * public key without a valid proof of possession of it (`keyProof`: a
 * signature by the new key over the JCS form of
 * `{ agentId, identity, newPublicKey, issuedAt }`).
 */
export const BTP_ERROR_KEY_ROTATION_PROOF: BTPError = {
  code: 'BTP_ERROR_KEY_ROTATION_PROOF',
  message: 'Key rotation requires a valid proof of the new key',
};

/**
 * Device registration (item E, EBA-113, threat T-25): this server has no
 * token store, so it cannot check a registration token and refuses every
 * `auth.request`. It never falls back to accepting one.
 */
export const BTP_ERROR_REGISTRATION_UNAVAILABLE: BTPError = {
  code: 'BTP_ERROR_REGISTRATION_UNAVAILABLE',
  message: 'Device registration is not available on this server',
};

/**
 * Device registration (item E, EBA-113): an `auth.request` carries no
 * registration token (`document.authToken` is empty).
 */
export const BTP_ERROR_REGISTRATION_TOKEN_MISSING: BTPError = {
  code: 'BTP_ERROR_REGISTRATION_TOKEN_MISSING',
  message: 'Device registration requires a registration token',
};

/**
 * Device registration (item E, EBA-113): no unexpired registration token with
 * this value was issued to the identity named. A token issued to another
 * identity is refused the same way: tokens are looked up by identity.
 */
export const BTP_ERROR_REGISTRATION_TOKEN_INVALID: BTPError = {
  code: 'BTP_ERROR_REGISTRATION_TOKEN_INVALID',
  message: 'Registration token is invalid or expired',
};

/**
 * Device registration (item E, EBA-113): the registration token was already
 * used. A token registers one device, once; ask the identity's owner for a
 * new one.
 */
export const BTP_ERROR_REGISTRATION_TOKEN_USED: BTPError = {
  code: 'BTP_ERROR_REGISTRATION_TOKEN_USED',
  message: 'Registration token has already been used',
};

/**
 * Device registration (item E, EBA-113): the `auth.request` names two
 * identities (`document.identity` is not the artifact's `to`), or the token
 * found was issued to another identity than the one named.
 */
export const BTP_ERROR_REGISTRATION_IDENTITY_MISMATCH: BTPError = {
  code: 'BTP_ERROR_REGISTRATION_IDENTITY_MISMATCH',
  message: 'Registration token is not for this identity',
};

export const BTP_ERROR_DOC_SCHEMA: BTPError = {
  code: 'BTP_ERROR_DOC_SCHEMA',
  message: 'Document does not match the document model',
};

/**
 * Identity lookup (fix list 1, EBA-442): a server given an identity store
 * answers lookups signed with its own key, so it must name the selector that
 * key is published at, `serverIdentity.selector`. Thrown when the server is
 * constructed without one.
 */
export const BTP_ERROR_SERVER_SELECTOR: BTPError = {
  code: 'BTP_ERROR_SERVER_SELECTOR',
  message: 'A server that answers identity lookups needs serverIdentity.selector',
};

/**
 * Fix list 10 (EBA-122): a line longer than the server reads
 * (BTP_MAX_LINE_LENGTH, or the server's own lower `maxLineLength`). The
 * server answers this and closes the connection.
 */
export const BTP_ERROR_LINE_TOO_LONG: BTPError = {
  code: 'BTP_ERROR_LINE_TOO_LONG',
  message: 'Line exceeds the maximum length',
};

/** The client was asked to send after `destroy()`. Never sent by a server. */
export const BTP_ERROR_CLIENT_DESTROYED: BTPError = {
  code: 'BTP_ERROR_CLIENT_DESTROYED',
  message: 'BtpsClient instance is destroyed',
};

/** A connection to the receiver is already being made. Never sent by a server. */
export const BTP_ERROR_ALREADY_CONNECTING: BTPError = {
  code: 'BTP_ERROR_ALREADY_CONNECTING',
  message: 'Already connecting',
};
