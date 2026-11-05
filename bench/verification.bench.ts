/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * What a server spends on one arriving artifact before its handler runs, step
 * by step: the strict-JSON check (no name twice), the parse, the schema, the
 * canonical form, and the RSA signature check. `yarn bench` runs it. It says
 * whether reading the same text fewer times would matter beside the signature.
 */

import { bench, describe } from 'vitest';
import { generateKeyPairSync } from 'crypto';
import {
  assertStrictJson,
  canonicalizeValue,
  signBtpPayload,
  verifySignature,
} from '../src/core/crypto/index.js';
import { BtpArtifactServerSchema } from '../src/core/server/schemas/artifacts/artifacts.js';

const keys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const artifactOf = (rows: number) => {
  const unsigned = {
    version: '1.1.0',
    id: 'artifact-1',
    issuedAt: new Date().toISOString(),
    type: 'BTPS_DOC',
    from: 'billing$vendor.example',
    to: 'pay$client.example',
    selector: 'btps1',
    encryption: null,
    document: {
      type: 'invoice',
      title: 'October',
      id: 'INV-1',
      issuedAt: new Date().toISOString(),
      totalAmount: { amount: 150000 * rows, currency: 'AUD' },
      lineItems: {
        columns: ['Item', 'Amount'],
        rows: Array.from({ length: rows }, (_, at) => ({ Item: `Line ${at}`, Amount: 150000 })),
      },
    },
  };
  return { ...unsigned, signature: signBtpPayload(unsigned, keys) };
};

for (const rows of [1, 100, 2000]) {
  const artifact = artifactOf(rows);
  const line = JSON.stringify(artifact);
  const { signature, ...signed } = artifact;

  describe(`an invoice of ${rows} line${rows === 1 ? '' : 's'} (${Math.round(line.length / 1024)} KB)`, () => {
    bench('strict JSON: no name twice', () => {
      assertStrictJson(line);
    });
    bench('parse', () => {
      JSON.parse(line);
    });
    bench('schema', () => {
      BtpArtifactServerSchema.safeParse(artifact);
    });
    bench('canonical form', () => {
      canonicalizeValue(signed);
    });
    bench('signature (canonical form and RSA verify)', () => {
      verifySignature(signed, signature, keys.publicKey);
    });
    bench('all of it, as a server does', () => {
      assertStrictJson(line);
      const parsed = JSON.parse(line);
      BtpArtifactServerSchema.safeParse(parsed);
      const { signature: given, ...rest } = parsed;
      verifySignature(rest, given, keys.publicKey);
    });
  });
}
