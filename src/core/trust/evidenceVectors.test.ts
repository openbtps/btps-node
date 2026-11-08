/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// The evidence bundles of the golden vectors, through verifyEvidenceBundle,
// describeEvidenceFacts and buildEvidenceBundle: every bundle's facts as its
// vector expects them, as verify-btps-vectors also checks, and each kind of
// bundle as text. Plus keys no bundle should carry.

import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  buildEvidenceBundle,
  describeEvidenceFacts,
  verifyEvidenceBundle,
  type BTPEvidenceBundle,
} from './evidence.js';
import type { BTPStatementRecord } from './types.js';

type Case = {
  name: string;
  bundle: BTPEvidenceBundle;
  options?: { trustedTimestampRoots?: string[]; anchors?: string[] };
  expect: Record<string, unknown>;
};
const { bundles } = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../test/vectors/agreements.vectors.json'), 'utf8'),
) as { bundles: Case[] };
const named = (name: string) => {
  const found = bundles.find((c) => c.name === name);
  if (!found) throw new Error(`no vector ${name}`);
  return found;
};
const keyOfBundle =
  (bundle: BTPEvidenceBundle) =>
  (identity: string, selector: string): string | undefined =>
    bundle.keys.find((k) => k.identity === identity && k.selector === selector)?.publicKey;

describe('the golden vectors’ evidence bundles', () => {
  it.each(bundles.map((c) => [c.name, c] as const))('report %s as expected', async (_name, c) => {
    expect(await verifyEvidenceBundle(c.bundle, c.options)).toMatchObject(c.expect);
  });

  it('read as text: a device’s keys, a timestamp, and what does not hold', async () => {
    const device = named('complete-with-a-device-signed-acceptance');
    const deviceText = describeEvidenceFacts(await verifyEvidenceBundle(device.bundle));
    expect(deviceText).toMatch(/\(device, delegated by [^)]+\)/);
    expect(deviceText).toContain('   delegation key ');

    const stamped = named('timestamped-by-a-trusted-authority');
    const stampedText = describeEvidenceFacts(
      await verifyEvidenceBundle(stamped.bundle, stamped.options),
    );
    expect(stampedText).toMatch(
      /timestamped .+ by .+: over this statement yes, signed yes, an authority's certificate yes, trusted yes/,
    );

    const unstamped = describeEvidenceFacts(await verifyEvidenceBundle(stamped.bundle));
    expect(unstamped).toContain('trusted no roots given');

    const notAnAuthority = named('timestamp-by-a-certificate-not-for-time-stamping');
    expect(
      describeEvidenceFacts(
        await verifyEvidenceBundle(notAnAuthority.bundle, notAnAuthority.options),
      ),
    ).toContain("an authority's certificate NO");

    const misattached = named('a-term-that-is-not-its-attachment');
    expect(describeEvidenceFacts(await verifyEvidenceBundle(misattached.bundle))).toMatch(
      /terms are its attachments\s+NO/,
    );
  });

  it('are built again from their agreement and records, a device’s delegator’s key included', () => {
    const { bundle } = named('complete-with-a-device-signed-acceptance');
    const rebuilt = buildEvidenceBundle(
      { originator: bundle.originator, agreement: bundle.agreement, statements: bundle.statements },
      keyOfBundle(bundle),
    );
    // Only the keys its signatures need: the vector's bundle carries every party's.
    const inVector = new Set(bundle.keys.map((k) => `${k.identity} ${k.selector}`));
    expect(rebuilt.keys.every((k) => inVector.has(`${k.identity} ${k.selector}`))).toBe(true);
    const delegator = bundle.statements.find((r) => r.delegatedArtifact)?.delegatedArtifact
      ?.delegation.signedBy;
    expect(rebuilt.keys.some((k) => k.identity === delegator)).toBe(true);
  });

  it('are built with an attested device’s attestor’s key too', () => {
    const { bundle } = named('complete-with-a-device-signed-acceptance');
    const [byDevice, ...rest] = bundle.statements;
    const delegated = byDevice?.delegatedArtifact;
    if (!byDevice || !delegated) throw new Error('the vector names a device first');
    const attestor = bundle.originator;
    const attested = {
      ...byDevice,
      delegatedArtifact: {
        ...delegated,
        delegation: {
          ...delegated.delegation,
          attestation: {
            signedBy: attestor,
            issuedAt: delegated.delegation.issuedAt,
            selector: 'btps1',
            signature: delegated.delegation.signature,
          },
        },
      },
    } as BTPStatementRecord;

    const rebuilt = buildEvidenceBundle(
      {
        originator: bundle.originator,
        agreement: bundle.agreement,
        statements: [attested, ...rest],
      },
      keyOfBundle(bundle),
    );

    expect(rebuilt.keys.some((k) => k.identity === attestor)).toBe(true);
  });
});

describe('a bundle with a key no reader can use', () => {
  it('counts no key that is not a public key, and names no fingerprint for it', async () => {
    const { bundle } = named('complete-sequential-with-identity-keys');
    const broken = {
      ...bundle,
      keys: bundle.keys.map((k) =>
        k.identity === bundle.originator ? { ...k, publicKey: 'not a public key' } : k,
      ),
    };

    const facts = await verifyEvidenceBundle(broken);

    expect(facts.originatorSignatureValid).toBe(false);
    expect(facts.originatorKey.fingerprint).toBeUndefined();
    expect(describeEvidenceFacts(facts)).toContain('fingerprint none in the bundle');
  });

  it('names no fingerprint for a device key that is not a public key', async () => {
    const { bundle } = named('complete-with-a-device-signed-acceptance');
    const [byDevice, ...rest] = bundle.statements;
    const delegated = byDevice?.delegatedArtifact;
    if (!byDevice || !delegated) throw new Error('the vector names a device first');
    const broken = {
      ...bundle,
      statements: [
        {
          ...byDevice,
          delegatedArtifact: {
            ...delegated,
            delegation: { ...delegated.delegation, agentPubKey: 'not a public key' },
          },
        },
        ...rest,
      ],
    };

    const facts = await verifyEvidenceBundle(broken);

    expect(facts.statements[0]?.signatureValid).toBe(false);
    expect(facts.statements[0]?.key).toEqual({ identity: byDevice.statement.signer });
  });
});
