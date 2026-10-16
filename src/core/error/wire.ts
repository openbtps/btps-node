/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import * as E from './constant.js';
import { BTPError, BTPWireError, BTPWireErrorRule } from './types.js';

const rule = (
  error: BTPError,
  status: BTPWireErrorRule['status'],
  retryable: boolean,
  sentAs?: BTPError,
): BTPWireErrorRule => ({ error, status, retryable, ...(sentAs ? { sentAs } : {}) });

/**
 * The wire error table (EBA-188, fix list 6): the status class every error
 * constant goes out with, and whether a sender may retry it. `sendBtpsError`
 * sends nothing that is not in it: an unlisted code goes out as
 * BTP_ERROR_UNKNOWN. A row with `sentAs` keeps its precise reason on the
 * server and sends that constant instead (EBA-124, option B: of the trust
 * refusals only an expired trust is told apart).
 *
 * Retry: 429, 500 and 503 are retryable; no 4xx is. Each 4xx needs something
 * other than time to change (a new artifact, a new trust, a new key), and a
 * duplicate was already delivered. Documented in
 * docs/docusaurus/docs/protocol/specifications/wire-errors.md.
 */
export const BTP_WIRE_ERRORS: readonly BTPWireErrorRule[] = Object.freeze([
  // 400: the artifact cannot be read or does not validate
  rule(E.BTP_ERROR_INVALID_JSON, 400, false),
  rule(E.BTP_ERROR_VALIDATION, 400, false),
  rule(E.BTP_ERROR_DOC_SCHEMA, 400, false),
  rule(E.BTP_ERROR_CANONICAL_JSON, 400, false),
  rule(E.BTP_ERROR_IDENTITY, 400, false),
  rule(E.BTPS_ERROR_ACTION_TYPE, 400, false),
  rule(E.BTP_ERROR_INVALID_ACTION, 400, false),
  rule(E.BTP_ERROR_UNSUPPORTED_ENCRYPT, 400, false),
  rule(E.BTP_ERROR_DECRYPTION_UNINTENDED, 400, false),
  rule(E.BTP_ERROR_MONEY_NOT_INTEGER, 400, false),
  rule(E.BTP_ERROR_MONEY_CURRENCY_MISMATCH, 400, false),
  rule(E.BTP_ERROR_MONEY_OUT_OF_RANGE, 400, false),
  rule(E.BTP_ERROR_CLIENT_DESTROYED, 400, false),
  // 401: who sent it, or whether they signed it, does not hold
  rule(E.BTP_ERROR_SIG_VERIFICATION, 401, false),
  rule(E.BTP_ERROR_SIG_MISMATCH, 401, false),
  rule(E.BTP_ERROR_DELEGATION_SIG_VERIFICATION, 401, false),
  rule(E.BTP_ERROR_DELEGATION_INVALID, 401, false),
  rule(E.BTP_ERROR_ATTESTATION_VERIFICATION, 401, false),
  rule(E.BTP_ERROR_AUTHENTICATION_INVALID, 401, false),
  rule(E.BTP_ERROR_REFRESH_NOT_CURRENT_KEY, 401, false),
  rule(E.BTP_ERROR_KEY_ROTATION_PROOF, 401, false),
  rule(E.BTP_ERROR_IDENTITY_NOT_FOUND, 401, false),
  rule(E.BTP_ERROR_RESOLVE_DNS, 401, false),
  rule(E.BTP_ERROR_RESOLVE_PUBKEY, 401, false),
  // 403: trust refusal; only an expired trust is told apart (option B)
  rule(E.BTP_ERROR_TRUST_NOT_ALLOWED, 403, false),
  rule(E.BTP_ERROR_TRUST_EXPIRED, 403, false),
  rule(E.BTP_ERROR_TRUST_NON_EXISTENT, 403, false, E.BTP_ERROR_TRUST_NOT_ALLOWED),
  rule(E.BTP_ERROR_TRUST_REVOKED, 403, false, E.BTP_ERROR_TRUST_NOT_ALLOWED),
  rule(E.BTP_ERROR_TRUST_BLOCKED, 403, false, E.BTP_ERROR_TRUST_NOT_ALLOWED),
  rule(E.BTP_ERROR_TRUST_ALREADY_ACTIVE, 403, false, E.BTP_ERROR_TRUST_NOT_ALLOWED),
  // 403: trusted, but not in this form (EBA-444): told apart, the sender agreed it
  rule(E.BTP_ERROR_TRUST_PRIVACY, 403, false),
  // 403: protocol violations
  rule(E.BTP_ERROR_ISSUED_AT_WINDOW, 403, false),
  rule(E.BTP_ERROR_ALREADY_RECEIVED, 403, false),
  rule(E.BTP_ERROR_REGISTRATION_UNAVAILABLE, 403, false),
  rule(E.BTP_ERROR_REGISTRATION_TOKEN_MISSING, 403, false),
  rule(E.BTP_ERROR_REGISTRATION_TOKEN_INVALID, 403, false),
  rule(E.BTP_ERROR_REGISTRATION_TOKEN_USED, 403, false),
  rule(E.BTP_ERROR_REGISTRATION_IDENTITY_MISMATCH, 403, false),
  rule(E.BTP_ERROR_LINE_TOO_LONG, 403, false),
  // 429: slow down
  rule(E.BTP_ERROR_RATE_LIMITER, 429, true),
  // 500: unexpected
  rule(E.BTP_ERROR_UNKNOWN, 500, true),
  rule(E.BTP_ERROR_SERVER_SELECTOR, 500, true),
  // 503: the connection, not the artifact
  rule(E.BTP_ERROR_SOCKET_TIMEOUT, 503, true),
  rule(E.BTP_ERROR_SOCKET_CLOSED, 503, true),
  rule(E.BTP_ERROR_TIMEOUT, 503, true),
  rule(E.BTP_ERROR_CONNECTION_CLOSED, 503, true),
  rule(E.BTP_ERROR_CONNECTION_ENDED, 503, true),
  rule(E.BTP_ERROR_ALREADY_CONNECTING, 503, true),
]);

