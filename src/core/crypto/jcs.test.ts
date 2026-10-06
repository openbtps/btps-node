/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/*
 * Expected failures (`it.fails`) until EBA-115 adds src/core/crypto/jcs.ts.
 * On baseline 367cd09 that module does not exist, so every test fails when it
 * loads it. ./jcs.js is imported inside each test, not at the top of the file,
 * so this file still loads and runs. When EBA-115 lands every test here turns
 * red; that change must flip `it.fails` to `it` (and may restore a static
 * import). Same ratchet as test/vectors/known-failing.json.
 */
const XFAIL = 'expected failure until EBA-115 lands';

type Canonicalize = (jsonText: string) => string;

async function loadCanonicalize(): Promise<Canonicalize> {
  // A variable specifier keeps tsc from resolving a module that does not exist yet.
  const specifier = './jcs.js';
  const mod = await import(/* @vite-ignore */ specifier);
  if (typeof mod.canonicalize !== 'function') {
    throw new Error('src/core/crypto/jcs.ts does not export canonicalize');
  }
  return mod.canonicalize as Canonicalize;
}

interface JcsVector {
  name: string;
  inputs: string[];
  expectedCanonical?: string;
  expectError?: boolean;
}

const vectors: JcsVector[] = JSON.parse(
  readFileSync(join(__dirname, '../../../test/vectors/jcs.vectors.json'), 'utf8'),
);

describe('EBA-115: canonicalize (JCS, RFC 8785)', () => {
  for (const vector of vectors) {
    if (vector.expectError) {
      it.fails(`${vector.name}: rejects the input (${XFAIL})`, async () => {
        const canonicalize = await loadCanonicalize();
        expect(() => canonicalize(vector.inputs[0])).toThrow();
      });
      continue;
    }

    it.fails(`${vector.name}: all inputs canonicalize to the same bytes (${XFAIL})`, async () => {
      const canonicalize = await loadCanonicalize();
      const outputs = vector.inputs.map((input) => canonicalize(input));
      for (const output of outputs) {
        expect(output).toBe(vector.expectedCanonical);
      }
    });
  }

  it.fails(
    `produces identical output for logically identical, differently-ordered objects (${XFAIL})`,
    async () => {
      const canonicalize = await loadCanonicalize();
      const a = canonicalize('{"b":2,"a":1}');
      const b = canonicalize('{"a":1,"b":2}');
      expect(a).toBe(b);
    },
  );

  it.fails(`rejects duplicate keys at any nesting depth (${XFAIL})`, async () => {
    const canonicalize = await loadCanonicalize();
    expect(() => canonicalize('{"outer":{"x":1,"x":2}}')).toThrow();
  });

  it.fails(`is pure: canonicalizing the output again is a no-op (${XFAIL})`, async () => {
    const canonicalize = await loadCanonicalize();
    const once = canonicalize('{"b":{"y":2,"x":1},"a":1}');
    const twice = canonicalize(once);
    expect(twice).toBe(once);
  });
});
