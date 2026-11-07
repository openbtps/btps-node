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

// Each kind of artifact a server takes, by the kind a line is taken for: a line is
// held to its own kind's schema only, never passed by another kind's.
export const BtpArtifactSchemaByType = {
  agent: BtpAgentArtifactSchema,
  transporter: BtpTransporterArtifactSchema,
  control: BtpControlArtifactSchema,
  identityLookup: BtpIdentityLookupRequestSchema,
} as const;

// Union schema that can validate agent, transporter, control, or identity lookup artifacts
export const BtpArtifactServerSchema = z.union([
  BtpAgentArtifactSchema,
  BtpTransporterArtifactSchema,
  BtpControlArtifactSchema,
  BtpIdentityLookupRequestSchema,
]);
