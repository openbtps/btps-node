/**
 * Reference JSON Canonicalization Scheme (RFC 8785) for the BTPS golden vectors.
 *
 * This is the harness's *oracle*, not the SDK's implementation. The SDK's own
 * canonical signing is EBA-115 (BTPS 1.1 item 5); this file exists so the
 * vectors can be checked for self-consistency on every runtime without
 * trusting the code under test.
 *
 * It is deliberately portable: no Node built-ins, so the same file runs in a
 * browser, in React Native, and in Node.
 *
 * Beyond RFC 8785 serialisation, the parser enforces the input rules the
 * BTPS 1.1 addendum (page 8323117, item 5) requires of a signed document:
 *   - duplicate member names are rejected, at any depth;
 *   - lone UTF-16 surrogates are rejected (RFC 8785 §3.2.2 requires I-JSON);
 *   - numbers that are not finite IEEE-754 doubles are rejected.
 */

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
 *
 * @param {unknown} value
 * @returns {string}
 * @throws {JcsError} on values JSON cannot represent
 */
export function canonicalizeValue(value) {
  return serialize(value, '$');
}

function serialize(value, path) {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new JcsError(`${path}: ${value} is not representable in JSON`);
      }
      // ECMAScript Number::toString is the RFC 8785 number format; JSON.stringify
      // applies it and also maps -0 to "0", as RFC 8785 §3.2.2.3 requires.
      return JSON.stringify(value);
    case 'string':
      assertWellFormed(value, path);
      // JSON.stringify's escaping is the RFC 8785 §3.2.2.2 string format.
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((item, i) => serialize(item, `${path}[${i}]`)).join(',')}]`;
      }
      const names = Object.keys(value);
      for (const name of names) assertWellFormed(name, `${path} (member name)`);
      // Default sort compares UTF-16 code units, which is RFC 8785 §3.2.3.
      names.sort();
      const members = [];
      for (const name of names) {
        const member = value[name];
        if (member === undefined || typeof member === 'function' || typeof member === 'symbol') {
          throw new JcsError(`${path}.${name}: ${typeof member} is not representable in JSON`);
        }
        members.push(`${JSON.stringify(name)}:${serialize(member, `${path}.${name}`)}`);
      }
      return `{${members.join(',')}}`;
    }
    default:
      throw new JcsError(`${path}: ${typeof value} is not representable in JSON`);
  }
}

function assertWellFormed(text, path) {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new JcsError(`${path}: lone high surrogate U+${hex4(unit)}`);
      }
      i++;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new JcsError(`${path}: lone low surrogate U+${hex4(unit)}`);
    }
  }
}

function hex4(n) {
  return n.toString(16).toUpperCase().padStart(4, '0');
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
  const parser = new Parser(text);
  parser.skipWhitespace();
  const value = parser.parseValue('$');
  parser.skipWhitespace();
  if (parser.pos !== text.length) parser.fail('unexpected trailing content');
  return value;
}

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

class Parser {
  constructor(text) {
    this.text = text;
    this.pos = 0;
  }

  fail(message) {
    throw new JcsError(message, this.pos);
  }

  skipWhitespace() {
    // RFC 8259 whitespace only: space, tab, LF, CR. A BOM is not whitespace.
    while (this.pos < this.text.length) {
      const c = this.text[this.pos];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') this.pos++;
      else break;
    }
  }

  parseValue(path) {
    const c = this.text[this.pos];
    if (c === '{') return this.parseObject(path);
    if (c === '[') return this.parseArray(path);
    if (c === '"') return this.parseString(path);
    if (c === '-' || (c >= '0' && c <= '9')) return this.parseNumber(path);
    for (const [literal, value] of [
      ['true', true],
      ['false', false],
      ['null', null],
    ]) {
      if (this.text.startsWith(literal, this.pos)) {
        this.pos += literal.length;
        return value;
      }
    }
    return this.fail(`${path}: unexpected ${c === undefined ? 'end of input' : JSON.stringify(c)}`);
  }

  parseObject(path) {
    this.pos++; // {
    const result = Object.create(null);
    const seen = new Set();
    this.skipWhitespace();
    if (this.text[this.pos] === '}') {
      this.pos++;
      return result;
    }
    for (;;) {
      this.skipWhitespace();
      if (this.text[this.pos] !== '"') this.fail(`${path}: expected a member name`);
      const name = this.parseString(`${path} (member name)`);
      if (seen.has(name)) {
        this.fail(`${path}: duplicate member name ${JSON.stringify(name)}`);
      }
      seen.add(name);
      this.skipWhitespace();
      if (this.text[this.pos] !== ':') this.fail(`${path}: expected ':'`);
      this.pos++;
      this.skipWhitespace();
      result[name] = this.parseValue(`${path}.${name}`);
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
      this.fail(`${path}: expected ',' or '}'`);
    }
  }

  parseArray(path) {
    this.pos++; // [
    const result = [];
    this.skipWhitespace();
    if (this.text[this.pos] === ']') {
      this.pos++;
      return result;
    }
    for (;;) {
      this.skipWhitespace();
      result.push(this.parseValue(`${path}[${result.length}]`));
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
      this.fail(`${path}: expected ',' or ']'`);
    }
  }

  parseString(path) {
    this.pos++; // opening quote
    let out = '';
    for (;;) {
      if (this.pos >= this.text.length) this.fail(`${path}: unterminated string`);
      const c = this.text[this.pos];
      if (c === '"') {
        this.pos++;
        break;
      }
      if (c === '\\') {
        out += this.parseEscape(path);
        continue;
      }
      if (c.charCodeAt(0) < 0x20) this.fail(`${path}: unescaped control character in string`);
      out += c;
      this.pos++;
    }
    assertWellFormed(out, path);
    return out;
  }

  parseEscape(path) {
    const c = this.text[this.pos + 1];
    const simple = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
    if (c in simple) {
      this.pos += 2;
      return simple[c];
    }
    if (c === 'u') {
      const digits = this.text.slice(this.pos + 2, this.pos + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(digits)) this.fail(`${path}: bad \\u escape`);
      this.pos += 6;
      return String.fromCharCode(parseInt(digits, 16));
    }
    return this.fail(`${path}: bad escape`);
  }

  parseNumber(path) {
    NUMBER.lastIndex = this.pos;
    const match = NUMBER.exec(this.text);
    if (!match) this.fail(`${path}: malformed number`);
    this.pos += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) this.fail(`${path}: number ${match[0]} overflows a double`);
    return value;
  }
}
