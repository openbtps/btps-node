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

  it('canonicalises the RFC 8785 §3.2.4 example', () => {
    const input = String.raw`{
      "numbers": [333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001],
      "string": "\u20ac$\u000F\u000aA'\u0042\u0022\u005c\\\"\/",
      "literals": [null, true, false]
    }`;
    expect(canonicalize(input)).toBe(
      String.raw`{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\u000f\nA'B\"\\\\\"/"}`,
    );
  });

  it('serialises the IEEE-754 values of RFC 8785 Appendix B', () => {
    const double = (hex) => {
      const view = new DataView(new ArrayBuffer(8));
      view.setBigUint64(0, BigInt(`0x${hex}`));
      return view.getFloat64(0);
    };
    const table = [
      ['0000000000000000', '0'],
      ['8000000000000000', '0'],
      ['0000000000000001', '5e-324'],
      ['8000000000000001', '-5e-324'],
      ['7fefffffffffffff', '1.7976931348623157e+308'],
      ['ffefffffffffffff', '-1.7976931348623157e+308'],
      ['4340000000000000', '9007199254740992'],
      ['c340000000000000', '-9007199254740992'],
      ['4430000000000000', '295147905179352830000'],
      ['44b52d02c7e14af5', '9.999999999999997e+22'],
      ['44b52d02c7e14af6', '1e+23'],
      ['44b52d02c7e14af7', '1.0000000000000001e+23'],
      ['444b1ae4d6e2ef4e', '999999999999999700000'],
      ['444b1ae4d6e2ef4f', '999999999999999900000'],
      ['444b1ae4d6e2ef50', '1e+21'],
      ['3eb0c6f7a0b5ed8c', '9.999999999999997e-7'],
      ['3eb0c6f7a0b5ed8d', '0.000001'],
      ['41b3de4355555553', '333333333.3333332'],
      ['41b3de4355555554', '333333333.33333325'],
      ['41b3de4355555555', '333333333.3333333'],
      ['41b3de4355555556', '333333333.3333334'],
      ['41b3de4355555557', '333333333.33333343'],
      ['becbf647612f3696', '-0.0000033333333333333333'],
      ['43143ff3c1cb0959', '1424953923781206.2'],
    ];
    for (const [hex, expected] of table) {
      expect(canonicalizeValue(double(hex)), hex).toBe(expected);
      expect(canonicalize(expected), hex).toBe(expected);
    }
    // NaN and Infinity have no JSON form.
    for (const hex of ['7fffffffffffffff', '7ff0000000000000']) {
      expect(() => canonicalizeValue(double(hex)), hex).toThrow(JcsError);
    }
  });

  it('rejects a duplicate member name, including one spelled with an escape', () => {
    expect(() => canonicalize('{"a":1,"a":1}')).toThrow(JcsError);
    expect(() => canonicalize('{"a":1,"\\u0061":2}')).toThrow(/duplicate member name/);
    expect(() => canonicalize('{"x":[{"b":1,"b":2}]}')).toThrow(/duplicate member name/);
  });

  it('reports where in the text a parse failure is', () => {
    let caught;
    try {
      canonicalize('{"a":1,"a":2}');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(JcsError);
    expect(typeof caught.position).toBe('number');
    expect(caught.message).toMatch(/at offset \d+/);
  });

  it('rejects lone surrogates in strings and member names, and numbers beyond a double', () => {
    expect(() => canonicalize('["\\ud800"]')).toThrow(/lone high surrogate/);
    expect(() => canonicalize('{"\\udc00":1}')).toThrow(/lone low surrogate/);
    expect(() => canonicalize('[1e400]')).toThrow(JcsError);
    expect(canonicalize('["\\ud83d\\ude00"]')).toBe('["😀"]');
  });

  it('refuses a member named "toJSON" rather than serialising it out of order', () => {
    expect(() => canonicalize('{"b":1,"toJSON":"x","a":2}')).toThrow(/toJSON/);
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
