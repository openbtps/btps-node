/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// Journey: an identity's keys rotate along a signed chain. The vendor rotates
// as planned, then with immediate expiry; its host serves the chain; every
// receiver checks each arrival's key against it, whatever DNS still has.
// A SaaS user, whose keys only its host knows, rotates too, and loses a key.
// An agreement both signed before, with keys since rotated away, still checks
// offline from its evidence bundle, which keeps their chains.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { computeId } from '../../src/core/utils/index.js';
import {
  contentKeyOpens,
  createDefaultKeyResolver,
  decryptVerify,
  wrapContentKeyFor,
} from '../../src/core/crypto/index.js';
import {
  BTP_ERROR_KEY_RETIRED,
  BTP_ERROR_KEY_REVOKED,
  BTP_ERROR_RESOLVE_PUBKEY,
} from '../../src/core/error/index.js';
import { BTP_PROTOCOL_VERSION } from '../../src/core/server/constants/index.js';
import { agreementRef, signAgreement, signStatement } from '../../src/core/trust/agreements.js';
import { buildEvidenceBundle, verifyEvidenceBundle } from '../../src/core/trust/evidence.js';
import {
  keyChainRecordHash,
  signKeyExpiry,
  signKeyRotation,
} from '../../src/core/trust/keyRotation.js';
import type { BTPKeyChainRecord } from '../../src/core/trust/types.js';
import type { BTPTransporterArtifact } from '../../src/core/server/types.js';
import {
  addUser,
  artifactFrom,
  deliver,
  fingerprintOf,
  invoiceDocument,
  newKeys,
  publishHost,
  publishKey,
  recordTrust,
  senderTls,
  startProvider,
  unpublishKey,
  type Keys,
  type Provider,
  type User,
} from './harness.js';

vi.mock('dns/promises', async () => (await import('./zone.js')).dnsModule);

const VENDOR = 'billing$vendor.example';
const JANE = 'jane$vendor.example';
const secondsAgo = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();

