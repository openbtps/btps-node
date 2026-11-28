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
}

/**
 * Since 1.2: `framer` on a Node stream. Bytes are written to it; each line comes out as one object,
 * decoded as the framer decodes it. It never throws: a line too large is `onOverflow`'s to answer.
 * Use it with `stream.pipeline`, or pipe a socket into it.
 */
export function lineFramerStream<T>(
  framer: BTPLineFramer<T>,
  options: BTPLineFramerStreamOptions = {},
): Transform {
  let told = false;
  const tell = (): void => {
    if (told || !framer.overflowed) return;
    told = true;
    options.onOverflow?.();
  };
  return new Transform({
    readableObjectMode: true,
    transform(chunk: Uint8Array, _encoding, callback) {
      for (const line of framer.push(chunk)) this.push(line);
      tell();
      callback();
    },
    flush(callback) {
      for (const line of framer.end()) this.push(line);
      callback();
    },
  });
}
