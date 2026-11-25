/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// A large payload is decrypted and its signature checked a piece at a time,
// never held whole: proven under a hard cap on the heap, in a process of its
// own, where holding it whole runs out of memory. A change that made the
// stream functions hold what they read would fail here, whatever its timing.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  createReadStream,
  createWriteStream,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { encryptBtpPayloadStream, signBtpPayloadStream } from '../../src/core/crypto/index.js';

/** The heap cap the child runs under, and about how large the payload is: far more than the cap. */
const CAP_MB = 64;
const FILE_MB = 45;

const BUILT = resolve(__dirname, '../../dist/core/crypto/index.js');

/** What the child does, under the cap, with the payload: one of `decrypt`, `verify`, `whole`. Prints OK when it did. */
const CHILD = `
import { createReadStream, readFileSync } from 'node:fs';
const crypto = await import(process.env.BUILT);
const meta = JSON.parse(readFileSync(process.env.META, 'utf8'));
const pieces = () => createReadStream(process.env.PAYLOAD, { encoding: 'utf8', highWaterMark: 1 << 20 });
const mode = process.argv[2];
if (mode === 'decrypt') {
  let bytes = 0;
  for await (const piece of crypto.decryptBtpPayloadStream(pieces(), meta.encryption, meta.privateKey, { strictJson: true })) bytes += piece.length;
  console.log(bytes > 0 ? 'OK' : 'EMPTY');
} else if (mode === 'verify') {
  const { isValid } = await crypto.verifySignatureStream(meta.envelope, pieces(), meta.signature, meta.publicKey);
  console.log(isValid ? 'OK' : 'INVALID');
} else {
  const { data } = crypto.decryptBtpPayload(readFileSync(process.env.PAYLOAD, 'utf8'), meta.encryption, meta.privateKey);
  console.log(data ? 'OK' : 'NOT OPENED');
}
`;

describe('a large payload, under a hard cap on the heap', () => {
  const dir = mkdtempSync(join(tmpdir(), 'btps-large-'));
  const paths = {
    child: join(dir, 'child.mjs'),
    meta: join(dir, 'meta.json'),
    payload: join(dir, 'payload'),
  };

  /** Runs the child in `mode` under the cap: its exit status and what it printed. */
  const underCap = (mode: string) =>
    spawnSync(
      process.execPath,
      [`--max-old-space-size=${CAP_MB}`, '--max-semi-space-size=1', paths.child, mode],
      {
        env: { ...process.env, BUILT, META: paths.meta, PAYLOAD: paths.payload },
        encoding: 'utf8',
        timeout: 120_000,
      },
    );

  beforeAll(async () => {
    const keys = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    // A letter carrying one large file, its JSON text written a piece at a time: never held here either.
    async function* document(): AsyncGenerator<string> {
      yield '{"type":"letter","title":"Large","id":"LET-1","issuedAt":"2026-11-26T00:00:00.000Z","body":{"format":"text","content":"Hi"},"attachments":[{"type":"application/pdf","size":1,"sha256":"' +
        'a'.repeat(64) +
        '","content":"';
      for (let i = 0; i < FILE_MB; i += 1) yield randomBytes(768 * 1024).toString('base64');
      yield '"}]}';
    }
    const sealed = encryptBtpPayloadStream(document(), keys.publicKey);
    const out = createWriteStream(paths.payload, { encoding: 'utf8' });
    for await (const piece of sealed.payload) {
      if (!out.write(piece)) await new Promise<void>((done) => out.once('drain', () => done()));
    }
    await new Promise<void>((done) => out.end(() => done()));
    const encryption = await sealed.encryption;
    const envelope = {
      version: '1.2.0',
      id: 'large-1',
      type: 'BTPS_DOC',
      from: 'a$example.com',
      to: 'b$example.com',
      issuedAt: '2026-11-26T00:00:00.000Z',
      encryption,
    };
    const signature = await signBtpPayloadStream(
      envelope,
      createReadStream(paths.payload, { encoding: 'utf8', highWaterMark: 1 << 20 }),
      keys,
    );
    writeFileSync(paths.meta, JSON.stringify({ ...keys, encryption, envelope, signature }));
    writeFileSync(paths.child, CHILD);
  }, 120_000);

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('is decrypted a piece at a time, held to strict JSON, within the cap', () => {
    const run = underCap('decrypt');
    expect(run.stdout.trim()).toBe('OK');
    expect(run.status).toBe(0);
  }, 120_000);

  it('has its signature checked a piece at a time, within the cap', () => {
    const run = underCap('verify');
    expect(run.stdout.trim()).toBe('OK');
    expect(run.status).toBe(0);
  }, 120_000);

  it('cannot be decrypted whole within the cap: the cap is real', () => {
    const run = underCap('whole');
    expect(run.stdout.trim()).not.toBe('OK');
    expect(run.status).not.toBe(0);
    // Refused for holding too much, not for anything else.
    expect(run.stderr).toMatch(/heap out of memory/i);
  }, 120_000);

  it('is far larger than the cap', () => {
    expect(statSync(paths.payload).size).toBeGreaterThan(CAP_MB * 1024 * 1024 * 0.9);
  });
});
