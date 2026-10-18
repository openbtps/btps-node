/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// Journey: a SaaS sends for its users. A user's device signs the invoice, the
// SaaS (its domain's operator) delegates it, and the receiver accepts it as
// the user's. A business on its own domain, hosted by the SaaS, signs its own
// delegation and the SaaS attests it. Nobody else may delegate.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { BtpsDelegator } from '../../src/core/delegation/BtpsDelegator.js';
import { signBtpPayload } from '../../src/core/crypto/index.js';
import { BTP_PROTOCOL_VERSION } from '../../src/core/server/constants/index.js';
import type { BTPTransporterArtifact } from '../../src/core/server/types.js';
import {
  BTP_ERROR_ATTESTATION_VERIFICATION,
  BTP_ERROR_DELEGATION_INVALID,
} from '../../src/core/error/index.js';
import {
  addUser,
  deliver,
  invoiceDocument,
  newKeys,
  publishHost,
  publishKey,
  recordTrust,
  startProvider,
  type Provider,
  type User,
} from './harness.js';

vi.mock('dns/promises', async () => (await import('./zone.js')).dnsModule);

const deviceKeys = newKeys();

/** An invoice a user's device signed, still to be delegated. */
const deviceSigned = (from: string, to: string, selector: string): BTPTransporterArtifact => {
  const unsigned = {
    version: BTP_PROTOCOL_VERSION,
    id: crypto.randomUUID(),
    issuedAt: new Date().toISOString(),
    type: 'BTPS_DOC' as const,
    from,
    to,
    selector,
    encryption: null,
    document: invoiceDocument(),
  };
  return { ...unsigned, signature: signBtpPayload(unsigned, deviceKeys) } as BTPTransporterArtifact;
};

describe('journey: a SaaS sends for its users', () => {
  let saas: Provider;
  let clientHost: Provider;
  let client: User;
  let delegator: BtpsDelegator;

  beforeAll(async () => {
    saas = await startProvider('saas.test');
    clientHost = await startProvider('client.test');
    client = await addUser(clientHost, 'pay');
    delegator = new BtpsDelegator({
      identity: saas.operator,
      privateKey: saas.operatorKeys.privateKey,
    });
    // Trust from the SaaS users the journeys send as, at the client.
    for (const sender of ['alice$saas.test', 'mallory$saas.test', 'bob$bobco.test']) {
      await recordTrust(clientHost.trustStore, sender, client.identity, 'accepted', {
        privacyType: 'mixed',
      });
    }
  });

  afterAll(() => {
    saas.stop();
    clientHost.stop();
  });

  it("delivers a managed user's invoice, delegated by the SaaS operator", async () => {
    const artifact = deviceSigned('alice$saas.test', client.identity, saas.selector);
    const delegated = await delegator.delegateArtifact(
      'btps_ag_alice-phone',
      deviceKeys.publicKey,
      artifact,
    );

    const { response } = await deliver(delegated);

    expect(response?.status).toMatchObject({ ok: true, code: 200 });
  });

  it('refuses a delegation by another user on the same domain, though her key is published', async () => {
    const mallory = await addUser(saas, 'mallory');
    const impostor = new BtpsDelegator({
      identity: mallory.identity,
      privateKey: mallory.keys.privateKey,
    });
    const artifact = deviceSigned('alice$saas.test', client.identity, saas.selector);
    const delegated = await impostor.delegateArtifact(
      'btps_ag_mallory',
      deviceKeys.publicKey,
      artifact,
    );

    const { response } = await deliver(delegated);

    expect(response?.status).toMatchObject({ code: 401, error: BTP_ERROR_DELEGATION_INVALID.code });
  });

  it('delivers for a business on its own domain hosted by the SaaS, attested by the SaaS', async () => {
    // bobco.test names the SaaS as its operator and hosts nothing itself.
    publishHost('bobco.test', { port: saas.port, selector: 'btps1', operator: saas.operator });
    const owner: User = {
      identity: 'bob$bobco.test',
      keys: newKeys(),
      selector: 'btps1',
      provider: saas,
    };
    publishKey(owner.identity, 'btps1', owner.keys.publicKey);
    const artifact = deviceSigned(owner.identity, client.identity, 'btps1');

    const delegated = await delegator.delegateArtifact(
      'btps_ag_bob',
      deviceKeys.publicKey,
      artifact,
      {
        identity: owner.identity,
        keyPair: owner.keys,
      },
    );

    expect(delegated.delegation.attestation?.signedBy).toBe(saas.operator);
    expect((await deliver(delegated)).response?.status).toMatchObject({ ok: true, code: 200 });
  });

  it('refuses an attestation by anyone but the domain operator', async () => {
    const other = await startProvider('other.test');
    const otherDelegator = new BtpsDelegator({
      identity: other.operator,
      privateKey: other.operatorKeys.privateKey,
    });
    const owner = { identity: 'bob$bobco.test', keys: newKeys() };
    publishKey(owner.identity, 'btps1', owner.keys.publicKey);
    const artifact = deviceSigned(owner.identity, client.identity, 'btps1');

    const delegated = await otherDelegator.delegateArtifact(
      'btps_ag_bob',
      deviceKeys.publicKey,
      artifact,
      { identity: owner.identity, keyPair: owner.keys },
    );

    const { response } = await deliver(delegated);
    other.stop();

    expect(response?.status).toMatchObject({
      code: 401,
      error: BTP_ERROR_ATTESTATION_VERIFICATION.code,
    });
  });
});
