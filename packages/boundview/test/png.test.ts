/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * An image's pixels as the PNG the engine reads: exactly its stated pixels,
 * never a buffer larger than width × height × 4, whatever data it is given.
 */

import { describe, expect, it } from 'vitest';
import { unzlibSync, zlibSync } from 'fflate';
import { encodePng, pngOf } from '../src/png.js';

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

/** The IDAT pixels of a PNG this package made, without each row's filter byte. */
const pixelsOf = (png: Uint8Array, width: number) => {
  const view = new DataView(png.buffer, png.byteOffset);
  let at = 8;
  while (at < png.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    if (type === 'IDAT') {
      const rows = unzlibSync(png.subarray(at + 8, at + 8 + length));
      const out: number[] = [];
      for (let row = 0; row < rows.length; row += width * 4 + 1) out.push(...rows.subarray(row + 1, row + 1 + width * 4));
      return out;
    }
    at += 12 + length;
  }
  return [];
};

describe('an image as a PNG', () => {
  it('carries exactly its pixels', () => {
    const rgba = Uint8Array.from({ length: 2 * 2 * 4 }, (_, i) => i * 7);
    const png = Buffer.from(pngOf({ width: 2, height: 2, encoding: 'rgba8-deflate', data: base64(zlibSync(rgba)) }), 'base64');
    expect([...png.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
    expect(pixelsOf(png, 2)).toEqual([...rgba]);
  });

  // Making and reading the payload is slow on a busy runner, so it has time of its own.
  it('never inflates past width × height × 4 bytes, whatever the data holds', { timeout: 30_000 }, () => {
    // 64 MB of zeros for an image that states 2 by 2: the output is held to 16 bytes.
    const bomb = base64(zlibSync(new Uint8Array(64 * 1024 * 1024)));
    const png = Buffer.from(pngOf({ width: 2, height: 2, encoding: 'rgba8-deflate', data: bomb }), 'base64');
    expect(pixelsOf(png, 2)).toEqual(new Array(16).fill(0));
  });

  it('encodes any pixels as a PNG a reader accepts', () => {
    const png = encodePng(1, 1, new Uint8Array([255, 0, 0, 255]));
    expect(String.fromCharCode(...png.subarray(12, 16))).toBe('IHDR');
    expect(pixelsOf(png, 1)).toEqual([255, 0, 0, 255]);
  });
});