/**
 * Middleware written for 1.0 answers with a bare status, e.g.
 * `sendError({ code: 400, message })`. Such an error goes out as its class's
 * constant, so its status holds and its message stays on the server. Any
 * other number goes out as BTP_ERROR_UNKNOWN.
 */
export const BTP_WIRE_ERRORS_BY_STATUS: Readonly<Record<number, BTPError>> = Object.freeze({
  400: E.BTP_ERROR_VALIDATION,
  401: E.BTP_ERROR_AUTHENTICATION_INVALID,
  403: E.BTP_ERROR_TRUST_NOT_ALLOWED,
  429: E.BTP_ERROR_RATE_LIMITER,
});

const WIRE_RULES = new Map<string | number, BTPWireErrorRule>(
  BTP_WIRE_ERRORS.map((r) => [r.error.code as string, r]),
);

/** The wire error table's row for a code, if it has one. */
export const getWireErrorRule = (code?: string | number): BTPWireErrorRule | undefined =>
  code === undefined ? undefined : WIRE_RULES.get(code);

/**
 * Whether a sender may retry after this error. A code in the wire error
 * table decides; a code it does not know (a newer peer's) falls back on the
 * status class: 429 and 5xx are retryable, 4xx are not. With neither, the
 * error is unexpected and retryable, as BTP_ERROR_UNKNOWN is.
 */
export const isRetryableError = (code?: string | number, status?: number): boolean => {
  const known = getWireErrorRule(code);
  if (known) return known.retryable;
  if (typeof status === 'number') return status === 429 || status >= 500;
  return true;
};

/**
 * What goes on the wire for an error (EBA-188): its stable code, status and
 * fixed message from the wire error table, never the error's own message. A
 * code not in the table is sent as BTP_ERROR_UNKNOWN.
 */
export const toWireError = (error: BTPError): BTPWireError => {
  const byStatus =
    typeof error.code === 'number' ? BTP_WIRE_ERRORS_BY_STATUS[error.code] : undefined;
  const found =
    getWireErrorRule(byStatus?.code ?? error.code) ?? getWireErrorRule(E.BTP_ERROR_UNKNOWN.code)!;
  const sent = found.sentAs ? getWireErrorRule(found.sentAs.code)! : found;
  return {
    code: String(sent.error.code),
    status: sent.status,
    message: sent.error.message,
    retryable: sent.retryable,
  };
};
