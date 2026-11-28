/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { Transform } from 'stream';
import type { BTPLineFramer } from './types.js';

/** Since 1.2: what `lineFramerStream` does beside framing. */
export interface BTPLineFramerStreamOptions {
  /**
   * Called once, when a line passes the framer's limit. The stream goes on taking bytes and drops
   * them, so a peer still sending is not stopped in the middle, and the caller can answer and end
   * the connection gently.
   */
  onOverflow?: () => void;
  /**
   * Asked before the first byte of each line is taken, so every line that comes out was let in
   * first, in order. A promise holds the line's bytes, and so the connection, until it settles:
   * nothing more is read and TCP slows the peer. False refuses the line.
   */
  admit?: () => boolean | Promise<boolean>;
  /**
   * Called once, when `admit` refuses a line. As after an overflow, the stream goes on taking bytes
   * and drops them, and lets no more lines in.
   */
  onRefused?: () => void;
}

/**
 * Since 1.2: `framer` on a Node stream. Bytes are written to it; each line comes out as one object,
 * decoded as the framer decodes it. It never throws: a line too large is `onOverflow`'s to answer,
 * one refused `onRefused`'s. Use it with `stream.pipeline`, or pipe a socket into it.
 */
export function lineFramerStream<T>(
  framer: BTPLineFramer<T>,
  options: BTPLineFramerStreamOptions = {},
): Transform {
  const { admit } = options;
  let told = false;
  const tell = (): void => {
    if (told || !framer.overflowed) return;
    told = true;
    options.onOverflow?.();
  };
  // Whether the line being read was let in; once one is refused, no more are.
  let open = false;
  let refused = false;

  /** `chunk` a line at a time, each line let in before its first byte reaches the framer. */
  const take = async (
    stream: Transform,
    chunk: Uint8Array,
    letIn: () => boolean | Promise<boolean>,
  ): Promise<void> => {
    let rest = chunk;
    while (rest.length > 0 && !refused && !framer.overflowed) {
      if (!open) {
        if (!(await letIn())) {
          refused = true;
          options.onRefused?.();
          return;
        }
        open = true;
      }
      const end = rest.indexOf(framer.delimiter);
      for (const line of framer.push(end === -1 ? rest : rest.subarray(0, end + 1))) {
        stream.push(line);
      }
      tell();
      if (end === -1) return;
      open = false;
      rest = rest.subarray(end + 1);
    }
  };

  return new Transform({
    readableObjectMode: true,
    transform(chunk: Uint8Array, _encoding, callback) {
      if (!admit) {
        for (const line of framer.push(chunk)) this.push(line);
        tell();
        callback();
        return;
      }
      take(this, chunk, admit).then(() => callback(), callback);
    },
    flush(callback) {
      for (const line of framer.end()) this.push(line);
      callback();
    },
  });
}
