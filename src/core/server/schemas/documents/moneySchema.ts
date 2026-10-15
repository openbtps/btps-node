/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { z } from 'zod';
import { CURRENCY_CODES } from '../../constants/currency.js';

/**
 * Money in document model v2: an integer amount in the currency's minor unit
 * plus its ISO 4217 code. `{ amount: 12345, currency: 'AUD' }` is AUD 123.45.
 * Never a float. `.safe()` also refuses amounts beyond
 * Number.MAX_SAFE_INTEGER, which JSON and RFC 8785 cannot carry exactly.
 */
export const BtpMoneySchema = z.object({
  amount: z.number().int().safe(),
  currency: z.enum(CURRENCY_CODES),
});

/**
 * A rate or quantity carried as a decimal string ("32.50", "38"). It is for
 * display only: nothing in the SDK parses it to a float or recomputes an
 * amount from it. The signed amount on the line is what the issuer states.
 */
export const BtpDecimalStringSchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, 'must be a decimal string, e.g. "32.50" or "38"');
