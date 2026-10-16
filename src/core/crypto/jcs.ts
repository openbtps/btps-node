/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * JSON Canonicalization Scheme (RFC 8785). A BTPS signature covers the
 * canonical bytes of the signed object, so every implementation signs and
 * verifies the same bytes whatever order it writes keys in.
 *
 * The bytes come from `canonicalize` (by an author of RFC 8785), which also
 * refuses what RFC 8785 cannot represent: NaN, Infinity, lone surrogates.
 * The one thing it cannot see is a duplicate member name, because
 * `JSON.parse` keeps only the last one. `momoa` reads the raw text for that.
 */

import serialize from 'canonicalize';
import { iterator, parse } from '@humanwhocodes/momoa';
import type { DocumentNode, Node, ObjectNode } from '@humanwhocodes/momoa';
import { BTP_ERROR_CANONICAL_JSON } from '@core/error/constant.js';
import { BTPErrorException } from '@core/error/index.js';

const canonicalJsonError = (cause: unknown) =>
  new BTPErrorException(BTP_ERROR_CANONICAL_JSON, { cause });

const isObjectNode = (node: Node): node is ObjectNode => node.type === 'Object';

/** `canonicalize` on a JSON value, its refusals as BTP_ERROR_CANONICAL_JSON. */
const serializeJson = (value: unknown): string => {
  let canonical: string | undefined;
  try {
    canonical = serialize(value);
  } catch (error) {
    throw canonicalJsonError(error);
  }
  if (canonical === undefined) throw canonicalJsonError('the value has no JSON form');
  return canonical;
};

/**
 * Refuses a text that is not JSON, or that names a member twice in any
 * object, at any depth. Two parsers could otherwise read different values
 * from the same signed bytes. (A raw control character inside a string gets
 * past this check; `JSON.parse` refuses it.)
 *
 * @throws {BTPErrorException} BTP_ERROR_CANONICAL_JSON
 */
export const assertStrictJson = (text: string): void => {
  let document: DocumentNode;
  try {
    document = parse(text, { mode: 'json' });
  } catch (error) {
    throw canonicalJsonError(error);
  }
  for (const { node } of iterator(document)) {
    if (!isObjectNode(node)) continue;
    const names = new Set<string>();
    for (const { name } of node.members) {
      const key = name.type === 'String' ? name.value : name.name;
      if (names.has(key)) throw canonicalJsonError(`duplicate member name "${key}"`);
      names.add(key);
    }
  }
};

/**
 * The canonical form of an in-memory value: of what `JSON.stringify` would
 * send for it, so `undefined` members are dropped and `toJSON` applies.
 *
 * @throws {BTPErrorException} BTP_ERROR_CANONICAL_JSON
 */
export const canonicalizeValue = (value: unknown): string => {
  let sent: string | undefined;
  try {
    sent = JSON.stringify(value);
  } catch (error) {
    throw canonicalJsonError(error);
  }
  if (sent === undefined) throw canonicalJsonError('the value has no JSON form');
  return serializeJson(JSON.parse(sent));
};

/**
 * The canonical form of a JSON text, refusing duplicate member names.
 *
 * @throws {BTPErrorException} BTP_ERROR_CANONICAL_JSON
 */
export const canonicalize = (text: string): string => {
  assertStrictJson(text);
  let value: unknown;
  try {
    // Also refuses the raw control characters in strings that momoa lets through.
    value = JSON.parse(text);
  } catch (error) {
    throw canonicalJsonError(error);
  }
  return serializeJson(value);
};
