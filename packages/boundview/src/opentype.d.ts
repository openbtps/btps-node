/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// opentype.js ships no types; the snapshot reads a font through OpenTypeFont (snapshot/fonts.ts).
declare module 'opentype.js' {
  const opentype: { parse(buffer: ArrayBuffer): unknown };
  export default opentype;
}
