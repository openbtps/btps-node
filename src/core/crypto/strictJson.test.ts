/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */
import { describe, expect, it } from 'vitest';
import { assertStrictJson } from './jcs.js';
import { MAX_DEPTH, isStrictJson, strictJsonCheck } from './strictJson.js';

/** What decryptBtpPayload took before: assertStrictJson, then JSON.parse. */
const takenWhole = (text: string): boolean => {
  try {
    assertStrictJson(text);
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
};

const deep = (depth: number) => `${'['.repeat(depth)}1${']'.repeat(depth)}`;

const CORPUS = [
  '{}',
  '[]',
  '{"amount":100,"currency":"AUD"}',
  '{"a":[{"b":1},{"b":2}],"c":{"b":3}}',
  '{"amount":100,"amount":1}',
  '{"totalAmount":{"amount":100,"amount":1}}',
  '[{"a":1,"a":2}]',
  '{"a":1,"\\u0061":2}',
  '{"é":1,"\\u00e9":2}',
  '{"a":{"x":1},"b":{"x":1}}',
  '{"😀":1,"\\ud83d\\ude00":2}',
  '{"lone":"\\ud800"}',
  '{"n":[-0,0.5,1e400,-1.5E-3,123456789012345678901234567890]}',
  '{"n":01}',
  '{"n":1.}',
  '{"n":.5}',
  '{"n":+1}',
  '{"n":NaN}',
  '{"a":1,}',
  '[1,]',
  "{'a':1}",
  '{"a":1}//c',
  '{"a":1} 2',
  '1 2',
  '',
  '   ',
  'true',
  'null',
  '"text"',
  '﻿{"a":1}',
  '{"a":"tab\there"}',
  '{"a":"line\\nbreak"}',
  '{"a":"\\/\\b\\f\\r\\t\\"\\\\"}',
  '{"a":"\\x41"}',
  '{"a":"\\u00G1"}',
  '{\n  "pretty": [\n    1,\n    2\n  ]\n}',
  '{"a"\u0001:1}',
  '{"a":1}\u0000',
  deep(5000),
  `{"big":"${'A'.repeat(3_000_000)}","big":1}`,
];

describe('the strict JSON check a piece at a time', () => {
  it.each(CORPUS.map((text) => [text.slice(0, 40), text]))(
    'takes %j only when assertStrictJson and JSON.parse do',
    (_label, text) => {
      expect(isStrictJson(text)).toBe(takenWhole(text));
    },
  );

  it('answers the same however the text is cut, a member name or a surrogate pair cut in two', () => {
    for (const text of [
      '{"abcdef":1,"abcdef":2}',
      '{"😀😀":"😀","x":[1,{"y":"\\u00e9"}]}',
      deep(50),
    ]) {
      for (let size = 1; size <= 5; size += 1) {
        const check = strictJsonCheck();
        let taken = true;
        try {
          for (let from = 0; from < text.length; from += size)
            check.add(text.slice(from, from + size));
          check.end();
        } catch {
          taken = false;
        }
        expect(taken).toBe(takenWhole(text));
      }
    }
  });

  it('refuses nesting deeper than MAX_DEPTH, where assertStrictJson takes it until it runs out of stack', () => {
    expect(isStrictJson(deep(MAX_DEPTH))).toBe(true);
    expect(isStrictJson(deep(MAX_DEPTH + 1))).toBe(false);
    expect(takenWhole(deep(1500))).toBe(true);
  });

  it('refuses a raw control character in a string, which JSON.parse refuses after assertStrictJson takes it', () => {
    const text = '{"a":"raw\u0001control"}';
    expect(() => assertStrictJson(text)).not.toThrow();
    expect(isStrictJson(text)).toBe(false);
  });
});