describe('journey: keys rotate along a signed chain', () => {
  let vendorHost: Provider;
  let clientHost: Provider;
  let strictHost: Provider;
  let client: User;
  let strict: User;
  const [k1, k2, k3] = [newKeys(), newKeys(), newKeys()];
  const [j1, j2, j3] = [newKeys(), newKeys(), newKeys()];
  const vendorChain: BTPKeyChainRecord[] = [];
  const janeChain: BTPKeyChainRecord[] = [];

  // A receiver that asks for the sender's chain on every arrival (no cache).
  const receiving = (domain: string, more: object = {}) =>
    startProvider(domain, {
      server: {
        keyResolver: createDefaultKeyResolver({
          from: `admin$${domain}`,
          btpMtsOptions: senderTls,
          keyChainMaxCacheSeconds: 0,
        }),
        ...more,
      },
    });

  const vendorAt = (keys: Keys, selector: string): User => ({
    identity: VENDOR,
    keys,
    selector,
    provider: vendorHost,
  });

  /** The vendor's host keeps each identity's chain in its identity store, as a provider writes it. */
  const keepChain = async (identity: string, chain: BTPKeyChainRecord[], publicKeys = []) => {
    const id = computeId(identity);
    const stored = await vendorHost.identityStore.getById(id);
    if (stored) await vendorHost.identityStore.update(id, { keyChain: [...chain] });
    else
      await vendorHost.identityStore.create(
        {
          identity,
          currentSelector: 'btps1',
          publicKeys,
          keyChain: [...chain],
          createdAt: new Date().toISOString(),
        },
        id,
      );
  };

  /** The vendor's domain moves `s=`; its operator re-publishes its unchanged key under it. */
  const moveDomainTo = (selector: string) => {
    publishHost('vendor.example', {
      port: vendorHost.port,
      selector,
      operator: vendorHost.operator,
    });
    publishKey(vendorHost.operator, selector, vendorHost.operatorKeys.publicKey);
  };

  const send = async (from: User, to: User) => {
    const artifact = await artifactFrom(from, to.identity, 'BTPS_DOC', invoiceDocument());
    return (await deliver(artifact)).response?.status;
  };

  beforeAll(async () => {
    vendorHost = await startProvider('vendor.example');
    clientHost = await receiving('client.example');
    strictHost = await receiving('strict.example', { retiredKeyGraceSeconds: 5 });
    publishKey(VENDOR, 'btps1', k1.publicKey);
    client = await addUser(clientHost, 'pay');
    strict = await addUser(strictHost, 'pay');
    for (const [host, user] of [
      [clientHost, client],
      [strictHost, strict],
    ] as const) {
      await recordTrust(host.trustStore, VENDOR, user.identity, 'accepted');
      await recordTrust(host.trustStore, JANE, user.identity, 'accepted');
    }
  });

  afterAll(() => {
    for (const host of [vendorHost, clientHost, strictHost]) host?.stop();
  });

  it('changes nothing for an identity that never rotated', async () => {
    expect(await send(vendorAt(k1, 'btps1'), client)).toMatchObject({ ok: true });
  });

  it('takes a key rotated away as planned within its grace, and refuses it after, though DNS still has it', async () => {
    vendorChain.push(
      await signKeyRotation(
        {
          identity: VENDOR,
          from: { selector: 'btps1' },
          to: { selector: 'btps2' },
          at: secondsAgo(30),
          prev: null,
        },
        { from: { pemFiles: k1 }, to: { pemFiles: k2 } },
      ),
    );
    await keepChain(VENDOR, vendorChain);
    publishKey(VENDOR, 'btps2', k2.publicKey);
    moveDomainTo('btps2');

    // A day's grace at the client, five seconds at the strict receiver.
    expect(await send(vendorAt(k1, 'btps1'), client)).toMatchObject({ ok: true });
    expect(await send(vendorAt(k1, 'btps1'), strict)).toMatchObject({
      code: 401,
      error: BTP_ERROR_KEY_RETIRED.code,
    });
    expect(await send(vendorAt(k2, 'btps2'), strict)).toMatchObject({ ok: true });

    // With btps1's record retired, the chain still carries the key.
    unpublishKey(VENDOR, 'btps1');
    expect(await send(vendorAt(k1, 'btps1'), client)).toMatchObject({ ok: true });
    expect(await send(vendorAt(k1, 'btps1'), strict)).toMatchObject({
      error: BTP_ERROR_KEY_RETIRED.code,
    });
  });

  it('refuses a key rotated with immediate expiry at once, even backdated and with its record still in DNS', async () => {
    vendorChain.push(
      await signKeyRotation(
        {
          identity: VENDOR,
          from: { selector: 'btps2' },
          to: { selector: 'btps3' },
          at: secondsAgo(10),
          prev: keyChainRecordHash(vendorChain.at(-1)!),
          expiry: 'immediate',
          compromisedSince: secondsAgo(60),
          reason: 'compromised',
        },
        { from: { pemFiles: k2 }, to: { pemFiles: k3 } },
      ),
    );
    await keepChain(VENDOR, vendorChain);
    publishKey(VENDOR, 'btps3', k3.publicKey);
    moveDomainTo('btps3');

    const backdated = await artifactFrom(
      vendorAt(k2, 'btps2'),
      client.identity,
      'BTPS_DOC',
      invoiceDocument(),
      {
        extra: { issuedAt: secondsAgo(120) },
      },
    );
    expect((await deliver(backdated)).response?.status).toMatchObject({
      code: 401,
      error: BTP_ERROR_KEY_REVOKED.code,
    });
    expect(await send(vendorAt(k3, 'btps3'), client)).toMatchObject({ ok: true });
  });

  it("refuses a thief's own key, which is no key of the chain the host serves", async () => {
    const thief = newKeys();
    expect(await send(vendorAt(thief, 'btps9'), client)).toMatchObject({
      error: BTP_ERROR_RESOLVE_PUBKEY.code,
    });
  });

  it("rotates a SaaS user's key through its host, and its lost key on the operator's authority", async () => {
    const record = (keys: Keys, selector: string) => ({
      selector,
      publicKey: keys.publicKey,
      keyType: 'rsa' as const,
      version: BTP_PROTOCOL_VERSION,
      createdAt: new Date().toISOString(),
    });
    janeChain.push(
      await signKeyRotation(
        {
          identity: JANE,
          from: { selector: 'btps1' },
          to: { selector: 'btps2' },
          at: secondsAgo(30),
          prev: null,
        },
        { from: { pemFiles: j1 }, to: { pemFiles: j2 } },
      ),
    );
    await keepChain(JANE, janeChain, [record(j2, 'btps2')] as never);
    const jane = (keys: Keys, selector: string): User => ({
      identity: JANE,
      keys,
      selector,
      provider: vendorHost,
    });

    expect(await send(jane(j2, 'btps2'), client)).toMatchObject({ ok: true });
    expect(await send(jane(j1, 'btps1'), strict)).toMatchObject({
      error: BTP_ERROR_KEY_RETIRED.code,
    });

    // Jane loses j2: her provider rotates to j3 without its signature.
    janeChain.push(
      await signKeyRotation(
        {
          identity: JANE,
          from: { selector: 'btps2', publicKey: j2.publicKey },
          to: { selector: 'btps3' },
          at: secondsAgo(5),
          prev: keyChainRecordHash(janeChain.at(-1)!),
          expiry: 'immediate',
          compromisedSince: secondsAgo(20),
          reason: 'lost',
        },
        { to: { pemFiles: j3 } },
      ),
    );
    await keepChain(JANE, janeChain);
    expect(await send(jane(j3, 'btps3'), client)).toMatchObject({ ok: true });
    expect(await send(jane(j2, 'btps2'), client)).toMatchObject({
      error: BTP_ERROR_KEY_REVOKED.code,
    });
  });

  it('keeps an agreement signed with keys since rotated away checking offline, its chains and their answers in its evidence', async () => {
    // Signed before the rotations, with keys DNS no longer has.
    const agreement = await signAgreement(
      {
        type: 'agreement',
        title: 'Service terms',
        id: 'AGR-1',
        issuedAt: secondsAgo(600),
        body: { format: 'text', content: 'Twelve months of service.' },
        acceptance: { terms: [], signers: [{ address: JANE }], signingOrder: 'any' },
      },
      { originator: VENDOR, selector: 'btps1', pemFiles: k1 },
    );
    const statement = await signStatement(
      {
        agreement: agreementRef(agreement, VENDOR),
        terms: [],
        signer: JANE,
        decision: 'accepted',
        signedAt: secondsAgo(500),
      },
      { selector: 'btps1', pemFiles: j1 },
    );

    // Each signer's chain, as its host serves it now, with the operator's signed answer.
    const resolver = createDefaultKeyResolver({
      from: client.identity,
      btpMtsOptions: senderTls,
      keyChainMaxCacheSeconds: 0,
    });
    const keyChains = [];
    for (const identity of [VENDOR, JANE]) {
      const lookup = await resolver.resolveKeyChain!(identity);
      if (lookup.status !== 'chain') throw new Error(`no chain for ${identity}`);
      keyChains.push({ identity, records: lookup.records, operatorAnswer: lookup.answer });
    }
    // DNS has only the operator's key: the signers' keys come from their chains.
    const keyOf = (identity: string) =>
      identity === vendorHost.operator ? vendorHost.operatorKeys.publicKey : undefined;
    const bundle = buildEvidenceBundle(
      { originator: VENDOR, agreement, statements: [statement], keyChains },
      keyOf,
    );

    const facts = await verifyEvidenceBundle(JSON.parse(JSON.stringify(bundle)));
    const [planned] = vendorChain;
    expect(facts.complete).toBe(true);
    expect(facts.originatorKeyChain).toMatchObject({
      chainValid: true,
      keyInChain: true,
      signedInWindow: true,
      rotatedAt: planned && 'rotation' in planned ? planned.rotation.at : 'no rotation',
      reachesKey: fingerprintOf(k3.publicKey),
    });
    // Jane's chain has a lost key's rotation. Her operator's answer, kept whole, is there,
    // but its key is only the bundle's own: it confirms nothing until the reader trusts it.
    expect(facts.statements[0]?.keyChain).toMatchObject({
      chainValid: true,
      keyInChain: true,
      signedInWindow: true,
      authorityUnverified: true,
      operatorAnswer: {
        signedBy: vendorHost.operator,
        signatureValid: true,
        answersThisChain: true,
        operatorKeyAnchored: false,
      },
    });
    // A reader who kept the operator's fingerprint takes the answer.
    const operatorKept = await verifyEvidenceBundle(bundle, {
      anchors: [fingerprintOf(vendorHost.operatorKeys.publicKey)],
    });
    expect(operatorKept.statements[0]?.keyChain).toMatchObject({
      authorityUnverified: false,
      operatorAnswer: { operatorKeyAnchored: true },
    });

    // The bin as shipped (test:e2e builds the package), anchored on a fingerprint kept.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'btps-evidence-'));
    const file = path.join(dir, 'evidence.json');
    fs.writeFileSync(file, JSON.stringify(bundle));
    const cli = path.resolve(__dirname, '../../bin/verify-evidence-bundle.mjs');
    const run = (...args: string[]) =>
      spawnSync(process.execPath, [cli, file, ...args], { encoding: 'utf8' });
    const anchored = run('--json', '--anchor', fingerprintOf(k3.publicKey));
    expect(anchored.status, anchored.stderr).toBe(0);
    expect(JSON.parse(anchored.stdout).originatorKeyChain.anchored).toEqual({
      by: 'kept-fingerprint',
      upTo: fingerprintOf(k3.publicKey),
    });
    expect(run('--anchor').status).toBe(2);
    expect(run('--online').status).toBe(2);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('opens a stored document after its receiver moves to a new key, through a side-car, the artifact unchanged', async () => {
    const stored = await artifactFrom(
      vendorAt(k3, 'btps3'),
      client.identity,
      'BTPS_DOC',
      invoiceDocument(),
    );
    const before = JSON.stringify(stored);
    const next = newKeys();

    const sidecar = await wrapContentKeyFor(stored, client.keys.privateKey, next.publicKey);

    expect(sidecar.recipientFingerprint).toBe(fingerprintOf(next.publicKey));
    expect(await contentKeyOpens(stored, sidecar, next.privateKey)).toBe(true);
    const opened = await decryptVerify(
      k3.publicKey,
      stored as never,
      next.privateKey,
      sidecar.encryptedKey,
    );
    expect(opened.error).toBeUndefined();
    expect(JSON.stringify(stored)).toBe(before);
  });

  it("refuses a revoked key whose record is gone when the sender's host cannot be reached", async () => {
    // The known limit: with the host unreachable, DNS alone decides, and the
    // revoked key is refused only because its record was removed at once.
    unpublishKey(VENDOR, 'btps2');
    vendorHost.stop();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const artifact: BTPTransporterArtifact = await artifactFrom(
      vendorAt(k2, 'btps2'),
      client.identity,
      'BTPS_DOC',
      invoiceDocument(),
    );
    expect((await deliver(artifact)).response?.status).toMatchObject({
      code: 401,
      error: BTP_ERROR_RESOLVE_PUBKEY.code,
    });
  });
});

describe('journey: an expiry record for a key the identity already left', () => {
  let vendorHost: Provider;
  let clientHost: Provider;
  let client: User;
  const [k1, k2] = [newKeys(), newKeys()];

  beforeAll(async () => {
    vendorHost = await startProvider('vendor2.example');
    clientHost = await startProvider('client2.example', {
      server: {
        keyResolver: createDefaultKeyResolver({
          from: 'admin$client2.example',
          btpMtsOptions: senderTls,
          keyChainMaxCacheSeconds: 0,
        }),
      },
    });
    client = await addUser(clientHost, 'pay');
    await recordTrust(
      clientHost.trustStore,
      'billing$vendor2.example',
      client.identity,
      'accepted',
    );
  });

  afterAll(() => {
    vendorHost?.stop();
    clientHost?.stop();
  });

  it('refuses the expired key at once, within what would have been its grace', async () => {
    const identity = 'billing$vendor2.example';
    const rotation = await signKeyRotation(
      {
        identity,
        from: { selector: 'btps1' },
        to: { selector: 'btps2' },
        at: secondsAgo(30),
        prev: null,
      },
      { from: { pemFiles: k1 }, to: { pemFiles: k2 } },
    );
    const expiry = await signKeyExpiry(
      {
        identity,
        key: { selector: 'btps1', fingerprint: fingerprintOf(k1.publicKey) },
        compromisedSince: secondsAgo(300),
        reason: 'compromised',
        at: secondsAgo(1),
        prev: keyChainRecordHash(rotation),
      },
      { pemFiles: k2 },
    );
    await vendorHost.identityStore.create(
      {
        identity,
        currentSelector: 'btps2',
        publicKeys: [],
        keyChain: [rotation, expiry],
        createdAt: new Date().toISOString(),
      },
      computeId(identity),
    );
    publishKey(identity, 'btps1', k1.publicKey);
    publishKey(identity, 'btps2', k2.publicKey);
    publishHost('vendor2.example', {
      port: vendorHost.port,
      selector: 'btps2',
      operator: vendorHost.operator,
    });
    publishKey(vendorHost.operator, 'btps2', vendorHost.operatorKeys.publicKey);

    const old = await artifactFrom(
      { identity, keys: k1, selector: 'btps1', provider: vendorHost },
      client.identity,
      'BTPS_DOC',
      invoiceDocument(),
    );
    expect((await deliver(old)).response?.status).toMatchObject({
      error: BTP_ERROR_KEY_REVOKED.code,
    });
  });
});
