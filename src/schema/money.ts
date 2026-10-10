/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { z } from 'zod';
import { CURRENCY_CODES } from '@core/server/constants/currency.js';

/**
 * Money, document model v2 (EBA-103 §2; EBA-119).
 *
 * Always an integer amount in the currency's minor unit (e.g. cents) plus its
 * ISO 4217 code — `{ amount: 12345, currency: 'AUD' }` means AUD 123.45.
 * Never a float, in any signed field. `.safe()` additionally rejects amounts
 * outside Number.MAX_SAFE_INTEGER, since money is never represented as
 * BigInt in this codebase (see src/core/server/schemas/btpsDocsSchema.ts for
 * the v1 precedent this corrects).
 */
export const MoneySchema = z.object({
  amount: z.number().int().safe(),
  currency: z.enum(CURRENCY_CODES),
});

export type Money = z.infer<typeof MoneySchema>;

/**
 * A rate or quantity, carried as a decimal string (e.g. "32.50", "38").
 * This is descriptive only: document-model never parses it to a float and
 * never recomputes amount = rate * quantity (EBA-119 acceptance criteria).
 * The signed `amount` on the line is what the issuer states.
 */
export const DecimalStringSchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, 'must be a decimal string, e.g. "32.50" or "38"');
