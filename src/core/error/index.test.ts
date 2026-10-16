/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  BTPErrorException,
  getWireErrorRule,
  isRetryableError,
  toWireError,
  transformToBTPErrorException,
} from './index.js';
import * as errorModule from './constant.js';
import {
  BTP_ERROR_UNKNOWN,
  BTP_ERROR_RESOLVE_DNS,
  BTP_ERROR_TRUST_EXPIRED,
  BTP_ERROR_TRUST_REVOKED,
  BTP_ERROR_TRUST_NOT_ALLOWED,
  BTP_ERROR_TRUST_BLOCKED,
  BTP_ERROR_TRUST_NON_EXISTENT,
  BTP_ERROR_TRUST_ALREADY_ACTIVE,
  BTP_ERROR_INVALID_JSON,
  BTP_ERROR_VALIDATION,
  BTP_ERROR_SIG_VERIFICATION,
  BTP_ERROR_IDENTITY_NOT_FOUND,
  BTP_ERROR_ISSUED_AT_WINDOW,
  BTP_ERROR_ALREADY_RECEIVED,
  BTP_ERROR_REGISTRATION_TOKEN_USED,
  BTP_ERROR_LINE_TOO_LONG,
  BTP_ERROR_RATE_LIMITER,
  BTP_ERROR_SOCKET_TIMEOUT,
  BTP_ERROR_AUTHENTICATION_INVALID,
  BTP_ERROR_CONNECTION_CLOSED,
} from './constant.js';
import { BTP_WIRE_ERRORS } from './wire.js';
import type { BTPError } from './types.js';

describe('BTPErrorException', () => {
  it('should create an instance with the correct properties', () => {
    const btpError = { message: 'Test error', code: 500 };
    const cause = new Error('root cause');
    const meta = { details: 'some details' };
    const error = new BTPErrorException(btpError, { cause, meta });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(BTPErrorException);
    expect(error.name).toBe('BTPErrorException');
    expect(error.message).toBe('Test error');
    expect(error.code).toBe(500);
    expect(error.cause).toBe(cause);
    expect(error.meta).toEqual(meta);
  });

  it('should produce the correct JSON output', () => {
    const btpError = { message: 'Test error', code: 500 };
    const cause = 'root cause';
    const meta = { details: 'some details' };
    const error = new BTPErrorException(btpError, { cause, meta });

    const json = error.toJSON();

    expect(json.name).toBe('BTPErrorException');
    expect(json.message).toBe('Test error');
    expect(json.code).toBe(500);
    expect(json.cause).toBe('root cause');
    expect(json.meta).toEqual(meta);
    expect(json.stack).toBeDefined();
  });

  it('should handle toJSON without cause or meta', () => {
    const error = new BTPErrorException({ message: 'Simple error' });
    const json = error.toJSON();

    expect(json.cause).toBeUndefined();
    expect(json.meta).toBeUndefined();
  });
});

describe('transformToBTPErrorException', () => {
  it('should transform a standard Error into a BTPErrorException', () => {
    const standardError = new Error('Standard error message');
    const btpError = transformToBTPErrorException(standardError);

    expect(btpError).toBeInstanceOf(BTPErrorException);
    expect(btpError.message).toBe('Standard error message');
  });

  it('should return an existing BTPErrorException instance as is', () => {
    const originalBtpError = new BTPErrorException({ message: 'Original BTPS error' });
    const result = transformToBTPErrorException(originalBtpError);

    expect(result).toBe(originalBtpError);
  });

  it('should handle unknown, non-Error inputs', () => {
    const unknownError = { some: 'object' };
    const btpError = transformToBTPErrorException(unknownError);

    expect(btpError).toBeInstanceOf(BTPErrorException);
    expect(btpError.message).toBe(BTP_ERROR_UNKNOWN.message);
    expect(btpError.code).toBe(BTP_ERROR_UNKNOWN.code);
    expect(btpError.cause).toBe(JSON.stringify(unknownError));
  });

  it('should handle string inputs', () => {
    const stringError = 'Just a string error';
    const btpError = transformToBTPErrorException(stringError);

    expect(btpError).toBeInstanceOf(BTPErrorException);
    expect(btpError.message).toBe(BTP_ERROR_UNKNOWN.message);
    expect(btpError.cause).toBe(JSON.stringify(stringError));
  });
});

