/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// Journey: how many attachments a document may carry. Every receiver takes 20 of each type, so a
// sender within it is never refused; a receiver may take more, and a sender may send fewer. A
// receiving server counts an unencrypted document's; an encrypted one is counted by the sender
// before it encrypts and by the receiver when it opens it.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createHash } from 'crypto';
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

const file = (i: number) => {
  const bytes = Buffer.from(`%PDF-1.4 terms ${i}`);
  return {
    content: bytes.toString('base64'),
    type: 'application/pdf' as const,
    filename: `terms-${i}.pdf`,
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
};
const letterWith = (count: number) =>
  letterDocument({ attachments: Array.from({ length: count }, (_, i) => file(i)) });

/** What a refusal says, from the server's answer or from signEncrypt / decryptVerify. */
const said = (error: unknown) =>
  `${(error as { message?: string })?.message ?? ''} ${String((error as { cause?: unknown })?.cause ?? '')}`;

describe('attachment limits, by type', () => {
  const hosts: Provider[] = [];
  let vendor: User;
  let standard: User;
  let roomy: User;
  let tight: User;
  let warn: ReturnType<typeof vi.spyOn>;

  /** A receiving provider with `server` options, trusting `vendor` either way, and one of its users. */
  const receiver = async (domain: string, server: Partial<BtpsServerOptions>) => {
    const host = await startProvider(domain, { server });
    hosts.push(host);
    const user = await addUser(host, 'pay');
    // Mixed: the vendor may send unencrypted, so the receiving server can count, or encrypted.
    const mixed = { privacyType: 'mixed' as const };
    await recordTrust(host.trustStore, vendor.identity, user.identity, 'accepted', mixed);
    await recordTrust(hosts[0]!.trustStore, vendor.identity, user.identity, 'accepted', mixed);
    return user;
  };

  const unencrypted = (to: User, count: number) =>
    artifactFrom(vendor, to.identity, 'BTPS_DOC', letterWith(count), { encrypt: false });

  beforeAll(async () => {
    const vendorHost = await startProvider('limits-vendor.test');
    hosts.push(vendorHost);
    vendor = await addUser(vendorHost, 'billing');
    standard = await receiver('limits-standard.test', {});
    roomy = await receiver('limits-roomy.test', {
      maxAttachments: { letter: 100, agreement: 100 },
    });
    // Below the 20 every receiver takes: warned about, and 20 is used.
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    tight = await receiver('limits-tight.test', { maxAttachments: { letter: 1 } });
  });

  afterAll(() => {
    warn.mockRestore();
    hosts.forEach((host) => host.stop());
  });

  it('every receiving server takes 20 of each; past its own limit, an unencrypted letter is refused', async () => {
    // A limit is a most, never a least: none, or a few, are always taken.
    for (const count of [0, 2, 20]) {
      expect((await deliver(await unencrypted(standard, count))).response?.status?.code).toBe(200);
    }
    const refused = await deliver(await unencrypted(standard, 21));
    expect(refused.response?.status?.code ?? (refused.error as { code?: number })?.code).toBe(400);
    expect(said(refused.error) + JSON.stringify(refused.response ?? {})).toMatch(
      /letter may carry at most 20 attachments here; it carries 21/,
    );

    expect((await deliver(await unencrypted(roomy, 50))).response?.status?.code).toBe(200);
  });

  it('a receiving server set below 20 takes 20 anyway, so no sender within it is refused', async () => {
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/below the 20 every receiver takes/));
    expect((await deliver(await unencrypted(tight, 20))).response?.status?.code).toBe(200);
  });

  it('a receiver opening an encrypted letter holds it to its own limit; the server could not count it', async () => {
    const sent = await artifactFrom(vendor, standard.identity, 'BTPS_DOC', letterWith(30), {
      maxAttachments: { letter: 30 },
    });
    expect((await deliver(sent)).response?.status?.code).toBe(200);

    const { error } = await open(standard, sent);
    expect(said(error)).toMatch(/letter may carry at most 20 attachments here; it carries 30/);
    expect((await open(standard, sent, { maxAttachments: { letter: 100 } })).error).toBeUndefined();
  });

  it('a sender may hold its own documents to fewer, and sends 20 of each without a setting', async () => {
    await expect(
      artifactFrom(vendor, standard.identity, 'BTPS_DOC', letterWith(2), {
        maxAttachments: { letter: 1 },
      }),
    ).rejects.toThrow();
    await expect(
      artifactFrom(vendor, standard.identity, 'BTPS_DOC', letterWith(20)),
    ).resolves.toBeDefined();
    await expect(
      artifactFrom(vendor, standard.identity, 'BTPS_DOC', letterWith(21)),
    ).rejects.toThrow();
    await expect(
      artifactFrom(vendor, roomy.identity, 'BTPS_DOC', letterWith(100), {
        maxAttachments: { letter: 100 },
      }),
    ).resolves.toBeDefined();
  });
});
