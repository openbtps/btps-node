/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * Defects found by reading the SDK on 2026-10-11 (Confluence page 8978819,
 * sections 6.1 and 6.3), one test each. Every test states behaviour the
 * protocol documents describe and fails on master 2ac824f for the defect
 * named above it. Only DNS is faked.
 *
 * The identity-lookup defects have their own file,
 * identityLookup.integration.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { resolveTxt } from 'dns/promises';

import { BtpsServer } from '../btpsServer.js';
import { MiddlewareManager } from '../libs/middlewareManager.js';
import * as clientEntry from '../../client/index.js';
import { BtpsDelegator } from '@core/delegation/BtpsDelegator.js';
import { getBTPKeyPair, getFingerprintFromPem, signBtpPayload } from '@core/crypto/index.js';
import { pemToBase64, resolvePublicKey } from '@core/utils/index.js';
import type { AbstractTrustStore } from '@core/trust/storage/AbstractTrustStore.js';
import type { BTPTrustRecord } from '@core/trust/types.js';
import type { BTPTransporterArtifact } from '@core/server/types.js';

vi.mock('dns/promises', () => ({ resolveTxt: vi.fn() }));
const mockResolveTxt = vi.mocked(resolveTxt);

const SAAS = 'admin$saas.test';
const ACME = 'billing$acme.test';
const RECEIVER = 'pay$client.test';

const saasKeys = getBTPKeyPair();
const acmeKeys = getBTPKeyPair();
const deviceKeys = getBTPKeyPair();

const keyTxt = (publicKey: string) => [[`v=1.0.0; k=rsa; p=${pemToBase64(publicKey)}`]];
const hostTxt = (domain: string, selector: string) => [
  [`v=1.0.0; u=btps.${domain}:3443; s=${selector}`],
];

/** Fakes DNS for the two domains. Each domain names its own current
 * selector, as each does once it has rotated a key on its own schedule. */
const publishDns = (selectors: { saas: string; acme: string }) => {
  const records: Record<string, string[][]> = {
    '_btps.host.saas.test': hostTxt('saas.test', selectors.saas),
    '_btps.host.acme.test': hostTxt('acme.test', selectors.acme),
    [`${selectors.saas}._btps.identity.admin.saas.test`]: keyTxt(saasKeys.publicKey),
    [`${selectors.acme}._btps.identity.billing.acme.test`]: keyTxt(acmeKeys.publicKey),
  };
  mockResolveTxt.mockImplementation(async (name: string) => {
    const found = records[name];
    if (!found) throw Object.assign(new Error(`queryTxt ENODATA ${name}`), { code: 'ENODATA' });
    return found;
  });
};

const newServer = (trustStore?: Partial<AbstractTrustStore<BTPTrustRecord>>) =>
  new BtpsServer({
    serverIdentity: {
      identity: 'admin$client.test',
      publicKey: saasKeys.publicKey,
      privateKey: saasKeys.privateKey,
    },
    trustStore: (trustStore ?? {
      getById: async () => undefined,
    }) as AbstractTrustStore<BTPTrustRecord>,
    tlsOptions: { cert: '', key: '' },
    middlewarePath: '/no-such-dir/btps.middleware.mjs',
  });

/** A document from Acme's device: signed by the device key, as BtpsAgent does. */
const deviceSignedArtifact = (selector: string): BTPTransporterArtifact => {
  const unsigned = {
    version: '1.0.0',
    id: 'artifact-1',
    issuedAt: '2026-10-11T00:00:00.000Z',
    type: 'TRUST_REQ' as const,
    document: {
      id: 'trust-1',
      name: 'Acme Pty Ltd',
      email: 'billing@acme.test',
      reason: 'Monthly invoices',
      phone: '0400000000',
    },
    from: ACME,
    to: RECEIVER,
    selector,
    encryption: null,
  };
  return { ...unsigned, signature: signBtpPayload(unsigned, deviceKeys) };
};

/** A custom domain sending through a SaaS: Acme's key signs the delegation
 * and the SaaS attests (docs/protocol/delegation/specification.md). */
const attestedArtifact = async (selectors: { saas: string; acme: string }) => {
  publishDns(selectors);
  const delegator = new BtpsDelegator({
    identity: SAAS,
    privateKey: saasKeys.privateKey,
    autoInit: false,
  });
  await delegator.init();
  const delegated = await delegator.delegateArtifact(
    'btps_ag_device-1',
    deviceKeys.publicKey,
    deviceSignedArtifact(selectors.acme),
    { identity: ACME, keyPair: acmeKeys },
  );
  expect(delegated.delegation.attestation, 'the delegator did not attest').toBeDefined();
  // What the receiving server parses off the wire.
  return JSON.parse(JSON.stringify(delegated)) as typeof delegated;
};

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  mockResolveTxt.mockReset();
  vi.restoreAllMocks();
});