describe('BTP_ERROR_SELECTOR_NOT_FOUND', () => {
  it('should have correct properties', () => {
    expect(BTP_ERROR_RESOLVE_DNS.code).toBe('BTP_ERROR_RESOLVE_DNS');
    expect(BTP_ERROR_RESOLVE_DNS.message).toBe('No valid DNS record found');
  });
});

// EBA-124: trust-refusal error codes (never-trusted, expired, revoked).
// Decision (option B, 2026-10-06): expired gets its own wire code; revoked
// and never-trusted both collapse onto BTP_ERROR_TRUST_NOT_ALLOWED on the
// wire, per documentation in the EBA-123 spec.
describe('BTP_ERROR_TRUST_EXPIRED', () => {
  it('is a distinct, documented wire code for an expired trust', () => {
    expect(BTP_ERROR_TRUST_EXPIRED.code).toBe('BTP_ERROR_TRUST_EXPIRED');
    expect(BTP_ERROR_TRUST_EXPIRED.message).toBeTruthy();
    expect(BTP_ERROR_TRUST_EXPIRED.code).not.toBe(BTP_ERROR_TRUST_NOT_ALLOWED.code);
  });
});

describe('BTP_ERROR_TRUST_REVOKED', () => {
  it('is a distinct, precise server-side reason code for a revoked trust', () => {
    expect(BTP_ERROR_TRUST_REVOKED.code).toBe('BTP_ERROR_TRUST_REVOKED');
    expect(BTP_ERROR_TRUST_REVOKED.message).toBeTruthy();
    expect(BTP_ERROR_TRUST_REVOKED.code).not.toBe(BTP_ERROR_TRUST_NOT_ALLOWED.code);
    expect(BTP_ERROR_TRUST_REVOKED.code).not.toBe(BTP_ERROR_TRUST_EXPIRED.code);
  });
});

