/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { z } from 'zod';
import { isValidIdentity } from '@core/utils/identity.js';

// An identity, by the same strict rules as parseIdentity (BTPS 1.1):
// exactly one `$`, no `:`, length capped before anything is read.
export const identitySchema = z
  .string()
  .refine(isValidIdentity, 'From field must match pattern: {username}${domain}');
