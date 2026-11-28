/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Since 1.2: what cuts a stream of bytes into lines, one artifact to a line. The server and the
 * client depend on this, not on a class: any implementation may be given to them
 * (`BtpsServerOptions.lineFramer`, `BTPClientOptions.lineFramer`).
 */
export interface BTPLineFramer<T> {
  /**
   * Takes the next bytes. Returns every line they complete, in order, without its delimiter.
   * Once a line passes the limit, returns the lines before it and nothing more until `reset()`
   * (or `end()`, which resets).
   */
  push(chunk: Uint8Array): readonly T[];
  /** The input has ended: the last line, when it had no delimiter after it; then it starts afresh, as `reset()`. */
  end(): readonly T[];
  /** Forgets what it holds and starts afresh, as for a new connection. */
  reset(): void;
  /** Bytes held of the line not yet ended. */
  readonly bufferedBytes: number;
  /** Whether a line has passed the limit since the last `reset()`. */
  readonly overflowed: boolean;
}

/** Since 1.2: how a `BtpsLineFramer` frames, and what it makes of each line. */
export interface BTPLineFramerOptions<T> {
  /** What a line's bytes become. Called once for each line, with its delimiter taken off. */
  decode: (line: Uint8Array) => T;
  /** The most bytes one line may hold, its delimiter not counted. A whole number above 0; no limit when not given. */
  maxLineBytes?: number;
  /** The byte that ends a line: 0x0a (`\n`) when not given. */
  delimiter?: number;
}

/** Since 1.2: what a framer for one connection is made with (`BtpsServerOptions.lineFramer`). */
export interface BTPLineFramerLimits {
  /** The most bytes one line may hold; `Infinity` for no limit. */
  maxLineBytes: number;
}

/** Since 1.2: makes the framer for one connection. Each connection has its own: a framer holds its line. */
export type BTPLineFramerFactory = (limits: BTPLineFramerLimits) => BTPLineFramer<string>;
