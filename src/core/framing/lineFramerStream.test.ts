/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { Readable, Writable } from 'stream';
import { pipeline } from 'stream/promises';
import { describe, expect, it, vi } from 'vitest';
import { BtpsLineFramer } from './BtpsLineFramer.js';
import { lineFramerStream } from './lineFramerStream.js';
import type { BTPLineFramer } from './types.js';

/** Every line `framer` makes of `chunks` through a stream, and how often it said a line was too large. */
const run = async <T>(
  framer: BTPLineFramer<T>,
  chunks: string[],
): Promise<{ lines: T[]; overflows: number }> => {
  const lines: T[] = [];
  let overflows = 0;
  await pipeline(
    Readable.from(chunks.map((chunk) => Buffer.from(chunk))),
    lineFramerStream(framer, { onOverflow: () => (overflows += 1) }),
    new Writable({
      objectMode: true,
      write(line: T, _encoding, callback) {
        lines.push(line);
        callback();
      },
    }),
  );
  return { lines, overflows };
};

describe('lineFramerStream', () => {
  it('puts a framer on a stream: each line one object, the last one when the input ends', async () => {
    const { lines, overflows } = await run(BtpsLineFramer.utf8(), [
      '{"a":1}\n{"b"',
      ':2}\n{"c":3}',
    ]);
    expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
    expect(overflows).toBe(0);
  });

  it('tells once of a line too large, drops the rest, and never fails the stream', async () => {
    const { lines, overflows } = await run(BtpsLineFramer.utf8({ maxLineBytes: 1024 }), [
      'before\n',
      'a'.repeat(600),
      'a'.repeat(600),
      'a'.repeat(5000),
      '\nafter\n',
    ]);
    expect(lines).toEqual(['before']);
    expect(overflows).toBe(1);
  });

  it('works with any framer given, not only BtpsLineFramer', async () => {
    const framer: BTPLineFramer<string> = {
      push: vi.fn((chunk: Uint8Array) => [String(chunk.length)]),
      end: vi.fn(() => []),
      reset: vi.fn(),
      bufferedBytes: 0,
      overflowed: false,
    };
    const { lines } = await run(framer, ['abc', 'de']);
    expect(lines).toEqual(['3', '2']);
    expect(framer.end).toHaveBeenCalledOnce();
  });
});
