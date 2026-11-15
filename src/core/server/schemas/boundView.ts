/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// `@btps/sdk/boundview`: a BoundView's schema, bindings and checks alone, for
// a browser or app that draws or captures one without the rest of the SDK.
export {
  BtpBoundViewSchema,
  isPathData,
  type BTPBoundView,
  type BTPBoundViewElement,
  type BTPBoundViewFont,
} from './boundViewSchema.js';
export { boundValue, bindingProblem, type BoundValue } from './boundViewBindings.js';
export {
  checkBoundView,
  boundViewResultOf,
  writtenValue,
  CONTRAST_WORK_LIMIT,
  type BTPBoundViewResult,
  type BTPBoundViewProblem,
  type BTPBoundViewCheck,
} from './boundViewChecks.js';
