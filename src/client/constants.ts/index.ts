/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import type { BTPError } from '@core/error/types.js';

export const BTP_TRANSPORTER_DEFAULT_MAX_CONNECTIONS = 10;
export const BTP_TRANSPORTER_DEFAULT_CONNECTION_TTL_SECONDS = 300;

export const BTP_TRANSPORTER_ERROR_CONNECTION_ALREADY_EXISTS: BTPError = {
  code: 'BTP_TRANSPORTER_ERROR_CONNECTION_ALREADY_EXISTS',
  message: 'Connection already exists',
};

export const BTP_TRANSPORTER_ERROR_MAX_CONNECTIONS_REACHED: BTPError = {
  code: 'BTP_TRANSPORTER_ERROR_MAX_CONNECTIONS_REACHED',
  message: 'Max connections reached',
};
