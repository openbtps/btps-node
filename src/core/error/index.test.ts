/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { BTPErrorException, transformToBTPErrorException } from './index.js';
import { BTP_ERROR_UNKNOWN, BTP_ERROR_RESOLVE_DNS } from './constant.js';

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
