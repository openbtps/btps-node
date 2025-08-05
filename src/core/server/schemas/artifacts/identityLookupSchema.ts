/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { z } from 'zod';
import { identitySchema } from '../shared.js';

// Schema for identity lookup request artifacts
export const BtpIdentityLookupRequestSchema = z.object({
  version: z.string(),
  id: z.string(),
  issuedAt: z.string().datetime(),
  identity: identitySchema,
  from: identitySchema,
  hostSelector: z.string(),
  identitySelector: z.string().optional(),
});
