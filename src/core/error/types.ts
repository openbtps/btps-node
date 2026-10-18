/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

export type BTPError = {
  code?: string | number;
  message: string;
  /** The numeric status a server answers this error with (4xx: do not resend as is; 429 and 5xx: resend later) */
  status?: number;
};

export type BTPErrorResponse<T = unknown> = {
  data: T;
  errors: BTPError[];
};
