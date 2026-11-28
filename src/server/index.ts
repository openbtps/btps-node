/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

export * from '@core/server/types.js';
export * from '@core/server/constants/index.js';
export { BtpsServer } from './btpsServer.js';
// Since 1.2: how many attachments a provider takes, by type (`maxAttachments`).
export {
  type BTPAttachmentLimits,
  type BTPAttachingDocumentType,
} from '@core/server/schemas/attachmentLimits.js';
// A platform checks an encrypted event's chain with these once it has opened it.
export {
  lifecycleEventChainProblem,
  lifecycleEventChainReference,
  lifecycleEventSenderProblem,
  trustRequestProblem,
  trustResponseProblem,
} from '@core/server/schemas/helpers.js';
// Whether a BoundView may be shown, and each bound value as a receiver draws it.
export {
  checkBoundView,
  writtenValue,
  CONTRAST_WORK_LIMIT,
  type BTPBoundViewResult,
  type BTPBoundViewProblem,
  type BTPBoundViewCheck,
} from '@core/server/schemas/boundViewChecks.js';
// A provider wraps an encrypted result's content key to the device that asked.
export { wrapForAgent } from './libs/wrapForAgent.js';
// Who signed a transporter artifact, checked as this server checks it on arrival.
export { verifyTransporterSignature } from '@core/delegation/verifyTransporterSignature.js';
export * from './types.js';
