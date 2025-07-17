/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { z } from 'zod';
import { BtpAgentArtifactSchema } from './agentSchema.js';
import { BtpTransporterArtifactSchema } from './transporterSchema.js';

// Union schema that can validate either agent or transporter artifacts
export const BtpArtifactServerSchema = z.union([
  BtpAgentArtifactSchema,
  BtpTransporterArtifactSchema,
]);
