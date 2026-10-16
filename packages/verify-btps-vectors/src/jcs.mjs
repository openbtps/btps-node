/**
 * Reference JSON Canonicalization Scheme (RFC 8785) for the BTPS golden vectors.
 *
 * This is the harness's *oracle*, not the SDK's implementation. The SDK's own
 * canonical signing lives in src/core/crypto/jcs.ts and serialises with the
 * `canonicalize` package; this oracle serialises with a different one,
 * `json-canonicalize`, so the vectors are checked by an independent
 * implementation rather than by the library under test.
 *
 * Parsing uses `@humanwhocodes/momoa`, which keeps the raw member names that
 * JSON.parse would collapse. On top of RFC 8785 serialisation it enforces
 * the input rules BTPS 1.1 canonical signing requires of a signed document:
 *   - duplicate member names are rejected, at any depth;
 *   - lone UTF-16 surrogates are rejected (RFC 8785 §3.2.2 requires I-JSON);
 *   - numbers that are not finite IEEE-754 doubles are rejected.
 *
 * It stays portable: both packages are plain ECMAScript with no Node
 * built-ins, so the same file runs in a browser, in React Native and in Node.
 */

import { parse as parseJsonTree } from '@humanwhocodes/momoa';
import { canonicalizeEx } from 'json-canonicalize';

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
 * Canonicalise an in-memory value (an object as a JS program would build it).
 * Only own enumerable members are read; `toJSON` is not applied.
 *
 * @param {unknown} value
 * @returns {string}
 * @throws {JcsError} on values JSON cannot represent
 */
export function canonicalizeValue(value) {
  assertRepresentable(value, '$');
  try {
    return canonicalizeEx(value, { strictUndefined: true });
  } catch (error) {
    throw new JcsError(error instanceof Error ? error.message : String(error));
  }
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function assertWellFormed(text, path, position) {
  const match = LONE_SURROGATE.exec(text);
  if (!match) return;
  const unit = match[0].charCodeAt(0);
  const kind = unit <= 0xdbff ? 'high' : 'low';
  const hex = unit.toString(16).toUpperCase().padStart(4, '0');
  throw new JcsError(`${path}: lone ${kind} surrogate U+${hex}`, position);
}

/**
 * Refuse what `json-canonicalize` would otherwise resolve silently: a
 * non-finite number, a lone surrogate, a member or element with no JSON form,
 * and a member named `toJSON`, which that package hands to JSON.stringify
 * instead of sorting.
 */
function assertRepresentable(value, path) {
  if (value === null) return;
  switch (typeof value) {
    case 'boolean':
      return;
    case 'number':
      if (!Number.isFinite(value)) {
        throw new JcsError(`${path}: ${value} is not representable in JSON`);
      }
      return;
    case 'string':
      assertWellFormed(value, path);
      return;
    case 'object': {
      if (Array.isArray(value)) {
        value.forEach((element, i) => assertRepresentable(element, `${path}[${i}]`));
        return;
      }
      for (const name of Object.keys(value)) {
        assertWellFormed(name, `${path} (member name)`);
        const member = value[name];
        if (member === undefined || typeof member === 'function' || typeof member === 'symbol') {
          throw new JcsError(`${path}.${name}: ${typeof member} is not representable in JSON`);
        }
        if (name === 'toJSON') {
          throw new JcsError(`${path}: a member named "toJSON" is not supported by this oracle`);
        }
        assertRepresentable(member, `${path}.${name}`);
      }
      return;
    }
    default:
      throw new JcsError(`${path}: ${typeof value} is not representable in JSON`);
  }
}

/**
 * Parse a JSON text strictly. Unlike JSON.parse, a duplicate member name is
 * an error rather than "last one wins", so a document cannot carry two
 * different values for the same field past a verifier.
 *
 * Objects come back with a null prototype, so a member named "__proto__" is
 * an ordinary own property and cannot reach Object.prototype.
 *
 * @param {string} text
 * @returns {unknown}
 */
export function parseStrict(text) {
  if (typeof text !== 'string') throw new JcsError('input must be a string');
  let tree;
  try {
    tree = parseJsonTree(text, { mode: 'json', ranges: true });
  } catch (error) {
    const offset =
      error && typeof error === 'object' && typeof error.offset === 'number'
        ? error.offset
        : undefined;
    throw new JcsError(error instanceof Error ? error.message : 'unparseable JSON', offset);
  }
  return toValue(tree.body, '$', text);
}

// RFC 8259 §7: control characters must be escaped. momoa decodes a raw one
// as it would an escape, so the raw text of each string is checked here.
function assertNoRawControl(node, text, path) {
  const [start, end] = node.range ?? [0, 0];
  for (let i = start; i < end; i++) {
    if (text.charCodeAt(i) < 0x20) {
      throw new JcsError(`${path}: unescaped control character in string`, i);
    }
  }
}

/** @param {import('@humanwhocodes/momoa').ValueNode} node */
function toValue(node, path, text) {
  const position = node.loc?.start.offset;
  switch (node.type) {
    case 'Object': {
      const result = Object.create(null);
      for (const member of node.members) {
        const name = member.name.value;
        assertNoRawControl(member.name, text, `${path} (member name)`);
        assertWellFormed(name, `${path} (member name)`, member.name.loc?.start.offset);
        if (Object.prototype.hasOwnProperty.call(result, name)) {
          throw new JcsError(
            `${path}: duplicate member name ${JSON.stringify(name)}`,
            member.name.loc?.start.offset,
          );
        }
        result[name] = toValue(member.value, `${path}.${name}`, text);
      }
      return result;
    }
    case 'Array':
      return node.elements.map((element, i) => toValue(element.value, `${path}[${i}]`, text));
    case 'String':
      assertNoRawControl(node, text, path);
      assertWellFormed(node.value, path, position);
      return node.value;
    case 'Number':
      if (!Number.isFinite(node.value)) {
        throw new JcsError(`${path}: number overflows a double`, position);
      }
      return node.value;
    case 'Boolean':
      return node.value;
    case 'Null':
      return null;
    default:
      throw new JcsError(`${path}: ${node.type} is not JSON`, position);
  }
}
