/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.1 item D (EBA-112): test/vectors/refresh.vectors.json against
 * verifyAgentRefresh, and signKeyProof round trips. The same cases run
 * through the server in src/server/test/refresh.test.ts.
 */

import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { readFileSync } from 'node:fs';
import { keyProofPayload, signKeyProof, verifyAgentRefresh } from './keyRotation.js';
import { PemSigner, signBtpPayload, verifySignature } from '@core/crypto/index.js';
import {
  BTP_ERROR_KEY_ROTATION_PROOF,
  BTP_ERROR_REFRESH_NOT_CURRENT_KEY,
} from '@core/error/constant.js';
import type { BTPAgentArtifact } from '@core/server/types.js';
import type { PemKeys } from '@core/crypto/types.js';

type VectorKey = { publicKeyPem: string; privateKeyPem: string; fingerprint: string };
type RefreshCase = {
  name: string;
  currentKey: string | null;
  artifact: BTPAgentArtifact;
  expect: 'accept' | 'refuse';
  rotation?: boolean;
  reason?: string;
  error?: string;
};
type RefreshVectors = {
  now: string;
  windowMs: number;
  agentId: string;
  identity: string;
  selfHeld: {
    keys: Record<string, VectorKey>;
    cases: RefreshCase[];
    tokens: { use: string; expect: 'accept' | 'refuse' }[];
  };
  managed: { keyVector: string; description: string; cases: RefreshCase[] };
};

const vectors = JSON.parse(
  readFileSync(new URL('../../../test/vectors/refresh.vectors.json', import.meta.url), 'utf8'),
) as RefreshVectors;

const keyOf = (name: string | null) =>
  name === null ? null : vectors.selfHeld.keys[name]!.publicKeyPem;

const run = (c: RefreshCase) =>
  verifyAgentRefresh({
    artifact: c.artifact,
    currentPublicKey: keyOf(c.currentKey),
    nowMs: Date.parse(vectors.now),
    windowMs: vectors.windowMs,
  });

const genKeys = (): PemKeys => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
};

describe('item D: refresh.vectors.json, self-held custody', () => {
  it.each(vectors.selfHeld.cases.map((c) => [c.name, c] as const))('%s', (_, c) => {
    const result = run(c);
    if (c.expect === 'accept') {
      expect(result.ok).toBe(true);
      expect(result.ok && result.rotation).toBe(c.rotation);
      if (result.ok && result.rotation) {
        expect(result.newPublicKey).toBe(vectors.selfHeld.keys.new!.publicKeyPem);
        expect(result.newFingerprint).toBe(vectors.selfHeld.keys.new!.fingerprint);
      }
    } else {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe(c.reason);
        expect(result.error.code).toBe(c.error);
      }
    }
  });

  it('covers the EBA-112 acceptance cases', () => {
    const names = vectors.selfHeld.cases.map((c) => c.name);
    expect(names).toContain('rotation-signed-only-by-new-key-refused');
    expect(names).toContain('rotation-signed-by-current-key-with-countersigned-new-key-accepted');
    expect(names).toContain('rotation-without-proof-refused');
    expect(names).toContain('refresh-without-rotation-accepted');
  });
});

describe('item D: refresh.vectors.json, managed custody', () => {
  it('says the refresh path does not apply', () => {
    expect(vectors.managed.description).toMatch(/Not applicable/);
    expect(vectors.managed.keyVector).toBe('kms-signature.vector.json');
  });

  it.each(vectors.managed.cases.map((c) => [c.name, c] as const))('%s', (_, c) => {
    const result = run(c);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe(c.reason);
      expect(result.error.code).toBe(c.error);
    }
  });
});

describe('item D: signKeyProof', () => {
  const agentId = 'btps_ag_sign-test';
  const identity = 'alice$saas.example';

  it('signs the four fields with the new key, from a PEM pair or a Signer', async () => {
    const newKey = genKeys();
    for (const key of [newKey, new PemSigner(newKey)]) {
      const { publicKey, keyProof } = await signKeyProof({ agentId, identity, newKey: key });
      expect(publicKey).toBe(newKey.publicKey);
      const payload = keyProofPayload({
        agentId,
        identity,
        newPublicKey: publicKey,
        issuedAt: keyProof.issuedAt,
      });
      expect(verifySignature(payload, keyProof.signature, newKey.publicKey).isValid).toBe(true);
    }
  });

  it('a refresh built with it is accepted, and rotates', async () => {
    const current = genKeys();
    const newKey = genKeys();
    const issuedAt = new Date().toISOString();
    const { publicKey, keyProof } = await signKeyProof({ agentId, identity, newKey, issuedAt });
    const unsigned = {
      version: '1.1.0',
      id: crypto.randomUUID(),
      action: 'auth.refresh' as const,
      agentId,
      to: identity,
      issuedAt,
      encryption: null,
      document: { identity, authToken: 't', publicKey, keyProof },
    };
    const artifact = {
      ...unsigned,
      signature: await signBtpPayload(unsigned, current),
    } as BTPAgentArtifact;
    const result = verifyAgentRefresh({
      artifact,
      currentPublicKey: current.publicKey,
      nowMs: Date.now(),
    });
    expect(result).toMatchObject({ ok: true, rotation: true, newPublicKey: newKey.publicKey });
  });

  it('keyProofPayload drops any other field', () => {
    const extra = { agentId, identity, newPublicKey: 'k', issuedAt: 'i', to: 'x' };
    expect(Object.keys(keyProofPayload(extra))).toEqual([
      'agentId',
      'identity',
      'newPublicKey',
      'issuedAt',
    ]);
  });

  it('the two refusals have their own codes', () => {
    expect(BTP_ERROR_REFRESH_NOT_CURRENT_KEY.code).not.toBe(BTP_ERROR_KEY_ROTATION_PROOF.code);
  });
});
