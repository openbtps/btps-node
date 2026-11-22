/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * A drawn signature as SVG markup (signature.ts): its numbers are written as
 * numbers, and its colour only as a colour, so nothing a platform passes in
 * can become markup of its own.
 */

import { describe, expect, it } from 'vitest';
import { signatureShapes, signatureSvg } from '../src/signature.js';

const strokes = [
  [100, 200, 300, 80],
  [500, 60],
];

describe('signatureSvg', () => {
  it.each(['currentColor', '#1e3a8a', '#1e3a8acc', '#fff', '#ffff'])('draws in %s', (colour) => {
    expect(signatureSvg(strokes, colour)).toContain(`"${colour}"`);
  });

  it.each([
    'red',
    '#12345',
    '"/><script>alert(1)</script><x a="',
    'currentColor" onload="x',
    'url(#a)',
  ])('refuses %s as a colour, and writes no markup', (colour) => {
    expect(() => signatureSvg(strokes, colour)).toThrow(TypeError);
    expect(() => signatureShapes(strokes, (x, y) => [x, y], 1, colour)).toThrow(TypeError);
  });
});
