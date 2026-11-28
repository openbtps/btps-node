/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, expect, it } from 'vitest';
import { BtpsLineFramer } from './BtpsLineFramer.js';
import { BTPErrorException } from '@core/error/index.js';
import { BTP_ERROR_UNKNOWN } from '@core/error/constant.js';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const bytesOf = (count: number, char = 'a'): Uint8Array => bytes(char.repeat(count));

/** Every line a UTF-8 framer makes of `chunks`, the input ended after them. */
const linesOf = (chunks: Uint8Array[], maxLineBytes?: number): string[] => {
  const framer = BtpsLineFramer.utf8(maxLineBytes === undefined ? {} : { maxLineBytes });
  return [...chunks.flatMap((chunk) => [...framer.push(chunk)]), ...framer.end()];
};

describe('BtpsLineFramer', () => {
  it('makes a line of each run of bytes ended by a newline, without the newline', () => {
    expect(linesOf([bytes('{"a":1}\n{"b":2}\n')])).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('joins a line that arrives across many pieces, and returns it only when it ends', () => {
    const framer = BtpsLineFramer.utf8();
    expect(framer.push(bytes('{"doc'))).toEqual([]);
    expect(framer.push(bytes('ument":'))).toEqual([]);
    expect(framer.bufferedBytes).toBe(12);
    expect(framer.push(bytes('"x"}\n{"next'))).toEqual(['{"document":"x"}']);
    expect(framer.bufferedBytes).toBe('{"next'.length);
  });

  it('returns the last line on end when no newline followed it, and nothing for an empty tail', () => {
    expect(linesOf([bytes('{"a":1}\n{"b":2}')])).toEqual(['{"a":1}', '{"b":2}']);
    expect(linesOf([bytes('{"a":1}\n')])).toEqual(['{"a":1}']);
  });

  it('takes a carriage return off before the newline, as BTPS senders may write CRLF', () => {
    expect(linesOf([bytes('{"a":1}\r\n{"b":2}\n')])).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('splits only on the delimiter: a carriage return, U+2028 and U+2029 inside a line are its own', () => {
    const line = JSON.stringify({ text: 'a b c' });
    expect(linesOf([bytes(`${line}\n`)])).toEqual([line]);
    expect(linesOf([bytes('a\rb\n')])).toEqual(['a\rb']);
  });

  it('decodes a character whose bytes arrive in different pieces', () => {
    const euro = bytes('€\n');
    expect(linesOf([euro.subarray(0, 1), euro.subarray(1, 2), euro.subarray(2)])).toEqual(['€']);
  });

  it('keeps what it was given, so a caller may reuse its piece', () => {
    const framer = BtpsLineFramer.utf8();
    const piece = bytes('abc');
    framer.push(piece);
    piece.fill(0x7a);
    expect(framer.push(bytes('\n'))).toEqual(['abc']);
  });

  it('takes a line of exactly the limit, and counts each line on its own', () => {
    expect(linesOf([bytesOf(1024), bytes('\n'), bytesOf(1024), bytes('\n')], 1024)).toHaveLength(2);
  });

  it('counts bytes, not characters', () => {
    // 342 three-byte characters: 342 characters, 1026 bytes.
    const framer = BtpsLineFramer.utf8({ maxLineBytes: 1024 });
    framer.push(bytes(`${'€'.repeat(342)}\n`));
    expect(framer.overflowed).toBe(true);
  });

  it('stops at a line one byte over the limit: the lines before it, then nothing until reset', () => {
    const framer = BtpsLineFramer.utf8({ maxLineBytes: 1024 });
    expect(framer.push(bytes('{"a":1}\n'))).toEqual(['{"a":1}']);
    expect(framer.push(bytesOf(600))).toEqual([]);
    expect(framer.push(bytesOf(425))).toEqual([]);
    expect(framer.overflowed).toBe(true);
    expect(framer.bufferedBytes).toBe(0);
    expect(framer.push(bytes('\n{"b":2}\n'))).toEqual([]);
    expect(framer.end()).toEqual([]);
    framer.reset();
    expect(framer.overflowed).toBe(false);
    expect(framer.push(bytes('{"c":3}\n'))).toEqual(['{"c":3}']);
  });

  it('stops at a line over the limit that arrives whole inside one piece', () => {
    const framer = BtpsLineFramer.utf8({ maxLineBytes: 1024 });
    const lines = framer.push(
      new Uint8Array([...bytes('ok\n'), ...bytesOf(1025), ...bytes('\nlater\n')]),
    );
    expect(lines).toEqual(['ok']);
    expect(framer.overflowed).toBe(true);
  });

  it('frames with any one-byte delimiter, and any decoding given', () => {
    const framer = new BtpsLineFramer<number>({ decode: (line) => line.length, delimiter: 0x00 });
    expect(framer.push(new Uint8Array([1, 2, 3, 0, 4, 0]))).toEqual([3, 1]);
  });

  it('refuses options it cannot work with: only the SDK makes one, so they are a mistake of the SDK', () => {
    const decode = (line: Uint8Array) => line;
    for (const options of [
      { decode, maxLineBytes: 0 },
      { decode, maxLineBytes: -1 },
      { decode, maxLineBytes: 1.5 },
      { decode, maxLineBytes: Number.NaN },
      { decode, delimiter: 256 },
      { decode, delimiter: -1 },
      { decode: 'not a function' as unknown as typeof decode },
    ]) {
      expect(() => new BtpsLineFramer(options)).toThrow(BTPErrorException);
      expect(() => new BtpsLineFramer(options)).toThrow(
        expect.objectContaining({ code: BTP_ERROR_UNKNOWN.code }),
      );
    }
  });

  it('reads a long line in time that grows with it, not with its square (split2 took 13 s for 56 MB)', () => {
    const piece = bytesOf(16 * 1024);
    const time = (megabytes: number): number => {
      const framer = new BtpsLineFramer<number>({ decode: (line) => line.length });
      const pieces = (megabytes * 1024 * 1024) / piece.length;
      const started = performance.now();
      for (let at = 0; at < pieces; at++) framer.push(piece);
      expect(framer.push(bytes('\n'))).toEqual([megabytes * 1024 * 1024]);
      return performance.now() - started;
    };
    time(4);
    const small = time(16);
    const large = time(64);
    // Four times the bytes: about four times the time when linear, sixteen when quadratic.
    expect(large).toBeLessThan(small * 10 + 50);
    expect(large).toBeLessThan(2000);
  });
});
