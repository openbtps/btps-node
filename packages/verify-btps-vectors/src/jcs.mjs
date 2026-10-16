/**
 * JSON Canonicalization Scheme (RFC 8785) for the BTPS golden vectors.
 *
 * The canonical bytes come from `canonicalize` (by an author of RFC 8785),
 * which refuses what RFC 8785 cannot represent: NaN, Infinity and lone
 * surrogates. `momoa` reads the raw text so a duplicate member name, which
 * JSON.parse would silently collapse, is refused at any depth.
 *
 * Both libraries are plain JavaScript with no Node built-ins, so this file
 * runs in a browser, in React Native and in Node.
 */

import serialize from 'canonicalize';
import { iterator, parse } from '@humanwhocodes/momoa';

export class JcsError extends Error {
  /**
   * @param {string} message
   * @param {number} [position] offset in the JSON text, when parsing
   */
  constructor(message, position) {
    super(position === undefined ? message : `${message} (at offset ${position})`);
    this.name = 'JcsError';
    this.position = position;
  }
}

/**
 * Canonicalise a JSON text: parse it strictly, then serialise it per RFC 8785.
 *
 * @param {string} jsonText
 * @returns {string} the canonical form
 * @throws {JcsError} on malformed JSON, duplicate names, lone surrogates, non-finite numbers
 */
export function canonicalize(jsonText) {
  return canonicalizeValue(parseStrict(jsonText));
}

/**
 * Canonicalise an in-memory value, as `JSON.stringify` would send it.
 *
 * @param {unknown} value
 * @returns {string}
 * @throws {JcsError} on values JSON cannot represent
 */
export function canonicalizeValue(value) {
  let canonical;
  try {
    canonical = serialize(value);
  } catch (error) {
    throw new JcsError(error instanceof Error ? error.message : String(error));
  }
  if (canonical === undefined) throw new JcsError(`${typeof value} is not representable in JSON`);
  return canonical;
}

/**
 * Parse a JSON text strictly. Unlike JSON.parse alone, a duplicate member
 * name is an error rather than "last one wins", so a document cannot carry
 * two different values for the same field past a verifier.
 *
 * @param {string} text
 * @returns {unknown}
 */
export function parseStrict(text) {
  if (typeof text !== 'string') throw new JcsError('input must be a string');
  let document;
  try {
    document = parse(text, { mode: 'json' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new JcsError(message, error?.offset);
  }
  for (const { node } of iterator(document)) {
    if (node.type !== 'Object') continue;
    const seen = new Set();
    for (const { name } of node.members) {
      if (seen.has(name.value)) {
        throw new JcsError(
          `duplicate member name ${JSON.stringify(name.value)}`,
          name.loc.start.offset,
        );
      }
      seen.add(name.value);
    }
  }
  try {
    // JSON.parse keeps "__proto__" as an ordinary own member, and refuses
    // the raw control characters in strings that momoa lets through.
    return JSON.parse(text);
  } catch (error) {
    throw new JcsError(error instanceof Error ? error.message : String(error));
  }
}
