/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// opentype.js ships no types; the snapshot reads a font through OpenTypeFont (snapshot/fonts.ts). Its ES module build
// names `parse` and has no default export; its UMD build, which Node loads, is a default export holding `parse`.
declare module 'opentype.js' {
  export const parse: ((buffer: ArrayBuffer) => unknown) | undefined;
}
