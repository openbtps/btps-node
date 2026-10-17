/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// Journey: keys rotate. The sender moves from btps1 to btps2 while the
// receiver stays on btps1, then the receiver moves too. Each artifact names
// its sender's own selector; each document is encrypted to the receiver's
// current one; old documents still open with the old key.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { pemToBase64 } from '../../src/core/utils/index.js';
import { decryptVerify } from '../../src/core/crypto/index.js';
import { BTP_ERROR_RESOLVE_PUBKEY, BTP_ERROR_SIG_MISMATCH } from '../../src/core/error/index.js';
import type { BTPTransporterArtifact } from '../../src/core/server/types.js';
import {
  addUser,
  artifactFrom,
  deliver,
  invoiceDocument,
  newKeys,
  publishHost,
  publishKey,
  recordTrust,
  startProvider,
  unpublishKey,
  type Keys,
  type Provider,
  type User,
} from './harness.js';

vi.mock('dns/promises', async () => (await import('./zone.js')).dnsModule);

describe('journey: keys rotate on both sides', () => {
  let vendorHost: Provider;
  let clientHost: Provider;
  let vendor: User;
  let client: User;
  let vendorOldKeys: Keys;
  let clientOldKeys: Keys;
  let signedBeforeRotation: BTPTransporterArtifact;
  let encryptedToOldKey: BTPTransporterArtifact;

  beforeAll(async () => {
    vendorHost = await startProvider('vendor.test');
    clientHost = await startProvider('client.test');
    vendor = await addUser(vendorHost, 'billing');
    client = await addUser(clientHost, 'pay');
    vendorOldKeys = vendor.keys;
    clientOldKeys = client.keys;
    await recordTrust(clientHost.trustStore, vendor.identity, client.identity, 'accepted');
    signedBeforeRotation = await artifactFrom(
      vendor,
      client.identity,
      'BTPS_DOC',
      invoiceDocument(),
    );
    encryptedToOldKey = signedBeforeRotation;
  });

  afterAll(() => {
    vendorHost.stop();
    clientHost.stop();
  });

  it('the sender rotates to btps2: new artifacts name btps2 and verify with the new key', async () => {
    const next = newKeys();
    publishKey(vendor.identity, 'btps2', next.publicKey);
    publishHost('vendor.test', {
      port: vendorHost.port,
      selector: 'btps2',
      operator: vendorHost.operator,
    });
    vendor = { ...vendor, keys: next, selector: 'btps2' };

    const invoice = await artifactFrom(vendor, client.identity, 'BTPS_DOC', invoiceDocument());

    expect(invoice.selector).toBe('btps2');
    expect((await deliver(invoice)).response?.status).toMatchObject({ ok: true, code: 200 });
  });

  it('an artifact signed before the rotation still verifies while btps1 is published', async () => {
    const { response } = await deliver(signedBeforeRotation);

    expect(response?.status).toMatchObject({ ok: true, code: 200 });
  });

  it('refuses an artifact that names btps2 but was signed with the old key', async () => {
    const mislabelled = await artifactFrom(
      { ...vendor, keys: vendorOldKeys },
      client.identity,
      'BTPS_DOC',
      invoiceDocument(),
    );

    const { response } = await deliver(mislabelled);

    expect(response?.status).toMatchObject({ code: 401, error: BTP_ERROR_SIG_MISMATCH.code });
  });

  it('once btps1 is withdrawn, an artifact naming btps1 is refused: its key is gone', async () => {
    unpublishKey(vendor.identity, 'btps1');
    const late = await artifactFrom(
      { ...vendor, keys: vendorOldKeys, selector: 'btps1' },
      client.identity,
      'BTPS_DOC',
      invoiceDocument(),
    );

    const { response } = await deliver(late);

    expect(response?.status).toMatchObject({ code: 401, error: BTP_ERROR_RESOLVE_PUBKEY.code });
  });

  it('the receiver rotates to btps2: documents are encrypted to its new key, and old ones still open with the old key', async () => {
    const next = newKeys();
    publishKey(client.identity, 'btps2', next.publicKey);
    publishHost('client.test', {
      port: clientHost.port,
      selector: 'btps2',
      operator: clientHost.operator,
    });
    client = { ...client, keys: next, selector: 'btps2' };

    const invoice = await artifactFrom(vendor, client.identity, 'BTPS_DOC', invoiceDocument());
    const { response } = await deliver(invoice);

    expect(response?.status).toMatchObject({ ok: true, code: 200 });
    // The sender still names its own selector, not the receiver's.
    expect(invoice.selector).toBe('btps2');
    const vendorKey = vendor.keys.publicKey;
    const opened = await decryptVerify(vendorKey, invoice as never, next.privateKey);
    expect(opened.error).toBeUndefined();
    expect(
      await decryptVerify(vendorKey, invoice as never, clientOldKeys.privateKey),
    ).toMatchObject({
      payload: undefined,
    });
    const old = await decryptVerify(
      vendorOldKeys.publicKey,
      encryptedToOldKey as never,
      clientOldKeys.privateKey,
    );
    expect(old.error).toBeUndefined();
    expect(pemToBase64(next.publicKey)).not.toBe(pemToBase64(clientOldKeys.publicKey));
  });
});
