/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { BTPErrorException } from '@core/error/index.js';
import { BTP_ERROR_UNKNOWN } from '@core/error/constant.js';
import type { BTPLineFramer, BTPLineFramerOptions } from './types.js';

const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const UTF8 = new TextDecoder('utf-8');

/** Only the SDK makes a framer, so options it cannot use are the SDK's own mistake, never a sender's. */
const refuse = (detail: string): BTPErrorException =>
  new BTPErrorException({
    ...BTP_ERROR_UNKNOWN,
    message: `Line framer options are not usable: ${detail}`,
  });

/**
 * Since 1.2, internal to the SDK: cuts bytes into lines, in time and memory that grow with the
 * line, not its square. What the server and the client read each connection with, in place of
 * split2; not exported.
 *
 * The bytes of a line not yet ended are kept as the pieces they came in. Only each new piece is
 * searched for the delimiter, and a line's pieces are joined once, when it ends. A line that passes
 * `maxLineBytes` is never joined: from then on nothing more is kept or returned until `reset()`, so
 * a peer cannot make it hold more than the limit. No I/O and no stream: it works wherever bytes are
 * (`lineFramerStream` puts one on a Node stream).
 */
export class BtpsLineFramer<T> implements BTPLineFramer<T> {
  readonly #decode: (line: Uint8Array) => T;
  readonly #maxLineBytes: number;
  readonly #delimiter: number;
  #pieces: Uint8Array[] = [];
  #size = 0;
  #overflowed = false;

  /** A framer whose lines are UTF-8 text, a carriage return before the newline taken off, as BTPS sends them. */
  static utf8(
    options: Omit<BTPLineFramerOptions<string>, 'decode' | 'delimiter'> = {},
  ): BtpsLineFramer<string> {
    return new BtpsLineFramer<string>({
      ...options,
      decode: (line) =>
        UTF8.decode(line[line.length - 1] === CARRIAGE_RETURN ? line.subarray(0, -1) : line),
    });
  }

  constructor(options: BTPLineFramerOptions<T>) {
    const { decode, maxLineBytes = Number.POSITIVE_INFINITY, delimiter = NEWLINE } = options;
    if (typeof decode !== 'function') throw refuse('decode must be a function');
    if (
      maxLineBytes !== Number.POSITIVE_INFINITY &&
      (!Number.isSafeInteger(maxLineBytes) || maxLineBytes < 1)
    ) {
      throw refuse('maxLineBytes must be a whole number above 0');
    }
    if (!Number.isInteger(delimiter) || delimiter < 0 || delimiter > 0xff)
      throw refuse('delimiter must be one byte');
    this.#decode = decode;
    this.#maxLineBytes = maxLineBytes;
    this.#delimiter = delimiter;
  }

  get bufferedBytes(): number {
    return this.#size;
  }

  get overflowed(): boolean {
    return this.#overflowed;
  }

  get delimiter(): number {
    return this.#delimiter;
  }

  push(chunk: Uint8Array): readonly T[] {
    if (this.#overflowed) return [];
    const lines: T[] = [];
    let from = 0;
    for (
      let end = chunk.indexOf(this.#delimiter);
      end !== -1;
      end = chunk.indexOf(this.#delimiter, from)
    ) {
      if (!this.#hold(chunk.subarray(from, end))) return lines;
      lines.push(this.#take());
      from = end + 1;
    }
    this.#hold(chunk.subarray(from));
    return lines;
  }

  end(): readonly T[] {
    if (this.#overflowed || this.#size === 0) {
      this.reset();
      return [];
    }
    const last = this.#take();
    return [last];
  }

  reset(): void {
    this.#pieces = [];
    this.#size = 0;
    this.#overflowed = false;
  }

  /**
   * Keeps a copy of `piece` as part of the line not yet ended, so a caller may reuse what it gave; false, keeping
   * nothing more, once that passes the limit.
   */
  #hold(piece: Uint8Array): boolean {
    if (this.#size + piece.length > this.#maxLineBytes) {
      this.#pieces = [];
      this.#size = 0;
      this.#overflowed = true;
      return false;
    }
    if (piece.length > 0) {
      this.#pieces.push(new Uint8Array(piece));
      this.#size += piece.length;
    }
    return true;
  }

  /** The line held, joined once and decoded; nothing is held after it. */
  #take(): T {
    const line =
      this.#pieces.length === 1
        ? (this.#pieces[0] as Uint8Array)
        : joined(this.#pieces, this.#size);
    this.#pieces = [];
    this.#size = 0;
    return this.#decode(line);
  }
}

/** `pieces` as one array of `size` bytes. */
const joined = (pieces: readonly Uint8Array[], size: number): Uint8Array => {
  const line = new Uint8Array(size);
  let at = 0;
  for (const piece of pieces) {
    line.set(piece, at);
    at += piece.length;
  }
  return line;
};
