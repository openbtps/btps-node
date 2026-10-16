/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

export type BTPError = {
  code?: string | number;
  message: string;
};

/**
 * The status class an error goes out with: 400 parsing and
 * validation, 401 identity and signature, 403 trust refusal and protocol
 * violations, 429 rate limit, 500 unexpected, 503 connection and timeout.
 */
export type BTPErrorStatus = 400 | 401 | 403 | 429 | 500 | 503;

/** One row of the wire error table, `BTP_WIRE_ERRORS`. */
export type BTPWireErrorRule = {
  /** The error constant this row is for. */
  error: BTPError;
  status: BTPErrorStatus;
  /** Whether a sender may send the same artifact again later. */
  retryable: boolean;
  /** The constant sent in its place, when the precise reason stays on the server. */
  sentAs?: BTPError;
};

/** What `sendBtpsError` puts on the wire for an error. */
export type BTPWireError = {
  code: string;
  status: BTPErrorStatus;
  message: string;
  retryable: boolean;
};

export type BTPErrorResponse<T = unknown> = {
  data: T;
  errors: BTPError[];
};
