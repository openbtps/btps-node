/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { assertStrictJson, canonicalize, canonicalizeValue } from './jcs.js';
import { BTPErrorException } from '@core/error/index.js';
import { BTP_ERROR_CANONICAL_JSON } from '@core/error/constant.js';

interface JcsVector {
  name: string;
  inputs: string[];
  expectedCanonical?: string;
  expectError?: boolean;
}

const vectors: JcsVector[] = JSON.parse(
  readFileSync(join(__dirname, '../../../test/vectors/jcs.vectors.json'), 'utf8'),
);

const expectCanonicalJsonError = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(BTPErrorException);
    expect(error).toMatchObject({ code: BTP_ERROR_CANONICAL_JSON.code });
    return;
  }
  throw new Error('expected BTP_ERROR_CANONICAL_JSON');
};

describe('canonicalize (JCS, RFC 8785)', () => {
  for (const vector of vectors) {
    if (vector.expectError) {
      it(`${vector.name}: rejects the input`, () => {
        expectCanonicalJsonError(() => canonicalize(vector.inputs[0] ?? ''));
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
    expectCanonicalJsonError(() => canonicalize('{"outer":{"x":1,"x":2}}'));
    expectCanonicalJsonError(() => canonicalize('[{"a":[{"x":1,"x":2}]}]'));
  });

  it('is pure: canonicalizing the output again is a no-op', () => {
    const once = canonicalize('{"b":{"y":2,"x":1},"a":1}');
    const twice = canonicalize(once);
    expect(twice).toBe(once);
  });

  it('matches the RFC 8785 section 3.2.4 example', () => {
    const input =
      '{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],' +
      '"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/",' +
      '"literals":[null,true,false]}';
    expect(canonicalize(input)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],' +
        '"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it('rejects text that is not JSON', () => {
    expectCanonicalJsonError(() => canonicalize('{"a":1'));
    expectCanonicalJsonError(() => canonicalize(''));
    expectCanonicalJsonError(() => canonicalize('"\u0001"'));
    expectCanonicalJsonError(() => canonicalize('﻿{}'));
  });
});

describe('canonicalizeValue', () => {
  it('canonicalizes what JSON.stringify would send: undefined members dropped, toJSON applied', () => {
    const value = { b: undefined, a: new Date(0), c: [undefined] };
    expect(canonicalizeValue(value)).toBe('{"a":"1970-01-01T00:00:00.000Z","c":[null]}');
  });

  it('gives the same bytes as canonicalize on the JSON text of the value', () => {
    const value = { z: { y: 2, x: 1 }, a: 'é', n: 100 };
    expect(canonicalizeValue(value)).toBe(canonicalize(JSON.stringify(value)));
  });

  it('refuses a value with no JSON form, and numbers RFC 8785 cannot carry', () => {
    expectCanonicalJsonError(() => canonicalizeValue(undefined));
    expectCanonicalJsonError(() => canonicalizeValue({ n: 2n }));
    expectCanonicalJsonError(() => canonicalizeValue('\ud800'));
  });
});

describe('assertStrictJson', () => {
  it('accepts JSON with distinct member names', () => {
    expect(() => assertStrictJson('{"a":{"b":1},"c":[{"b":2}]}')).not.toThrow();
  });

  it('refuses a member named twice, including after unescaping', () => {
    expectCanonicalJsonError(() => assertStrictJson('{"a":1,"a":2}'));
    expectCanonicalJsonError(() => assertStrictJson('{"a":1,"\\u0061":2}'));
  });
});
