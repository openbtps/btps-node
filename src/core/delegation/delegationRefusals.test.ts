/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// A delegated artifact a receiver refuses: each way a delegation, its
// attestation or the artifact inside it can fail verifyDelegation. The
// delegations are made by BtpsDelegator; keys come from a resolver, and who a
// domain's operator is from DNS, as a receiver learns it.

import { describe, it, expect, vi } from 'vitest';
import { generateKeyPairSync } from 'crypto';
import { resolveTxt } from 'dns/promises';
import { BtpsDelegator } from './BtpsDelegator.js';
import { verifyDelegation } from './verifyTransporterSignature.js';
import { PemSigner, signBtpPayload } from '../crypto/index.js';
import {
  BTP_ERROR_ATTESTATION_VERIFICATION,
  BTP_ERROR_DELEGATION_INVALID,
  BTP_ERROR_DELEGATION_SIG_VERIFICATION,
  BTP_ERROR_RESOLVE_PUBKEY,
  BTP_ERROR_SIG_VERIFICATION,
} from '../error/index.js';
import type { BtpsKeyResolver } from '../crypto/keyResolver.js';
import type { BTPDelegation, BTPTransporterArtifact } from '../server/types.js';

vi.mock('dns/promises', () => ({ resolveTxt: vi.fn() }));
vi.mocked(resolveTxt).mockImplementation(async (name: string) => {
  const hosts: Record<string, string> = {
    '_btps.host.saas.test': 'v=1.0.0; u=btps.saas.test:3443; s=btps1; op=admin$saas.test',
    '_btps.host.bobco.test': 'v=1.0.0; u=btps.saas.test:3443; s=btps1; op=admin$saas.test',
    '_btps.host.other.test': 'v=1.0.0; u=btps.other.test:3443; s=btps1; op=admin$other.test',
    // A domain that names no operator: no one may delegate for it but its users themselves.
    '_btps.host.nobody.test': 'v=1.0.0; u=btps.nobody.test:3443; s=btps1',
  };
  if (hosts[name]) return [[hosts[name]]];
  throw Object.assign(new Error(`queryTxt ENOTFOUND ${name}`), { code: 'ENOTFOUND' });
});

const keyPair = () =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
const saasKeys = keyPair();
const ownerKeys = keyPair();
const deviceKeys = keyPair();
const strangerKeys = keyPair();

const keys: Record<string, string> = {
  'admin$saas.test': saasKeys.publicKey,
  'bob$bobco.test': ownerKeys.publicKey,
  'eve$other.test': strangerKeys.publicKey,
};
const resolver = (known = keys): BtpsKeyResolver => ({
  async resolvePublicKey(identity) {
    return known[identity];
  },
});

const artifactFrom = (from: string, signedBy = deviceKeys) => {
  const unsigned = {
    version: '1.0.0',
    id: `artifact-${from}`,
    type: 'BTPS_DOC' as const,
    from,
    to: 'alice$other.test',
    issuedAt: new Date().toISOString(),
    encryption: null,
    document: 'document',
    selector: 'btps1',
  };
  return { ...unsigned, signature: signBtpPayload(unsigned, signedBy) } as BTPTransporterArtifact;
};

// Each delegator checks its own key against the resolver, as against DNS.
const delegatedBy = (identity: string, privateKey: string) =>
  new BtpsDelegator({ identity, privateKey, keyResolver: resolver() });

type Delegated = BTPTransporterArtifact & { delegation: BTPDelegation };

