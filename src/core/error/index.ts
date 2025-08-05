/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { BTP_ERROR_UNKNOWN } from './constant.js';
import { BTPError } from './types.js';
export * from './constant.js';
export * from './types.js';

export class BTPErrorException extends Error {
  public readonly code?: string | number;
  public readonly cause?: unknown;
  public readonly meta?: Record<string, unknown>;

  constructor(
    btpError: BTPError,
    options?: {
      cause?: unknown;
      meta?: Record<string, unknown>;
    },
  ) {
    super(btpError.message);

    this.name = 'BTPErrorException';
    this.code = btpError.code;
    this.cause = options?.cause;
    this.meta = options?.meta;

    // Fix prototype chain
    Object.setPrototypeOf(this, new.target.prototype);

    // Optional: Keep proper stack trace (especially in older runtimes)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, BTPErrorException);
    }
  }

  /**
   * Optional JSON representation for logs or APIs
   */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      stack: this.stack,
      ...(this.meta ? { meta: this.meta } : {}),
      ...(this.cause ? { cause: this.cause } : {}),
    };
  }
}

export const transformToBTPErrorException = (
  err: unknown,
  options?: {
    cause?: unknown;
    meta?: Record<string, unknown>;
  },
): BTPErrorException => {
  if (err instanceof BTPErrorException) {
    return err;
  }

  if (err instanceof Error) {
    const code = (err as unknown as { code?: string | number })?.code;
    return new BTPErrorException(
      { message: err?.message ?? err.name, code: code ?? BTP_ERROR_UNKNOWN.code },
      {
        cause: options?.cause ?? err.cause,
        meta: { ...err, ...(options?.meta ?? {}) },
      },
    );
  }

  return new BTPErrorException(BTP_ERROR_UNKNOWN, {
    cause: options?.cause ?? JSON.stringify(err),
    meta: options?.meta ?? { err: err },
  });
};
