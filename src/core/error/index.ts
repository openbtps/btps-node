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
      ...(this.cause instanceof Error ? { cause: this.cause.message } : {}),
    };
  }
}

export const transformToBTPErrorException = (err: unknown): BTPErrorException => {
  if (err instanceof BTPErrorException) {
    return err;
  }

  if (err instanceof Error) {
    return new BTPErrorException({ message: err.message }, { ...err });
  }

  return new BTPErrorException(BTP_ERROR_UNKNOWN, { cause: JSON.stringify(err) });
};
