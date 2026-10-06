/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
// EBA-115: JCS canonicalization does not exist yet on baseline 367cd09.
// This import is expected to fail until src/core/crypto/jcs.ts is added.
import { canonicalize } from './jcs.js';

interface JcsVector {
  name: string;
  inputs: string[];
  expectedCanonical?: string;
  expectError?: boolean;
}

const vectors: JcsVector[] = JSON.parse(
  readFileSync(join(__dirname, '../../../test/vectors/jcs.vectors.json'), 'utf8'),
);

describe('canonicalize (JCS, RFC 8785)', () => {
  for (const vector of vectors) {
    if (vector.expectError) {
      it(`${vector.name}: rejects the input`, () => {
        expect(() => canonicalize(vector.inputs[0])).toThrow();
      });
      continue;
    }

    it(`${vector.name}: all inputs canonicalize to the same bytes`, () => {
      const outputs = vector.inputs.map((input) => canonicalize(input));
      for (const output of outputs) {
        expect(output).toBe(vector.expectedCanonical);
      }
    });
  }

  it('produces identical output for logically identical, differently-ordered objects', () => {
    const a = canonicalize('{"b":2,"a":1}');
    const b = canonicalize('{"a":1,"b":2}');
    expect(a).toBe(b);
  });

  it('rejects duplicate keys at any nesting depth', () => {
    expect(() => canonicalize('{"outer":{"x":1,"x":2}}')).toThrow();
  });

  it('is pure: canonicalizing the output again is a no-op', () => {
    const once = canonicalize('{"b":{"y":2,"x":1},"a":1}');
    const twice = canonicalize(once);
    expect(twice).toBe(once);
  });
});
