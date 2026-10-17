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

export const BtpSignatureSchema = z.object({
  algorithmHash: z.literal('sha256'),
  value: z.string(),
  fingerprint: z.string(),
});
