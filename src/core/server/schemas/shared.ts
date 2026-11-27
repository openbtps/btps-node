/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { z } from 'zod';
import { isValidIdentity } from '@core/utils/identity.js';

// Schema for validating individual parameters
export const identitySchema = z
  .string()
  .regex(/^\S+\$\S+\.\S+$/, 'From field must match pattern: {username}${domain}')
  .refine(isValidIdentity, 'An identity has one separator and no ":"');

/**
 * Since 1.2 (rc.4): base64 in its one canonical form, as Buffer's toString('base64') writes it: no spaces or line
 * breaks, padded to a multiple of four, nothing after the padding. Node's decoder takes many other spellings of the
 * same bytes, so a signature's text, and with it the hash of anything that holds the signature, could be changed
 * without breaking the signature.
 */
export const BtpCanonicalBase64Schema = z
  .string()
  .min(4)
  .refine(
    (value) => Buffer.from(value, 'base64').toString('base64') === value,
    'base64 in its canonical form',
  );

/** Since 1.2 (rc.4): strict, its value canonical base64, so a signed object's text is the one form its signature has. */
export const BtpSignatureSchema = z
  .object({
    algorithmHash: z.literal('sha256'),
    value: BtpCanonicalBase64Schema,
    fingerprint: z.string(),
  })
  .strict();

/** Since 1.2 (rc.4): an identity written in lower case, as one inside a signed agreement structure must be. */
export const BtpLowerIdentitySchema = identitySchema.refine(
  (identity) => identity === identity.toLowerCase(),
  'an identity in a signed agreement structure is written in lower case',
);
