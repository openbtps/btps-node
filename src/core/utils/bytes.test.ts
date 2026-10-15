/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { decodeBase64Strict, encodeBase64, encodeHex, sha256 } from './bytes.js';

const nodeSha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

describe('sha256 (plain JavaScript, for @btps/sdk/documents)', () => {
  it('matches the FIPS 180-4 examples', () => {
    const text = (s: string) => new TextEncoder().encode(s);
    expect(encodeHex(sha256(text('')))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(encodeHex(sha256(text('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(
      encodeHex(sha256(text('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))),
    ).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  it('matches node:crypto at every length around a block boundary, and on a large file', () => {
    for (let length = 0; length <= 200; length++) {
      const bytes = randomBytes(length);
      expect(encodeHex(sha256(bytes)), `length ${length}`).toBe(nodeSha256(bytes));
    }
    const large = randomBytes(3 * 1024 * 1024 + 7);
    expect(encodeHex(sha256(large))).toBe(nodeSha256(large));
  });
});

describe('base64', () => {
  it('encodes and decodes as Buffer does, at every padding', () => {
    for (let length = 0; length <= 64; length++) {
      const bytes = randomBytes(length);
      const text = Buffer.from(bytes).toString('base64');
      expect(encodeBase64(bytes)).toBe(text);
      expect(Buffer.from(decodeBase64Strict(text)!).equals(bytes), `length ${length}`).toBe(true);
    }
  });

  it.each([
    ['whitespace', 'QUJD\nREVG'],
    ['missing padding', 'QQ'],
    ['the URL-safe alphabet', '_-8A'],
    ['padding in the middle', 'QQ==QUJD'],
    ['three padding characters', 'Q==='],
    ['a character outside ASCII', 'QUJé'],
    ['non-zero bits under the padding', 'QR=='],
    ['non-zero bits under one padding character', 'QUJ='],
  ])('refuses %s', (_label, text) => {
    expect(decodeBase64Strict(text)).toBeUndefined();
  });
});
