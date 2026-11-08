/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { z } from 'zod';
import { identitySchema } from '../shared.js';
import { isVersionBelow } from '../../constants/index.js';

// Schema for identity lookup request artifacts: these members only, so no other kind of artifact passes as one
export const BtpIdentityLookupRequestSchema = z
  .object({
    version: z.string(),
    id: z.string(),
    issuedAt: z.string().datetime(),
    identity: identitySchema,
    from: identitySchema,
    hostSelector: z.string(),
    identitySelector: z.string().optional(),
    // Since 1.2, under 1.2.0 only: answer with the identity's key chain too.
    keyChain: z.literal(true).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.keyChain !== undefined && isVersionBelow(data.version, '1.2.0')) {
      ctx.addIssue({
        path: ['keyChain'],
        code: z.ZodIssueCode.custom,
        message: 'keyChain is only in a 1.2.0 lookup',
      });
    }
  });
