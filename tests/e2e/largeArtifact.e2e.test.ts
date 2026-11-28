/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// Journey: one large artifact, about 190 MB on the wire: a letter of ten PDFs of 10.5 MB, signed
// and encrypted, delivered to a real BtpsServer over TLS, as a sender's client sends it. The
// server reads it in time that grows with the line (a reader that searched the whole line again on
// every network chunk took minutes, and its sender timed out), verifies it and keeps it.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createHash, randomBytes } from 'crypto';
import type { BTPTransporterArtifact } from '../../src/core/server/types.js';
import {
  addUser,
  artifactFrom,
  deliver,
  letterDocument,
  open,
  recordTrust,
  startProvider,
  type Provider,
  type User,
} from './harness.js';

vi.mock('dns/promises', async () => (await import('./zone.js')).dnsModule);

const FILES = 10;
const FILE_BYTES = 10.5 * 1024 * 1024;
const MB = 1024 * 1024;

const pdf = () => {
  const bytes = Buffer.concat([Buffer.from('%PDF-1.4\n'), randomBytes(FILE_BYTES - 9)]);
  return {
    content: bytes.toString('base64'),
    type: 'application/pdf' as const,
    filename: 'terms.pdf',
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
};

describe('a large artifact', () => {
  let vendorHost: Provider;
  let clientHost: Provider;
  let vendor: User;
  let client: User;

  beforeAll(async () => {
    // A provider that takes artifacts of up to 220 MB.
    const server = { maxArtifactSizeKb: 220 * 1024, connectionTimeoutMs: 60_000 };
    vendorHost = await startProvider('large-vendor.test', { server });
    clientHost = await startProvider('large-client.test', { server });
    vendor = await addUser(vendorHost, 'billing');
    client = await addUser(clientHost, 'pay');
    await recordTrust(clientHost.trustStore, vendor.identity, client.identity, 'accepted');
    await recordTrust(vendorHost.trustStore, vendor.identity, client.identity, 'accepted');
  });

  afterAll(() => {
    vendorHost.stop();
    clientHost.stop();
  });

  it(
    'delivers a letter of about 190 MB in seconds, at a CPU cost that grows with its size',
    { timeout: 240_000 },
    async () => {
      const attachments = Array.from({ length: FILES }, pdf);
      const document = letterDocument({ attachments });
      const sent = await artifactFrom(vendor, client.identity, 'BTPS_DOC', document);
      const wireBytes = Buffer.byteLength(JSON.stringify(sent));
      expect(wireBytes).toBeGreaterThan(180 * MB);

      const cpu = process.cpuUsage();
      const started = performance.now();
      const { response, error } = await deliver(sent);
      const seconds = (performance.now() - started) / 1000;
      const used = process.cpuUsage(cpu);
      const cpuSeconds = (used.user + used.system) / 1e6;
      console.info(
        `[large artifact] ${(wireBytes / MB).toFixed(0)} MB delivered in ${seconds.toFixed(1)} s, ` +
          `${cpuSeconds.toFixed(1)} s of CPU (sender and server in this process)`,
      );

      expect(error).toBeUndefined();
      expect(response?.status).toMatchObject({ ok: true, code: 200 });
      // Answered well inside a sender's default 20 s wait. Reading alone took minutes before.
      expect(seconds).toBeLessThan(20);
      // Both sides' work on it, sending and receiving: a few seconds of CPU, not minutes.
      expect(cpuSeconds).toBeLessThan(30);

      const arrived = clientHost.inbox.find((a) => a.id === sent.id)!;
      const { payload, error: opened } = await open<BTPTransporterArtifact>(client, arrived);
      expect(opened).toBeUndefined();
      const received = payload?.document as unknown as { attachments: { sha256: string }[] };
      expect(received.attachments.map((one) => one.sha256)).toEqual(
        attachments.map((one) => one.sha256),
      );
    },
  );
});
