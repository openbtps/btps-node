/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { canonicalize, canonicalizeValue, parseJson } from './jcs.js';
import { BTPErrorException } from '@core/error/index.js';

interface JcsVector {
  name: string;
  inputs: string[];
  expectedCanonical?: string;
  expectError?: boolean;
}

const vectors: JcsVector[] = JSON.parse(
  readFileSync(join(__dirname, '../../../test/vectors/jcs.vectors.json'), 'utf8'),
);

// The harness's reference JCS is the oracle: the SDK has its own
// implementation, which must agree with it on every vector.
const ORACLE = join(__dirname, '../../../packages/verify-btps-vectors/src/jcs.mjs');
type Oracle = { canonicalize: (jsonText: string) => string };
const loadOracle = async (): Promise<Oracle> => (await import(ORACLE)) as Oracle;

describe('EBA-115: canonicalize (JCS, RFC 8785)', () => {
  for (const vector of vectors) {
    if (vector.expectError) {
      it(`${vector.name}: rejects the input, as the oracle does`, async () => {
        const oracle = await loadOracle();
        for (const input of vector.inputs) {
          expect(() => canonicalize(input)).toThrow(BTPErrorException);
          expect(() => oracle.canonicalize(input)).toThrow();
        }
      });
      continue;
    }

    it(`${vector.name}: all inputs canonicalize to the same bytes, as the oracle's`, async () => {
      const oracle = await loadOracle();
      for (const input of vector.inputs) {
        const output = canonicalize(input);
        expect(output).toBe(vector.expectedCanonical);
        expect(output).toBe(oracle.canonicalize(input));
      }
    });
  }

  it('produces identical output for logically identical, differently-ordered objects', () => {
    const a = canonicalize('{"b":2,"a":1}');
    const b = canonicalize('{"a":1,"b":2}');
    expect(a).toBe(b);
  });

  it('rejects duplicate keys at any nesting depth', () => {
    expect(() => canonicalize('{"outer":{"x":1,"x":2}}')).toThrow(BTPErrorException);
    expect(() => canonicalize('[{"a":[{"k":1,"k":1}]}]')).toThrow(BTPErrorException);
  });

  it('reports a refusal with BTP_ERROR_CANONICAL_JSON and where it was found', () => {
    try {
      canonicalize('{"amountCents":100,"amountCents":200}');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(BTPErrorException);
      expect((error as BTPErrorException).code).toBe('BTP_ERROR_CANONICAL_JSON');
      expect((error as BTPErrorException).meta).toMatchObject({ position: 19 });
    }
  });

  it('is pure: canonicalizing the output again is a no-op', () => {
    const once = canonicalize('{"b":{"y":2,"x":1},"a":1}');
    const twice = canonicalize(once);
    expect(twice).toBe(once);
  });

  it('refuses malformed JSON that JSON.parse also refuses', () => {
    for (const bad of ['', '{', '{"a":}', '{"a":1,}', '[1,]', "{'a':1}", '01', '{"a":"\u0001"}']) {
      expect(() => canonicalize(bad), bad).toThrow(BTPErrorException);
    }
  });

  it('agrees with the oracle on a large generated document', async () => {
    const oracle = await loadOracle();
    const doc = {
      z: Array.from({ length: 50 }, (_, i) => ({ i, s: `line ${i} ☕`, n: i / 7, neg: -i })),
      a: { deep: { deeper: { deepest: [true, false, null, 1e21, 1e-7, 0.1] } } },
      '€': 'x'.repeat(10_000),
      '\u0080': '  ',
    };
    const text = JSON.stringify(doc);
    expect(canonicalize(text)).toBe(oracle.canonicalize(text));
  });
});

describe('EBA-115: parseJson (strict JSON.parse)', () => {
  it('returns what JSON.parse returns for valid JSON', () => {
    const text = '{"a":[1,2,{"b":null}],"c":"d\\n","e":-0.5e3,"f":true}';
    expect(parseJson(text)).toEqual(JSON.parse(text));
  });

  it('keeps "__proto__" as an own property, as JSON.parse does', () => {
    const parsed = parseJson<Record<string, unknown>>('{"__proto__":{"polluted":true}}');
    expect(Object.prototype.hasOwnProperty.call(parsed, '__proto__')).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
  });

  it('refuses a duplicate member name that JSON.parse would silently resolve', () => {
    const text = '{"to":"bob$example.com","to":"mallory$example.com"}';
    expect(JSON.parse(text).to).toBe('mallory$example.com');
    expect(() => parseJson(text)).toThrow(BTPErrorException);
  });
});

describe('EBA-115: canonicalizeValue', () => {
  it('canonicalizes what JSON.stringify would put on the wire', () => {
    expect(canonicalizeValue({ b: undefined, a: new Date(0), c: [undefined] })).toBe(
      '{"a":"1970-01-01T00:00:00.000Z","c":[null]}',
    );
  });

  it('refuses a value with no JSON form', () => {
    expect(() => canonicalizeValue(undefined)).toThrow(BTPErrorException);
    expect(() => canonicalizeValue(Number.NaN)).toThrow(BTPErrorException);
    expect(() => canonicalizeValue({ memo: '\ud800' })).toThrow(BTPErrorException);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalizeValue(cyclic)).toThrow(BTPErrorException);
  });
});
