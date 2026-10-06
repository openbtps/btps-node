import { describe, expect, it } from 'vitest';
import { canonicalize, canonicalizeValue, JcsError, parseStrict } from '../src/jcs.mjs';

describe('reference JCS (RFC 8785)', () => {
  it('sorts member names by UTF-16 code unit, as in the RFC 8785 §3.2.3 example', () => {
    // RFC 8785 §3.2.3: the expected order is \r, 1, \u0080, \u00f6, \u20ac, 😀, \ufb33.
    const input =
      '{"\\u20ac":"Euro Sign","\\r":"Carriage Return","\\ufb33":"Hebrew Letter Dalet With Dagesh","1":"One","\\ud83d\\ude00":"Emoji: Grinning Face","\\u0080":"Control","\\u00f6":"Latin Small Letter O With Diaeresis"}';
    // Read the order from the text: Object.keys would hoist the integer-like "1".
    const keys = [...canonicalize(input).matchAll(/"((?:[^"\\]|\\.)*)":/g)].map((m) =>
      JSON.parse(`"${m[1]}"`),
    );
    expect(keys).toEqual(['\r', '1', '\u0080', '\u00f6', '\u20ac', '\ud83d\ude00', '\ufb33']);
  });

  it('formats numbers like ECMAScript, per RFC 8785 §3.2.2.3', () => {
    expect(canonicalize('[1E30, 4.50, 2e-3, 0.000001, 1e-7, -0]')).toBe(
      '[1e+30,4.5,0.002,0.000001,1e-7,0]',
    );
  });

  it('rejects a duplicate member name, including one spelled with an escape', () => {
    expect(() => canonicalize('{"a":1,"a":1}')).toThrow(JcsError);
    expect(() => canonicalize('{"a":1,"\\u0061":2}')).toThrow(/duplicate member name/);
  });

  it('treats "__proto__" as an ordinary member and does not touch Object.prototype', () => {
    const parsed = parseStrict('{"__proto__":{"polluted":true},"a":1}');
    expect(Object.getPrototypeOf(parsed)).toBeNull();
    expect({}.polluted).toBeUndefined();
    expect(canonicalize('{"a":1,"__proto__":2}')).toBe('{"__proto__":2,"a":1}');
  });

  it('rejects malformed JSON that JSON.parse would also reject', () => {
    for (const bad of [
      '',
      '{',
      '{"a":}',
      '[1,]',
      '{"a":1,}',
      '01',
      '"\u0001"',
      'nul',
      '\ufeff{}',
    ]) {
      expect(() => canonicalize(bad), JSON.stringify(bad)).toThrow(JcsError);
    }
  });

  it('is idempotent', () => {
    const once = canonicalize('{"b":{"y":[3,{"d":1,"c":2}],"x":"é"},"a":-1.50}');
    expect(canonicalize(once)).toBe(once);
  });

  it('canonicalises in-memory values the same way as their JSON text', () => {
    const value = { to: 'bob$x', amountCents: 150000, nested: { z: [true, null], a: 'ü' } };
    expect(canonicalizeValue(value)).toBe(canonicalize(JSON.stringify(value)));
  });

  it('refuses values JSON cannot carry', () => {
    expect(() => canonicalizeValue({ a: undefined })).toThrow(JcsError);
    expect(() => canonicalizeValue({ a: Number.NaN })).toThrow(JcsError);
    expect(() => canonicalizeValue({ a: Infinity })).toThrow(JcsError);
    expect(() => canonicalizeValue({ a: 1n })).toThrow(JcsError);
    expect(() => canonicalizeValue({ a: '\udc00' })).toThrow(/lone low surrogate/);
  });
});
