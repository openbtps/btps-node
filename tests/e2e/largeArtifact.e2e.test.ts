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
import type { BtpsServerOptions } from '../../src/server/types.js';
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

// Journey: many large artifacts at once, to a server that reads only so many at a time. Each
// takes a place before its first byte is read; the rest wait, held back by TCP, with nothing of
// them in memory; past the queue, the next is told to send again later.
describe('large artifacts arriving at once', () => {
  const hosts: Provider[] = [];
  let vendor: User;

  /** A receiving provider with `limits`, trusting `vendor`, and one of its users. */
  const receiver = async (domain: string, limits: Partial<BtpsServerOptions>) => {
    const host = await startProvider(domain, {
      server: { maxArtifactSizeKb: 64 * 1024, connectionTimeoutMs: 60_000, ...limits },
    });
    hosts.push(host);
    const user = await addUser(host, 'pay');
    await recordTrust(host.trustStore, vendor.identity, user.identity, 'accepted');
    return { host, user };
  };

  /** `count` letters of two 10.5 MB PDFs each, about 38 MB on the wire, made before any is sent. */
  const letters = (to: User, count: number) =>
    Promise.all(
      Array.from({ length: count }, () =>
        artifactFrom(
          vendor,
          to.identity,
          'BTPS_DOC',
          letterDocument({ attachments: [pdf(), pdf()] }),
        ),
      ),
    );

  const codeOf = ({ response, error }: Awaited<ReturnType<typeof deliver>>) =>
    response?.status?.code ?? (error as { code?: unknown } | undefined)?.code;

  beforeAll(async () => {
    const vendorHost = await startProvider('busy-vendor.test');
    hosts.push(vendorHost);
    vendor = await addUser(vendorHost, 'billing');
  });

  afterAll(() => hosts.forEach((host) => host.stop()));

  it(
    'reads one at a time, queues one, and tells the next to send again later; then takes it',
    { timeout: 240_000 },
    async () => {
      const { host, user } = await receiver('busy-one.test', {
        maxArtifactsInFlight: 1,
        maxArtifactsWaiting: 1,
      });
      const sent = await letters(user, 4);

      const answers = await Promise.all(sent.slice(0, 3).map((artifact) => deliver(artifact)));
      const codes = answers.map(codeOf);
      expect(codes.filter((code) => code === 200)).toHaveLength(2);
      expect(codes.filter((code) => code === 503)).toHaveLength(1);

      // Places free once answered: the one told to send again later is taken when it does.
      expect(codeOf(await deliver(sent[codes.indexOf(503)]!))).toBe(200);
      expect(codeOf(await deliver(sent[3]!))).toBe(200);
      expect(host.inbox).toHaveLength(4);
    },
  );

  it(
    'delivers every one, a place at a time, when the queue holds them all',
    { timeout: 240_000 },
    async () => {
      const { host, user } = await receiver('busy-queue.test', {
        maxArtifactsInFlight: 1,
        maxArtifactsWaiting: 10,
      });
      const sent = await letters(user, 4);

      const answers = await Promise.all(sent.map((artifact) => deliver(artifact)));
      expect(answers.map(codeOf)).toEqual([200, 200, 200, 200]);
      expect(host.inbox.map((a) => a.id).sort()).toEqual(sent.map((a) => a.id).sort());
    },
  );
});