describe('delegation with an attestation (custom domain through a SaaS)', () => {
  // Defect (addendum 8323117 item 10, reproduced 2026-10-04):
  // verifyDelegation strips only `signature` from the delegation before
  // rebuilding what the delegator signed, so the rebuilt message still
  // carries the attestation, which was attached after the delegator signed.
  it('verifies a delegation that BtpsDelegator signed and attested', async () => {
    const artifact = await attestedArtifact({ saas: 'btps1', acme: 'btps1' });
    const server = newServer();

    const { isValid, error } = await (
      server as unknown as {
        verifySignature: (d: unknown) => Promise<{ isValid: boolean; error?: Error }>;
      }
    ).verifySignature({ type: 'transporter', artifact });

    expect(error, `rejected: ${error?.message}`).toBeUndefined();
    expect(isValid).toBe(true);
  });

  // Defect: BtpsDelegator gives the attestation the on-behalf-of identity's
  // selector, and the server resolves the attestor's key with it. It only
  // works while both domains happen to use the same selector name.
  it('verifies the attestation when the two domains use different selectors', async () => {
    const artifact = await attestedArtifact({ saas: 'saas2', acme: 'acme1' });
    const server = newServer();

    const verify = (
      server as unknown as {
        verifyAttestation: (d: unknown) => Promise<{ isValid: boolean; error?: Error }>;
      }
    ).verifyAttestation.bind(server);
    const result = await verify(artifact.delegation).catch((error: Error) => ({
      isValid: false,
      error,
    }));

    expect(result.error, `rejected: ${result.error?.message}`).toBeUndefined();
    expect(result.isValid).toBe(true);
  });
});

describe('DNS identity record', () => {
  // Defect: the tag parser splits each `tag=value` on every "=" and keeps
  // only pairs of exactly two parts, so a `p=` value that ends in base64
  // padding is dropped. RSA-2048 keys encode without padding; 3072-bit and
  // 4096-bit keys do not.
  it('resolves a 3072-bit public key', async () => {
    const { publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 3072,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    expect(pemToBase64(publicKey).endsWith('='), 'fixture: expected a padded key').toBe(true);
    mockResolveTxt.mockResolvedValue(keyTxt(publicKey));

    const resolved = await resolvePublicKey('finance$big.test', 'btps1').catch(() => undefined);

    expect(resolved, 'no public key was resolved').toBeDefined();
    expect(getFingerprintFromPem(resolved as string)).toBe(getFingerprintFromPem(publicKey));
  });
});

describe('trust privacy type', () => {
  // Gap: a trust record carries the agreed `privacyType`, and the protocol
  // overview says to "enforce agreed privacy requirements strictly", but
  // nothing in the server reads the field.
  it('refuses an unencrypted document when the trust was agreed as encrypted', async () => {
    const record = {
      id: 'trust-id',
      senderId: ACME,
      receiverId: RECEIVER,
      status: 'accepted',
      createdAt: '2026-10-01T00:00:00.000Z',
      decidedBy: 'pay',
      decidedAt: '2026-10-01T00:00:00.000Z',
      publicKeyBase64: pemToBase64(acmeKeys.publicKey),
      publicKeyFingerprint: acmeKeys.fingerprint,
      keyHistory: [],
      privacyType: 'encrypted',
    } as BTPTrustRecord;
    const server = newServer({ getById: async () => record });
    const artifact = { ...deviceSignedArtifact('btps1'), type: 'BTPS_DOC' as const };
    expect(artifact.encryption).toBeNull();

    const { isTrusted } = await (
      server as unknown as {
        verifyTrust: (d: unknown) => Promise<{ isTrusted: boolean }>;
      }
    ).verifyTrust({ type: 'transporter', artifact });

    expect(isTrusted, 'an unencrypted document passed an encrypted-only trust').toBe(false);
  });
});

describe('server identity and middleware', () => {
  // Exposure: every middleware handler is passed `serverInstance`, and
  // getServerIdentity() returns the object the server was configured with,
  // private key included.
  it('does not hand the server private key to callers of getServerIdentity', () => {
    const identity = newServer().getServerIdentity() as Record<string, unknown>;

    expect(identity.identity).toBe('admin$client.test');
    expect('privateKey' in identity, 'the private key is readable by any middleware').toBe(false);
  });

  // Defect: defaultMiddleware.ts says its middleware "are used when no
  // external middleware file is specified", but MiddlewareManager returns
  // without loading anything when the file is absent, so a server started
  // without a middleware file has no rate limiting.
  it('loads the default middleware when there is no middleware file', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const manager = new MiddlewareManager('/no-such-dir/btps.middleware.mjs');

    await manager.loadMiddleware({
      trustStore: {} as AbstractTrustStore<BTPTrustRecord>,
    });

    expect(manager.getAllMiddleware().length).toBeGreaterThan(0);
  });

  // Defect: the example a developer copies registers handlers on a step that
  // does not exist, so MiddlewareManager skips them with a warning.
  it('the example middleware file only uses steps the server runs', () => {
    const steps = [
      'parsing',
      'signatureVerification',
      'trustVerification',
      'onArtifact',
      'onError',
    ];
    const source = readFileSync(join(process.cwd(), 'example.btps.middleware.mjs'), 'utf8');
    const used = [...source.matchAll(/step:\s*'([^']+)'/g)].map((m) => m[1]);

    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((step) => !steps.includes(step))).toEqual([]);
  });
});

describe('package entry points', () => {
  // Defect: BtpsTransporter is documented (docs/getting-started/server/
  // transporterSupport.md) but no entry point exports it.
  it('the client entry point exports BtpsTransporter', () => {
    expect(Object.keys(clientEntry)).toContain('BtpsTransporter');
  });
});
