/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { z } from 'zod';
import { BtpAgentArtifactSchema } from './agentSchema.js';
import { BtpTransporterArtifactSchema } from './transporterSchema.js';
import { BtpControlArtifactSchema } from './controlSchema.js';
import { BtpIdentityLookupRequestSchema } from './identityLookupSchema.js';

// Union schema that can validate agent, transporter, control, or identity lookup artifacts
export const BtpArtifactServerSchema = z.union([
  BtpAgentArtifactSchema,
  BtpTransporterArtifactSchema,
  BtpControlArtifactSchema,
  BtpIdentityLookupRequestSchema,
]);
