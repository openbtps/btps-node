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
      delimiter: 0x0a,
    };
    const { lines } = await run(framer, ['abc', 'de']);
    expect(lines).toEqual(['3', '2']);
    expect(framer.end).toHaveBeenCalledOnce();
  });

  it('lets each line in before its first byte, once, however its bytes are cut', async () => {
    const framer = BtpsLineFramer.utf8();
    const admit = vi.fn(() => true);
    const lines: string[] = [];
    const stream = lineFramerStream(framer, { admit });
    stream.on('data', (line: string) => lines.push(line));
    stream.write(Buffer.from('{"a":1}\n{"b"'));
    stream.write(Buffer.from(':2}\n\n{"c":3}\n'));
    stream.end();
    await new Promise((resolve) => stream.on('end', resolve));

    expect(lines).toEqual(['{"a":1}', '{"b":2}', '', '{"c":3}']);
    expect(admit).toHaveBeenCalledTimes(4);
  });

  it('reads nothing of a line while it waits to be let in', async () => {
    const framer = BtpsLineFramer.utf8();
    let letIn!: (ok: boolean) => void;
    const admit = vi.fn(() => new Promise<boolean>((resolve) => (letIn = resolve)));
    const lines: string[] = [];
    const stream = lineFramerStream(framer, { admit });
    stream.on('data', (line: string) => lines.push(line));
    stream.write(Buffer.from('{"a":1}\n'));
    await new Promise((resolve) => setImmediate(resolve));

    expect(admit).toHaveBeenCalledOnce();
    expect(framer.bufferedBytes).toBe(0);
    expect(lines).toEqual([]);

    letIn(true);
    await new Promise((resolve) => setImmediate(resolve));
    expect(lines).toEqual(['{"a":1}']);
  });

  it('tells once of a line refused, and drops it and every byte after it', async () => {
    const onRefused = vi.fn();
    const admit = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    const framer = BtpsLineFramer.utf8();
    const lines: string[] = [];
    await pipeline(
      Readable.from([Buffer.from('first\nsecond'), Buffer.from(' half\nthird\n')]),
      lineFramerStream(framer, { admit, onRefused }),
      new Writable({
        objectMode: true,
        write(line: string, _encoding, callback) {
          lines.push(line);
          callback();
        },
      }),
    );

    expect(lines).toEqual(['first']);
    expect(onRefused).toHaveBeenCalledOnce();
    expect(admit).toHaveBeenCalledTimes(2);
  });
});
