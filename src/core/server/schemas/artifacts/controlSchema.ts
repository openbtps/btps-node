/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { z } from 'zod';
import { CONTROL_ACTIONS } from '../../constants/control.js';

// Schema for control artifacts
export const BtpControlArtifactSchema = z.object({
  version: z.string(),
  id: z.string(),
  issuedAt: z.string().datetime(),
  action: z.enum(CONTROL_ACTIONS),
});
