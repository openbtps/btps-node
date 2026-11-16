/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

export { renderBoundView, initBoundViewEngine, type BoundViewEngineSource } from './render.js';
export { boundViewToSvg } from './svg.js';
export {
  SIGNATURE_STROKE,
  signatureDrawing,
  signatureSvg,
  type SignatureDrawing,
} from './signature.js';
export {
  bundledCharactersFor,
  bundledFontsFor,
  loadBundledFonts,
  type BundledFontName,
  type BundledFonts,
} from './glyphs.js';
export {
  snapshotBoundView,
  BoundViewSnapshotError,
  type SnapshotOptions,
} from './snapshot/index.js';