// EBA-188 (fix list 6): the wire error table.
describe('BTP_WIRE_ERRORS', () => {
  const constants = Object.entries(errorModule).filter(
    (entry): entry is [string, BTPError] =>
      /^BTPS?_ERROR_/.test(entry[0]) && typeof (entry[1] as BTPError)?.message === 'string',
  );

  it('has a row for every error constant, and one only', () => {
    const codes = BTP_WIRE_ERRORS.map((r) => r.error.code);
    expect(new Set(codes).size).toBe(codes.length);
    const missing = constants.filter(([, c]) => !getWireErrorRule(c.code)).map(([name]) => name);
    expect(missing, 'error constants with no wire class').toEqual([]);
  });

  it('names each constant by its own code', () => {
    const mismatched = constants.filter(([name, c]) => c.code !== name).map(([name]) => name);
    expect(mismatched).toEqual([]);
  });

  it('sends a trust refusal other than expired as not-allowed (EBA-124, option B)', () => {
    for (const precise of [
      BTP_ERROR_TRUST_REVOKED,
      BTP_ERROR_TRUST_BLOCKED,
      BTP_ERROR_TRUST_NON_EXISTENT,
      BTP_ERROR_TRUST_ALREADY_ACTIVE,
    ]) {
      expect(toWireError(precise)).toEqual({
        code: BTP_ERROR_TRUST_NOT_ALLOWED.code,
        status: 403,
        message: BTP_ERROR_TRUST_NOT_ALLOWED.message,
        retryable: false,
      });
    }
    expect(toWireError(BTP_ERROR_TRUST_EXPIRED).code).toBe(BTP_ERROR_TRUST_EXPIRED.code);
  });

  it('never names a precise trust reason on the wire', () => {
    const sent = new Set(constants.map(([, c]) => toWireError(c).code));
    for (const hidden of [
      BTP_ERROR_TRUST_REVOKED,
      BTP_ERROR_TRUST_BLOCKED,
      BTP_ERROR_TRUST_NON_EXISTENT,
      BTP_ERROR_TRUST_ALREADY_ACTIVE,
    ]) {
      expect(sent.has(hidden.code as string)).toBe(false);
    }
  });

  it.each([
    [BTP_ERROR_INVALID_JSON, 400, false],
    [BTP_ERROR_VALIDATION, 400, false],
    [BTP_ERROR_SIG_VERIFICATION, 401, false],
    [BTP_ERROR_IDENTITY_NOT_FOUND, 401, false],
    [BTP_ERROR_TRUST_NOT_ALLOWED, 403, false],
    [BTP_ERROR_ISSUED_AT_WINDOW, 403, false],
    [BTP_ERROR_ALREADY_RECEIVED, 403, false],
    [BTP_ERROR_REGISTRATION_TOKEN_USED, 403, false],
    [BTP_ERROR_LINE_TOO_LONG, 403, false],
    [BTP_ERROR_RATE_LIMITER, 429, true],
    [BTP_ERROR_UNKNOWN, 500, true],
    [BTP_ERROR_SOCKET_TIMEOUT, 503, true],
  ] as const)('%o goes out as %i, retryable %s', (error, status, retryable) => {
    expect(toWireError(error)).toEqual({
      code: error.code,
      status,
      message: error.message,
      retryable,
    });
  });

  it('sends 500 only for BTP_ERROR_UNKNOWN and the server-configuration error', () => {
    const fiveHundred = constants
      .filter(([, c]) => toWireError(c).status === 500)
      .map(([name]) => name)
      .sort();
    expect(fiveHundred).toEqual(['BTP_ERROR_SERVER_SELECTOR', 'BTP_ERROR_UNKNOWN']);
  });

  it('retries 429, 500 and 503 only', () => {
    for (const r of BTP_WIRE_ERRORS) {
      expect(r.retryable, String(r.error.code)).toBe(r.status >= 429);
    }
  });

  it('sends an unknown code as BTP_ERROR_UNKNOWN with its fixed message', () => {
    const wire = toWireError({ code: 'ENOTFOUND', message: 'queryTxt ENOTFOUND secret.internal' });
    expect(wire).toEqual({
      code: 'BTP_ERROR_UNKNOWN',
      status: 500,
      message: 'Unknown error',
      retryable: true,
    });
  });

  it('sends a known code with its constant message, never the error’s own', () => {
    const wire = toWireError({ code: BTP_ERROR_VALIDATION.code, message: 'row 7 of table x' });
    expect(wire.message).toBe(BTP_ERROR_VALIDATION.message);
  });

  it.each([
    [400, BTP_ERROR_VALIDATION],
    [401, BTP_ERROR_AUTHENTICATION_INVALID],
    [403, BTP_ERROR_TRUST_NOT_ALLOWED],
    [429, BTP_ERROR_RATE_LIMITER],
  ])('sends a 1.0 middleware’s bare status %i as its class constant', (status, constant) => {
    const wire = toWireError({ code: status, message: 'Blocked IP 1.2.3.4' });
    expect(wire.code).toBe(constant.code);
    expect(wire.status).toBe(status);
    expect(wire.message).toBe(constant.message);
  });

  it('sends any other bare number as BTP_ERROR_UNKNOWN', () => {
    expect(toWireError({ code: 418, message: 'teapot' }).code).toBe(BTP_ERROR_UNKNOWN.code);
  });

  it('has no message that begins or ends with a space', () => {
    const padded = constants.filter(([, c]) => c.message !== c.message.trim()).map(([n]) => n);
    expect(padded).toEqual([]);
    expect(BTP_ERROR_SIG_VERIFICATION.message).toBe('Signature verification failed');
  });
});

describe('BTPErrorException.retryable (EBA-188)', () => {
  it('comes from the wire error table by code', () => {
    expect(new BTPErrorException(BTP_ERROR_RATE_LIMITER).retryable).toBe(true);
    expect(new BTPErrorException(BTP_ERROR_TRUST_EXPIRED).retryable).toBe(false);
    expect(new BTPErrorException(BTP_ERROR_CONNECTION_CLOSED).retryable).toBe(true);
  });

  it('is in toJSON', () => {
    expect(new BTPErrorException(BTP_ERROR_VALIDATION).toJSON().retryable).toBe(false);
  });

  it('falls back on the status class for a code the table does not know', () => {
    expect(isRetryableError('BTP_ERROR_FROM_A_NEWER_PEER', 403)).toBe(false);
    expect(isRetryableError('BTP_ERROR_FROM_A_NEWER_PEER', 429)).toBe(true);
    expect(isRetryableError('BTP_ERROR_FROM_A_NEWER_PEER', 502)).toBe(true);
    expect(isRetryableError(undefined, undefined)).toBe(true);
  });

  it('lets a known code win over the status it came with', () => {
    expect(isRetryableError(BTP_ERROR_TRUST_EXPIRED.code, 500)).toBe(false);
  });
});
