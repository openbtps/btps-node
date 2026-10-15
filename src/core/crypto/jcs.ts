/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { BTP_ERROR_CANONICAL_JSON } from '@core/error/constant.js';
import { BTPErrorException } from '@core/error/index.js';

/*
 * JSON Canonicalization Scheme, RFC 8785 (BTPS 1.1, addendum item 5).
 *
 * Every BTPS signature is over the canonical form of the signed object, so
 * any implementation (KMS input, Swift, Kotlin, a browser) produces the same
 * bytes for the same object. Input is parsed strictly first:
 *   - a duplicate member name is refused at any depth, so a document cannot
 *     carry two values for one field past a verifier;
 *   - a lone UTF-16 surrogate is refused (RFC 8785 requires I-JSON);
 *   - a number that is not a finite IEEE-754 double is refused.
 */

const fail = (reason: string, position?: number): never => {
  throw new BTPErrorException(BTP_ERROR_CANONICAL_JSON, {
    cause: position === undefined ? reason : `${reason} (at offset ${position})`,
    meta: position === undefined ? { reason } : { reason, position },
  });
};

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const HEX4 = /^[0-9a-fA-F]{4}$/;
const SIMPLE_ESCAPES: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

class BtpsStrictJsonParser {
  private pos = 0;

  constructor(private readonly text: string) {}

  parseDocument(): unknown {
    this.skipWhitespace();
    const value = this.parseValue();
    this.skipWhitespace();
    if (this.pos !== this.text.length) fail('unexpected trailing content', this.pos);
    return value;
  }

  private skipWhitespace(): void {
    // RFC 8259 whitespace only: space, tab, LF, CR.
    for (;;) {
      const c = this.text.charCodeAt(this.pos);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) this.pos++;
      else return;
    }
  }

  private parseValue(): unknown {
    const c = this.text[this.pos];
    if (c === '{') return this.parseObject();
    if (c === '[') return this.parseArray();
    if (c === '"') return this.parseString();
    if (c === '-' || (c !== undefined && c >= '0' && c <= '9')) return this.parseNumber();
    if (this.text.startsWith('true', this.pos)) {
      this.pos += 4;
      return true;
    }
    if (this.text.startsWith('false', this.pos)) {
      this.pos += 5;
      return false;
    }
    if (this.text.startsWith('null', this.pos)) {
      this.pos += 4;
      return null;
    }
    return fail(
      c === undefined ? 'unexpected end of input' : `unexpected ${JSON.stringify(c)}`,
      this.pos,
    );
  }

  private parseObject(): Record<string, unknown> {
    this.pos++; // {
    const result: Record<string, unknown> = {};
    this.skipWhitespace();
    if (this.text[this.pos] === '}') {
      this.pos++;
      return result;
    }
    for (;;) {
      this.skipWhitespace();
      if (this.text[this.pos] !== '"') fail('expected a member name', this.pos);
      const namePos = this.pos;
      const name = this.parseString();
      if (Object.prototype.hasOwnProperty.call(result, name)) {
        fail(`duplicate member name ${JSON.stringify(name)}`, namePos);
      }
      this.skipWhitespace();
      if (this.text[this.pos] !== ':') fail("expected ':'", this.pos);
      this.pos++;
      this.skipWhitespace();
      const value = this.parseValue();
      // As JSON.parse does: "__proto__" is an own property, never the prototype.
      Object.defineProperty(result, name, {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      this.skipWhitespace();
      const c = this.text[this.pos];
      if (c === ',') {
        this.pos++;
        continue;
      }
      if (c === '}') {
        this.pos++;
        return result;
      }
      fail("expected ',' or '}'", this.pos);
    }
  }

  private parseArray(): unknown[] {
    this.pos++; // [
    const result: unknown[] = [];
    this.skipWhitespace();
    if (this.text[this.pos] === ']') {
      this.pos++;
      return result;
    }
    for (;;) {
      this.skipWhitespace();
      result.push(this.parseValue());
      this.skipWhitespace();
      const c = this.text[this.pos];
      if (c === ',') {
        this.pos++;
        continue;
      }
      if (c === ']') {
        this.pos++;
        return result;
      }
      fail("expected ',' or ']'", this.pos);
    }
  }

  private parseString(): string {
    const startPos = this.pos;
    this.pos++; // opening quote
    let out = '';
    let runStart = this.pos;
    for (;;) {
      if (this.pos >= this.text.length) fail('unterminated string', startPos);
      const c = this.text.charCodeAt(this.pos);
      if (c === 0x22) {
        out += this.text.slice(runStart, this.pos);
        this.pos++;
        break;
      }
      if (c === 0x5c) {
        out += this.text.slice(runStart, this.pos);
        out += this.parseEscape();
        runStart = this.pos;
        continue;
      }
      if (c < 0x20) fail('unescaped control character in string', this.pos);
      this.pos++;
    }
    if (LONE_SURROGATE.test(out)) fail('lone UTF-16 surrogate in string', startPos);
    return out;
  }

  private parseEscape(): string {
    const c = this.text[this.pos + 1];
    if (c !== undefined && Object.prototype.hasOwnProperty.call(SIMPLE_ESCAPES, c)) {
      this.pos += 2;
      return SIMPLE_ESCAPES[c] as string;
    }
    if (c === 'u') {
      const digits = this.text.slice(this.pos + 2, this.pos + 6);
      if (!HEX4.test(digits)) fail('bad \\u escape', this.pos);
      this.pos += 6;
      return String.fromCharCode(parseInt(digits, 16));
    }
    return fail('bad escape', this.pos);
  }

  private parseNumber(): number {
    NUMBER.lastIndex = this.pos;
    const match = NUMBER.exec(this.text);
    if (!match) return fail('malformed number', this.pos);
    const value = Number(match[0]);
    if (!Number.isFinite(value)) fail(`number ${match[0]} overflows a double`, this.pos);
    this.pos += match[0].length;
    return value;
  }
}

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
    return new BtpsStrictJsonParser(jsonText).parseDocument() as T;
  } catch (error) {
    if (error instanceof BTPErrorException) throw error;
    // e.g. a stack overflow on absurdly deep nesting
    return fail(error instanceof Error ? error.message : 'unparseable JSON');
  }
};

/** Serialises a value produced by parseJson per RFC 8785 §3.2. */
const serialize = (value: unknown): string => {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      // ECMAScript Number::toString is the RFC 8785 number format, and
      // JSON.stringify maps -0 to "0" as §3.2.2.3 requires.
      return JSON.stringify(value);
    case 'string':
      // JSON.stringify's escaping is the §3.2.2.2 string format.
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map(serialize).join(',')}]`;
      const record = value as Record<string, unknown>;
      // The default sort compares UTF-16 code units, which is §3.2.3.
      const names = Object.keys(record).sort();
      return `{${names.map((name) => `${JSON.stringify(name)}:${serialize(record[name])}`).join(',')}}`;
    }
    default:
      return fail(`${typeof value} is not representable in JSON`);
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
export const canonicalize = (jsonText: string): string => serialize(parseJson(jsonText));

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
