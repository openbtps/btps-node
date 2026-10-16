/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import canonicalizeJson from 'canonicalize';
import { parse as parseJsonTree } from '@humanwhocodes/momoa';
import type { Node as JsonNode, StringNode, ValueNode } from '@humanwhocodes/momoa';
import { BTP_ERROR_CANONICAL_JSON } from '@core/error/constant.js';
import { BTPErrorException } from '@core/error/index.js';

/*
 * JSON Canonicalization Scheme, RFC 8785.
 *
 * Every BTPS signature is over the canonical form of the signed object, so
 * any implementation (KMS input, Swift, Kotlin, a browser) produces the same
 * bytes for the same object. The canonical bytes come from `canonicalize`,
 * by an author of RFC 8785. Input is parsed strictly first:
 *   - a duplicate member name is refused at any depth, so a document cannot
 *     carry two values for one field past a verifier (momoa sees the raw
 *     member names that JSON.parse would collapse);
 *   - a lone UTF-16 surrogate is refused (RFC 8785 requires I-JSON);
 *   - a number that is not a finite IEEE-754 double is refused;
 *   - anything JSON.parse refuses is refused.
 */

const fail = (reason: string, position?: number): never => {
  throw new BTPErrorException(BTP_ERROR_CANONICAL_JSON, {
    cause: position === undefined ? reason : `${reason} (at offset ${position})`,
    meta: position === undefined ? { reason } : { reason, position },
  });
};

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

const offsetOf = (node: JsonNode): number | undefined => node.loc?.start.offset;

const checkString = (node: StringNode): void => {
  if (LONE_SURROGATE.test(node.value)) fail('lone UTF-16 surrogate in string', offsetOf(node));
};

const checkValue = (node: ValueNode): void => {
  switch (node.type) {
    case 'Object': {
      const names = new Set<string>();
      for (const member of node.members) {
        const name = member.name;
        if (name.type !== 'String') return fail('expected a member name', offsetOf(name));
        checkString(name);
        if (names.has(name.value)) {
          fail(`duplicate member name ${JSON.stringify(name.value)}`, offsetOf(name));
        }
        names.add(name.value);
        checkValue(member.value);
      }
      return;
    }
    case 'Array':
      for (const element of node.elements) checkValue(element.value);
      return;
    case 'String':
      checkString(node);
      return;
    case 'Number':
      if (!Number.isFinite(node.value)) fail('number overflows a double', offsetOf(node));
      return;
    case 'Boolean':
    case 'Null':
      return;
    default:
      return fail(`${node.type} is not JSON`, offsetOf(node));
  }
};

const offsetOfError = (error: unknown): number | undefined =>
  typeof error === 'object' &&
  error !== null &&
  'offset' in error &&
  typeof error.offset === 'number'
    ? error.offset
    : undefined;

/**
 * Parses a JSON text as `JSON.parse` does, but strictly: a duplicate member
 * name, a lone surrogate or a number outside a double is refused rather than
 * silently resolved. Use it wherever a signed artifact is read off the wire.
 *
 * @throws {BTPErrorException} BTP_ERROR_CANONICAL_JSON
 */
export const parseJson = <T = unknown>(jsonText: string): T => {
  if (typeof jsonText !== 'string') fail('input must be a string');
  try {
    checkValue(parseJsonTree(jsonText, { mode: 'json' }).body);
    const value: unknown = JSON.parse(jsonText);
    return value as T;
  } catch (error) {
    if (error instanceof BTPErrorException) throw error;
    // a syntax error, or a stack overflow on absurdly deep nesting
    return fail(error instanceof Error ? error.message : 'unparseable JSON', offsetOfError(error));
  }
};

/**
 * Canonicalises a JSON text per RFC 8785 (JCS).
 *
 * @param jsonText - the JSON text, e.g. an artifact as it arrived on the wire
 * @returns the canonical JSON text
 * @throws {BTPErrorException} BTP_ERROR_CANONICAL_JSON on malformed JSON,
 *   duplicate member names, lone surrogates or non-finite numbers
 */
export const canonicalize = (jsonText: string): string => {
  const value = parseJson(jsonText);
  let canonical: string | undefined;
  try {
    canonical = canonicalizeJson(value);
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'not canonicalisable');
  }
  return canonical === undefined ? fail('value is not representable in JSON') : canonical;
};

/**
 * Canonicalises an in-memory value: the JCS form of what `JSON.stringify`
 * would put on the wire for it (so `undefined` members are dropped and
 * `toJSON` applies, exactly as a receiver will see them).
 *
 * @throws {BTPErrorException} BTP_ERROR_CANONICAL_JSON when the value has no
 *   JSON form or contains a lone surrogate or a non-finite number
 */
export const canonicalizeValue = (value: unknown): string => {
  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'value is not serialisable');
  }
  if (text === undefined) return fail(`${typeof value} is not representable in JSON`);
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return fail(`${value} is not representable in JSON`);
  }
  return canonicalize(text);
};
