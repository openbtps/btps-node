/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * Since 1.2: the strict JSON a decrypted document is held to (jcs.ts,
 * assertStrictJson), checked a piece at a time as it is read, never building
 * the whole of it: JSON, and no member named twice in any object, at any
 * depth. What it reads is tokens from stream-json's tokenizer; what it keeps
 * is the names of the members of each object it is in.
 *
 * Stricter than assertStrictJson in two ways, each said: a raw control
 * character inside a string is refused here, where assertStrictJson lets it
 * through and JSON.parse then refuses it; and objects and arrays nested more
 * than MAX_DEPTH deep are refused, where assertStrictJson runs out of stack at
 * a depth that depends on the machine. decryptBtpPayload asks assertStrictJson
 * itself of a text this refuses, so it answers as it always did.
 */
import { jsonParser } from 'stream-json/core/parser.js';
import { BTP_ERROR_CANONICAL_JSON } from '@core/error/constant.js';
import { BTPErrorException } from '@core/error/index.js';

/** stream-json's markers (stream-chain's defs): the end of the input, and several tokens at once. */
const END = Symbol.for('object-stream.none');
const MANY = Symbol.for('object-stream.many');

type Token = { name: string; value?: unknown };
type Tokens = Token | { [MANY]: 1; values: Token[] } | symbol | undefined;

const tokensOf = (out: Tokens): Token[] => {
  if (out === undefined || typeof out === 'symbol') return [];
  return MANY in out ? out.values : [out];
};

const notStrict = (cause: unknown) => new BTPErrorException(BTP_ERROR_CANONICAL_JSON, { cause });

/** The deepest a document's objects and arrays nest. A BTPS document is a few deep. */
export const MAX_DEPTH = 1024;

/** Text a piece at a time: `add` each, then `end`. Each throws BTP_ERROR_CANONICAL_JSON when it is not strict JSON. */
export interface StrictJsonCheck {
  add(text: string): void;
  end(): void;
}

export const strictJsonCheck = (): StrictJsonCheck => {
  const tokenize = jsonParser({
    packKeys: true,
    streamKeys: false,
    packStrings: false,
    packNumbers: false,
    maxDepth: MAX_DEPTH,
    maxPackedLength: Infinity,
    // A leading byte-order mark is no JSON, as JSON.parse holds it.
    ignoreBOM: true,
  }) as unknown as (input: string | symbol) => Tokens;
  // For each object or array the reader is in: the names its object has had; none for an array.
  const names: (Set<string> | null)[] = [];
  const read = (out: Tokens) => {
    for (const { name, value } of tokensOf(out)) {
      if (name === 'startObject') names.push(new Set());
      else if (name === 'startArray') names.push(null);
      else if (name === 'endObject' || name === 'endArray') names.pop();
      else if (name === 'keyValue') {
        const seen = names[names.length - 1];
        const key = String(value);
        if (seen?.has(key)) throw notStrict(`duplicate member name "${key}"`);
        seen?.add(key);
      }
    }
  };
  const run = (input: string | symbol) => {
    try {
      read(tokenize(input));
    } catch (error) {
      throw error instanceof BTPErrorException ? error : notStrict(error);
    }
  };
  return { add: (text) => run(text), end: () => run(END) };
};

/** How much of a whole text is given the check at once. */
const PIECE = 1 << 20;

/** Whether all of `text` is strict JSON, checked a piece at a time: what decryptBtpPayload asks first. */
export const isStrictJson = (text: string): boolean => {
  const check = strictJsonCheck();
  try {
    for (let from = 0; from < text.length; from += PIECE) check.add(text.slice(from, from + PIECE));
    check.end();
    return true;
  } catch {
    return false;
  }
};
