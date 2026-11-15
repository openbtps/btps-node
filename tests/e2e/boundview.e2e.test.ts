/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// Journey: a BoundView from a real preview to a receiver's screen. The
// sender's platform shows its own invoice preview in a browser, and
// snapshotBoundView captures it; the document goes over real BtpsServers and
// TLS; the receiving server is told, once signature and trust are checked,
// that it may be shown; the receiver opens it and renderBoundView draws it.
// The receiver's picture is the sender's, byte for byte. Runs where Chrome is
// installed (as on GitHub's runners), and is skipped where it is not.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import type { BTPBoundView, BTPBoundViewResult } from '../../src/core/server/schemas/boundView.js';
import type { BTPTransporterArtifact } from '../../src/core/server/types.js';
import { renderBoundView } from '../../packages/boundview/src/index.js';
import { chrome, previewInvoice, startCapture } from '../../packages/boundview/test/browser/capture.js';
import { addUser, artifactFrom, deliver, open, recordTrust, startProvider, type Provider, type User } from './harness.js';

vi.mock('dns/promises', async () => (await import('./zone.js')).dnsModule);

const sha256 = (bytes: Uint8Array | null) => createHash('sha256').update(bytes ?? new Uint8Array()).digest('hex');

describe.skipIf(!chrome)('journey: a BoundView from a real preview to the receiver', () => {
  let vendorHost: Provider;
  let clientHost: Provider;
  let vendor: User;
  let client: User;
  let browser: Awaited<ReturnType<typeof startCapture>>;
  let document: typeof previewInvoice & { boundView: BTPBoundView };
  // What the receiving server told its platform about each arrival's BoundView.
  const told = new Map<string, BTPBoundViewResult | undefined>();

  beforeAll(async () => {
    vendorHost = await startProvider('vendor.test');
    clientHost = await startProvider('client.test');
    vendor = await addUser(vendorHost, 'billing');
    client = await addUser(clientHost, 'pay');
    // The client takes documents in the clear too, so its server can read and check one.
    await recordTrust(clientHost.trustStore, vendor.identity, client.identity, 'accepted', { privacyType: 'mixed' });
    clientHost.server.onIncomingArtifact('Transporter', (artifact, boundView) => {
      told.set(artifact.id, boundView);
    });

    browser = await startCapture();
    const { view, error } = await browser.capture(previewInvoice);
    if (!view) throw new Error(`the preview could not be captured: ${error}`);
    document = { ...previewInvoice, boundView: view };
  }, 60_000);

  afterAll(async () => {
    vendorHost?.stop();
    clientHost?.stop();
    await browser?.close();
  });

  it('is checked by the receiving server, and drawn by the receiver as the sender drew it', async () => {
    const sent = await artifactFrom(vendor, client.identity, 'BTPS_DOC', document, { encrypt: false });
    expect(sent.version).toBe('1.2.0');
    expect((await deliver(sent)).response?.status.ok).toBe(true);
    expect(told.get(sent.id)).toEqual({ show: true });

    const arrived = clientHost.inbox.find((artifact) => artifact.id === sent.id) as BTPTransporterArtifact;
    const sendersPicture = await renderBoundView(document);
    const receiversPicture = await renderBoundView(arrived.document);
    expect(sendersPicture).not.toBeNull();
    expect(sha256(receiversPicture)).toBe(sha256(sendersPicture));
  });

  it('is checked when an encrypted document is opened, and drawn the same', async () => {
    const sent = await artifactFrom(vendor, client.identity, 'BTPS_DOC', document);
    expect((await deliver(sent)).response?.status.ok).toBe(true);
    // The server cannot read it, so it has nothing to say about its BoundView.
    expect(told.get(sent.id)).toBeUndefined();

    const arrived = clientHost.inbox.find((artifact) => artifact.id === sent.id) as BTPTransporterArtifact;
    const { payload, error, boundView } = await open<BTPTransporterArtifact>(client, arrived);
    expect(error).toBeUndefined();
    expect(boundView).toEqual({ show: true });
    expect(sha256(await renderBoundView(payload?.document))).toBe(sha256(await renderBoundView(document)));
  });

  it('is accepted but never drawn when the preview it came from hid a fact', async () => {
    // The sender's design draws a panel over the amount due after the snapshot was taken.
    const covered = {
      ...document,
      boundView: {
        ...document.boundView,
        elements: [
          ...document.boundView.elements,
          { type: 'rect' as const, x: 0, y: 0, width: document.boundView.page.width, height: document.boundView.page.height, fill: '#ffffff' },
        ],
      },
    };
    const sent = await artifactFrom(vendor, client.identity, 'BTPS_DOC', covered, { encrypt: false });
    expect((await deliver(sent)).response?.status.ok).toBe(true);
    expect(told.get(sent.id)?.show).toBe(false);
    const arrived = clientHost.inbox.find((artifact) => artifact.id === sent.id) as BTPTransporterArtifact;
    expect(arrived.document).toEqual(covered);
    expect(await renderBoundView(arrived.document)).toBeNull();
  });
});
