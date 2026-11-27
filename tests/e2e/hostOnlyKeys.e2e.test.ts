/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// Journey: an identity whose key is not in DNS, as a provider's many hosted addresses are, signs. Its key is found
// as an encryption key is: DNS first, then its host, in an answer the domain's operator signed, for the selector
// the signature names. A receiver checks a document it signed, and a cosignature it made at its own selector,
// through that answer, and refuses one the domain's named operator did not vouch for. It rotates its key as any
// identity does, by a chain its host serves: a signature by the key it left is taken within a receiver's grace and
// refused after it. The operator's own key is DNS's alone: no host vouches for it.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { BtpsClient } from '../../src/client/btpsClient.js';
import { cosign } from '../../src/core/trust/cosignatures.js';
import { signKeyRotation } from '../../src/core/trust/keyRotation.js';
import { computeId } from '../../src/core/utils/index.js';
import { BTP_PROTOCOL_VERSION } from '../../src/core/server/constants/index.js';
import { BTP_ERROR_IDENTITY_NOT_FOUND, BTP_ERROR_KEY_RETIRED } from '../../src/core/error/index.js';
import {
  addUser,
  artifactFrom,
  deliver,
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

const secondsAgo = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();

describe('journey: a hosted identity, with no key in DNS, signs', () => {
  let saas: Provider;
  let vendorHost: Provider;
  let strictHost: Provider;
  let alice: User;
  let bob: User;
  let strict: User;

  beforeAll(async () => {
    saas = await startProvider('saas.test');
    vendorHost = await startProvider('vendor.test');
    strictHost = await startProvider('strict.test', { server: { retiredKeyGraceSeconds: 5 } });
    alice = await addUser(saas, 'alice', 'host');
    bob = await addUser(vendorHost, 'bob');
    strict = await addUser(strictHost, 'pay');
    await recordTrust(vendorHost.trustStore, alice.identity, bob.identity, 'accepted');
  });

  afterAll(() => {
    for (const host of [saas, vendorHost, strictHost]) host.stop();
  });

  const invoiceFrom = (from: User, to: User = bob) =>
    artifactFrom(from, to.identity, 'BTPS_DOC', invoiceDocument({ id: `INV-${randomUUID()}` }));

  it('has its document taken: the receiver finds its key from its host, as it would to encrypt to it', async () => {
    const { response } = await deliver(await invoiceFrom(alice));

    expect(response?.status).toMatchObject({ ok: true, code: 200 });
  });

  it('has a document signed with any other key refused, though the host vouches for its real one', async () => {
    const { response } = await deliver(await invoiceFrom({ ...alice, keys: newKeys() }));

    expect(response?.status).toMatchObject({ ok: false, code: 401 });
  });

  it("has a document refused when the domain's host record names another operator than the one who answers", async () => {
    publishHost('saas.test', { port: saas.port, selector: 'btps1', operator: 'someone$saas.test' });
    try {
      const { response } = await deliver(await invoiceFrom(alice));

      expect(response?.status).toMatchObject({ ok: false, code: 401 });
    } finally {
      publishHost('saas.test', { port: saas.port, selector: 'btps1', operator: saas.operator });
    }
  });

  it('has a cosignature it made at its own selector taken, found the same way', async () => {
    const id = randomUUID();
    const relatesTo = randomUUID();
    vendorHost.trustStore.remember({ id: relatesTo, from: alice.identity, to: bob.identity });
    const ref = { originator: bob.identity, id: 'AGR-HOSTED', contentSha256: 'c'.repeat(64) };
    const cosignature = await cosign({
      statement: {
        agreement: ref,
        terms: [],
        signer: alice.identity,
        artifactId: id,
        decision: 'accepted',
        signedAt: new Date().toISOString(),
      },
      recipients: [alice, bob].map((user) => ({
        identity: user.identity,
        publicKey: user.keys.publicKey,
      })),
      by: { selector: alice.selector, pemFiles: alice.keys },
    });
    const event = await artifactFrom(
      alice,
      bob.identity,
      'BTPS_EVENT',
      {
        type: 'agreement_event',
        id,
        occurredAt: new Date().toISOString(),
        eventType: 'accepted',
        agreement: ref,
      },
      { extra: { id, relatesTo, cosignatures: [cosignature] } },
    );

    expect((await deliver(event)).response?.status).toMatchObject({ ok: true, code: 200 });
  });

  it('rotates its key by a chain its host serves: the key it left is taken within the grace, refused after, the new one by all', async () => {
    // Carol's provider moved her from btps1 to btps2 thirty seconds ago, and keeps both keys and the chain.
    const carol = await addUser(saas, 'carol', 'host');
    const next: Keys = newKeys();
    const rotation = await signKeyRotation(
      {
        identity: carol.identity,
        from: { selector: 'btps1' },
        to: { selector: 'btps2' },
        at: secondsAgo(30),
        prev: null,
      },
      { from: { pemFiles: carol.keys }, to: { pemFiles: next } },
    );
    const record = (keys: Keys, selector: string) => ({
      selector,
      publicKey: keys.publicKey,
      keyType: 'rsa' as const,
      version: BTP_PROTOCOL_VERSION,
      createdAt: new Date().toISOString(),
    });
    await saas.identityStore.update(computeId(carol.identity), {
      currentSelector: 'btps2',
      publicKeys: [record(carol.keys, 'btps1'), record(next, 'btps2')],
      keyChain: [rotation],
    });
    await recordTrust(vendorHost.trustStore, carol.identity, bob.identity, 'accepted');
    await recordTrust(strictHost.trustStore, carol.identity, strict.identity, 'accepted');
    const carolAt = (keys: Keys, selector: string): User => ({ ...carol, keys, selector });

    // A day's grace at the vendor, five seconds at the strict receiver.
    expect(
      (await deliver(await invoiceFrom(carolAt(carol.keys, 'btps1')))).response?.status,
    ).toMatchObject({
      ok: true,
    });
    expect(
      (await deliver(await invoiceFrom(carolAt(carol.keys, 'btps1'), strict))).response?.status,
    ).toMatchObject({ code: 401, error: BTP_ERROR_KEY_RETIRED.code });
    for (const to of [bob, strict]) {
      expect(
        (await deliver(await invoiceFrom(carolAt(next, 'btps2'), to))).response?.status,
      ).toMatchObject({
        ok: true,
      });
    }
  });

  it("never asks a host to vouch for its domain's operator, whose key is DNS's alone", async () => {
    unpublishKey(saas.operator, 'btps1');
    try {
      const { response, error } = await new BtpsClient({
        to: saas.operator,
        btpMtsOptions: senderTls,
        maxRetries: 0,
      }).resolveIdentity(saas.operator, bob.identity);

      expect(response).toBeUndefined();
      expect(error?.code).toBe(BTP_ERROR_IDENTITY_NOT_FOUND.code);
      expect(String(error?.cause)).toContain('found in DNS only');
    } finally {
      publishKey(saas.operator, 'btps1', saas.operatorKeys.publicKey);
    }
  });
});
