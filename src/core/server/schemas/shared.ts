/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { z } from 'zod';

// Schema for validating individual parameters
export const identitySchema = z
  .string()
  .regex(/^\S+\$\S+\.\S+$/, 'From field must match pattern: {username}${domain}');