describe('a delegated artifact a receiver refuses', () => {
  it('is delegated by someone neither its sender nor its domain’s operator', async () => {
    const delegated = await delegatedBy('eve$other.test', strangerKeys.privateKey).delegateArtifact(
      'device-1',
      deviceKeys.publicKey,
      artifactFrom('bob$bobco.test'),
    );

    const { isValid, error } = await verifyDelegation(delegated, resolver());

    expect(isValid).toBe(false);
    expect(error?.code).toBe(BTP_ERROR_DELEGATION_INVALID.code);
    expect(String(error?.cause)).toContain('is not the operator of bob$bobco.test');
  });

  it('is delegated by its operator for a domain that names none', async () => {
    const delegated = await delegatedBy('admin$saas.test', saasKeys.privateKey).delegateArtifact(
      'device-1',
      deviceKeys.publicKey,
      artifactFrom('carol$nobody.test'),
    );

    const { error } = await verifyDelegation(delegated, resolver());

    expect(error?.code).toBe(BTP_ERROR_DELEGATION_INVALID.code);
    expect(String(error?.cause)).toContain('declares no operator');
  });

  it('delegates itself with no attestation', async () => {
    const delegated = await delegatedBy('bob$bobco.test', ownerKeys.privateKey).delegateArtifact(
      'device-1',
      deviceKeys.publicKey,
      artifactFrom('bob$bobco.test'),
    );

    const { error } = await verifyDelegation(delegated, resolver());

    expect(error?.code).toBe(BTP_ERROR_DELEGATION_INVALID.code);
    expect(String(error?.cause)).toContain('requires attestation');
  });

  describe('delegated by its owner and attested', () => {
    const attested = () =>
      delegatedBy('admin$saas.test', saasKeys.privateKey).delegateArtifact(
        'device-1',
        deviceKeys.publicKey,
        artifactFrom('bob$bobco.test'),
        { identity: 'bob$bobco.test', keyPair: ownerKeys },
      );

    it('is taken as made', async () => {
      expect(await verifyDelegation(await attested(), resolver())).toMatchObject({ isValid: true });
    });

    it('is refused attested by anyone but the domain’s operator', async () => {
      const delegated = await attested();
      const byStranger: Delegated = {
        ...delegated,
        delegation: {
          ...delegated.delegation,
          attestation: { ...delegated.delegation.attestation!, signedBy: 'eve$other.test' },
        },
      };

      const { error } = await verifyDelegation(byStranger, resolver());

      expect(error?.code).toBe(BTP_ERROR_ATTESTATION_VERIFICATION.code);
      expect(String(error?.cause)).toContain('is not the operator');
    });

    it('is refused when the attestation is not over this delegation', async () => {
      const delegated = await attested();
      const otherAgent: Delegated = {
        ...delegated,
        delegation: { ...delegated.delegation, agentId: 'device-2' },
      };

      const { error } = await verifyDelegation(otherAgent, resolver());

      expect(error?.code).toBe(BTP_ERROR_ATTESTATION_VERIFICATION.code);
    });

    it("is refused when the attestor's key cannot be found", async () => {
      const { 'admin$saas.test': _gone, ...rest } = keys;

      const { error } = await verifyDelegation(await attested(), resolver(rest));

      expect(error?.code).toBe(BTP_ERROR_RESOLVE_PUBKEY.code);
    });
  });

  it("carries an artifact the agent's key did not sign", async () => {
    // The delegation is good; the artifact inside it is signed by another key.
    const delegated = await delegatedBy('admin$saas.test', saasKeys.privateKey).delegateArtifact(
      'device-1',
      deviceKeys.publicKey,
      artifactFrom('bob$bobco.test', strangerKeys),
    );

    const { isValid, error } = await verifyDelegation(delegated, resolver());

    expect(isValid).toBe(false);
    expect(error?.code).toBe(BTP_ERROR_DELEGATION_SIG_VERIFICATION.code);
    expect(String(error?.cause)).toContain('original artifact signature');
  });

  it('is delegated by a delegator whose key cannot be found', async () => {
    const delegated = await delegatedBy('admin$saas.test', saasKeys.privateKey).delegateArtifact(
      'device-1',
      deviceKeys.publicKey,
      artifactFrom('bob$bobco.test'),
    );
    const { 'admin$saas.test': _gone, ...rest } = keys;

    const { error } = await verifyDelegation(delegated, resolver(rest));

    expect(error?.code).toBe(BTP_ERROR_RESOLVE_PUBKEY.code);
    expect(String(error?.cause)).toContain('Delegator admin$saas.test public key not found');
  });
});

describe('a delegator', () => {
  it('attests with a key held elsewhere, a signer, as with its own', async () => {
    const delegator = new BtpsDelegator({
      identity: 'admin$saas.test',
      signer: new PemSigner(saasKeys),
      keyResolver: resolver(),
    });

    const delegated = await delegator.delegateArtifact(
      'device-1',
      deviceKeys.publicKey,
      artifactFrom('bob$bobco.test'),
      { identity: 'bob$bobco.test', keyPair: ownerKeys },
    );

    expect(await verifyDelegation(delegated, resolver())).toMatchObject({ isValid: true });
  });

  it('will not delegate for someone whose domain names no host', async () => {
    await expect(
      delegatedBy('admin$saas.test', saasKeys.privateKey).delegateArtifact(
        'device-1',
        deviceKeys.publicKey,
        artifactFrom('bob$bobco.test'),
        { identity: 'dan$nowhere.test', keyPair: ownerKeys },
      ),
    ).rejects.toMatchObject({ code: BTP_ERROR_SIG_VERIFICATION.code });
  });
});
