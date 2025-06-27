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

export type BTPErrorResponse<T = unknown> = {
  data: T;
  errors: BTPError[];
};
