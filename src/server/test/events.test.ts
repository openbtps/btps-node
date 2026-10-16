/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.1 lifecycle events as BTPS_EVENT, through the server: trust and
 * ids. Real keys, end to end through parse, signature and trust; only DNS
 * key lookup is faked. Replay ((from, id) seen once) is tested in
 * replay.test.ts.
 */

import { describe, it, expect, beforeEach, vi, afterEach, type Mock } from 'vitest';
import crypto from 'crypto';
import tls, { type TLSSocket } from 'tls';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'events';
import { BtpsServer } from '../btpsServer.js';
import {
  decryptVerify,
  PemDecrypter,
  resolveSignatureKey,
  signEncrypt,
} from '../../core/crypto/index.js';
import { AbstractTrustStore } from '../../core/trust/storage/AbstractTrustStore.js';
import { computeTrustId, resolveEventTrust } from '../../core/trust/index.js';
import { parseBtpEventDoc, validateBtpEventEnvelope } from '../../core/server/schemas/helpers.js';
import { BTP_ERROR_TRUST_NON_EXISTENT, BTP_ERROR_TRUST_REVOKED } from '../../core/error/index.js';
import type { BTPTrustRecord } from '../../core/trust/types.js';
import type { PemKeys } from '../../core/crypto/types.js';
import type {
  BTPEventDoc,
  BTPServerResponse,
  BTPTransporterArtifact,
} from '../../core/server/types.js';
import type { BTPRequestCtx, BTPResponseCtx, ProcessedArtifact } from '../types.js';
import * as utils from '../../core/utils/index.js';

vi.mock('../../core/utils/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/utils/index.js')>();
  return { ...actual, resolvePublicKey: vi.fn(), getHostAndSelector: vi.fn() };
});

const genKeys = (): PemKeys => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
};

// The biller (B) sent the invoice; the payer (A) writes back. C is a third party.
const BILLER = 'billing$acme.example';
const PAYER = 'finance$client.example';
const OTHER = 'carol$other.example';
const keys: Record<string, PemKeys> = {
  [BILLER]: genKeys(),
  [PAYER]: genKeys(),
  [OTHER]: genKeys(),
};

const EVENTS = new URL('../../../test/vectors/events/', import.meta.url);
const load = (name: string): BTPEventDoc =>
  JSON.parse(readFileSync(new URL(name, EVENTS), 'utf8')) as BTPEventDoc;

class MapTrustStore extends AbstractTrustStore<BTPTrustRecord> {
  readonly records = new Map<string, BTPTrustRecord>();
  constructor() {
    super({ connection: null, entityName: 'map' });
  }
  async getById(id: string) {
    return this.records.get(id);
  }
  async getBySender() {
    return undefined;
  }
  async create(): Promise<BTPTrustRecord> {
    throw new Error('not used');
  }
  async update(): Promise<BTPTrustRecord> {
    throw new Error('not used');
  }
  async delete(): Promise<void> {}
  async getAll(): Promise<BTPTrustRecord[]> {
    return [...this.records.values()];
  }
  /** A trust from `senderId` to `receiverId`, stored under its computed id. */
  trust(senderId: string, receiverId: string, overrides: Partial<BTPTrustRecord> = {}) {
    const id = computeTrustId(senderId, receiverId);
    this.records.set(id, {
      id,
      senderId,
      receiverId,
      status: 'accepted',
      createdAt: '2026-10-01T00:00:00.000Z',
      decidedBy: 'admin',
      decidedAt: '2026-10-01T00:00:00.000Z',
      publicKeyBase64: 'key',
      publicKeyFingerprint: 'fp',
      keyHistory: [],
      // These tests are about direction; privacy is enforced (EBA-444) and tested in privacy.test.ts.
      privacyType: 'mixed',
      ...overrides,
    });
  }
}

/** `from` sends `document` to `to` as `type`, signed with its key, encrypted when asked. */
const send = async (
  from: string,
  to: string,
  document: unknown,
  {
    type = 'BTPS_EVENT',
    encrypted = false,
    id,
  }: { type?: string; encrypted?: boolean; id?: string } = {},
): Promise<BTPTransporterArtifact> => {
  const [accountName, domainName] = from.split('$') as [string, string];
  const { payload, error } = await signEncrypt(
    to,
    { accountName, domainName, selector: 'btps1', pemFiles: keys[from]! },
    {
      version: '1.1.0',
      type,
      from,
      to,
      document,
      ...(id ? { id } : {}),
      ...(encrypted ? { encryptionSelector: 'btps1' } : {}),
    },
    encrypted
      ? {
          signature: { algorithmHash: 'sha256' },
          encryption: { algorithm: 'aes-256-gcm', mode: 'standardEncrypt' },
        }
      : undefined,
  );
  expect(error).toBeUndefined();
  return payload as unknown as BTPTransporterArtifact;
};

describe('lifecycle events: BTPS_EVENT through the server', () => {
  let server: BtpsServer;
  let store: MapTrustStore;

  beforeEach(() => {
    vi.spyOn(tls, 'createServer').mockImplementation(
      () => new EventEmitter() as unknown as tls.Server,
    );
    vi.mocked(utils.resolvePublicKey).mockImplementation(
      async (identity: string) => keys[identity]?.publicKey,
    );
    vi.mocked(utils.getHostAndSelector).mockImplementation(async () => ({
      version: '1.1.0',
      host: 'btps.example:3443',
      selector: 'btps1',
    }));
    store = new MapTrustStore();
    server = new BtpsServer({
      trustStore: store,
      serverIdentity: { identity: 'server$acme.example', ...genKeys() },
      tlsOptions: { key: 'unused', cert: 'unused' },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const parses = (artifact: unknown) =>
    server['_parseAndValidateArtifact'](JSON.stringify(artifact));
  const trusts = (artifact: BTPTransporterArtifact) =>
    server['verifyTrust']({ artifact, type: 'transporter' } as ProcessedArtifact);

  /** Runs the whole request pipeline and returns what the server wrote back. */
  const deliver = async (artifact: BTPTransporterArtifact): Promise<BTPServerResponse> => {
    const socket = {
      destroyed: false,
      writableEnded: false,
      writable: true,
      write: vi.fn(),
      end: vi.fn(),
    } as unknown as TLSSocket;
    const data = { artifact, type: 'transporter' };
    const base = { socket, startTime: new Date().toISOString(), remoteAddress: '127.0.0.1', data };
    await server['executeRequestPipeline'](
      base as unknown as BTPRequestCtx<'before', 'signatureVerification'>,
      {
        ...base,
        reqId: 'req-1',
        responseSent: false,
        sendRes: () => {},
        sendError: () => {},
      } as unknown as BTPResponseCtx<'before', 'signatureVerification'>,
    );
    return JSON.parse((socket.write as Mock).mock.calls[0][0] as string) as BTPServerResponse;
  };

  describe('trust', () => {
    it('accepts an event over the flipped trust: the payer writes back to the biller', async () => {
      // The payer accepted the biller's trust request: the biller's server holds B -> A.
      store.trust(BILLER, PAYER);
      const artifact = await send(PAYER, BILLER, load('paid.by-payer.json'));

      expect(parses(artifact).error).toBeUndefined();
      expect(await trusts(artifact)).toEqual({ isTrusted: true, error: undefined });
      const response = await deliver(artifact);
      expect(response.type).toBe('btps_response');
      expect(response.status.ok).toBe(true);
    });

    it('accepts an event over the normal trust: the biller answers', async () => {
      store.trust(BILLER, PAYER);
      const artifact = await send(BILLER, PAYER, load('response.accepts-paid.json'));
      expect(await trusts(artifact)).toMatchObject({ isTrusted: true });
      expect((await deliver(artifact)).status.ok).toBe(true);
    });

    it('accepts only BTPS_EVENT over the flipped trust: a BTPS_DOC still needs its own', async () => {
      store.trust(BILLER, PAYER);
      const invoice = JSON.parse(
        readFileSync(new URL('../documents/invoice.v2.json', EVENTS), 'utf8'),
      );
      const artifact = await send(PAYER, BILLER, invoice, { type: 'BTPS_DOC' });
      expect(parses(artifact).error).toBeUndefined();
      const result = await trusts(artifact);
      expect(result.isTrusted).toBe(false);
      expect(result.error?.code).toBe(BTP_ERROR_TRUST_NON_EXISTENT.code);
      const response = await deliver(artifact);
      expect(response.type).toBe('btps_error');
    });

    it("refuses a third party's event: no trust either way", async () => {
      store.trust(BILLER, PAYER);
      // C writes to the biller about an invoice of its own: the structure is
      // fine, but there is no trust between C and the biller in either direction.
      const event = {
        ...load('paid.by-payer.json'),
        document: { ...load('paid.by-payer.json').document, from: BILLER },
      };
      const artifact = await send(OTHER, BILLER, event);
      expect(parses(artifact).error).toBeUndefined();
      const result = await trusts(artifact);
      expect(result.isTrusted).toBe(false);
      expect(result.error?.code).toBe(BTP_ERROR_TRUST_NON_EXISTENT.code);
      expect((await deliver(artifact)).type).toBe('btps_error');
    });

    it('refuses when neither record is active, with the reason of the one that exists', async () => {
      store.trust(BILLER, PAYER, { status: 'revoked' });
      const artifact = await send(PAYER, BILLER, load('paid.by-payer.json'));
      const result = await trusts(artifact);
      expect(result.isTrusted).toBe(false);
      expect(result.error?.code).toBe(BTP_ERROR_TRUST_REVOKED.code);

      store.trust(BILLER, PAYER, { status: 'pending' });
      expect((await trusts(artifact)).isTrusted).toBe(false);
      store.trust(BILLER, PAYER, { expiresAt: '2020-01-01T00:00:00.000Z' });
      expect((await trusts(artifact)).isTrusted).toBe(false);
    });

    it("never counts an agent's record", async () => {
      // A store that answers every lookup with an agent's active record.
      const agentRecord = {
        id: 'x',
        senderId: 'btps_ag_0b5e6a8e-1d1c-4b8e-9c55-2f7d3d1f2a10',
        receiverId: PAYER,
        status: 'accepted',
        createdAt: '2026-10-01T00:00:00.000Z',
        decidedBy: 'admin',
        decidedAt: '2026-10-01T00:00:00.000Z',
        publicKeyBase64: 'key',
        publicKeyFingerprint: 'fp',
        keyHistory: [],
        privacyType: 'encrypted',
      } as BTPTrustRecord;
      store.getById = vi.fn().mockResolvedValue(agentRecord);
      expect((await resolveEventTrust(PAYER, BILLER, store)).isTrusted).toBe(false);
      expect((await resolveEventTrust(agentRecord.senderId, PAYER, store)).isTrusted).toBe(false);

      // Nor a record stored under the pair's id that names another pair.
      store.getById = vi.fn().mockResolvedValue({ ...agentRecord, senderId: OTHER });
      expect((await resolveEventTrust(PAYER, BILLER, store)).isTrusted).toBe(false);
    });
  });

  describe('the envelope', () => {
    it('refuses an event about a document from someone else', async () => {
      store.trust(BILLER, PAYER);
      const event = load('paid.by-payer.json');
      const artifact = await send(PAYER, BILLER, {
        ...event,
        document: { ...event.document, from: OTHER },
      });
      expect(parses(artifact).error).toBe('VALIDATION');
    });

    it('refuses a third party sending about a document between two others', async () => {
      const artifact = await send(OTHER, PAYER, load('paid.by-payer.json'));
      expect(parses(artifact).error).toBe('VALIDATION');
    });

    it('refuses an event whose id differs from the artifact id', async () => {
      const artifact = await send(PAYER, BILLER, load('paid.by-payer.json'), {
        id: crypto.randomUUID(),
      });
      expect(parses(artifact).error).toBe('VALIDATION');
    });

    it("signEncrypt gives a BTPS_EVENT its event's id", async () => {
      const event = load('refund.json');
      const artifact = await send(BILLER, PAYER, event);
      expect(artifact.id).toBe(event.id);
    });

    it('refuses inReplyTo where the table forbids it, and requires it on a reply', async () => {
      const paid = { ...load('paid.by-payer.json'), inReplyTo: crypto.randomUUID() };
      expect(parses(await send(PAYER, BILLER, paid)).error).toBe('VALIDATION');
      const { inReplyTo: _unused, ...refund } = load('refund.json') as BTPEventDoc & {
        inReplyTo?: string;
      };
      expect(parses(await send(BILLER, PAYER, refund)).error).toBe('VALIDATION');
    });

    it('refuses an event sent as BTPS_DOC, and a document sent as BTPS_EVENT', async () => {
      expect(
        parses(await send(PAYER, BILLER, load('paid.by-payer.json'), { type: 'BTPS_DOC' })).error,
      ).toBe('VALIDATION');
      const invoice = JSON.parse(
        readFileSync(new URL('../documents/invoice.v2.json', EVENTS), 'utf8'),
      );
      expect(parses(await send(BILLER, PAYER, invoice)).error).toBe('VALIDATION');
    });
  });

  it('an encrypted event round-trips: parsed, verified and trusted opaque, then opened by the receiver', async () => {
    store.trust(BILLER, PAYER);
    const event = load('partially-paid.json');
    const artifact = await send(PAYER, BILLER, event, { encrypted: true });

    expect(artifact.id).toBe(event.id);
    expect(typeof artifact.document).toBe('string');
    expect(artifact.encryption).not.toBeNull();
    expect(parses(artifact).error).toBeUndefined();
    expect((await deliver(artifact)).status.ok).toBe(true);

    const { payload, error } = await decryptVerify(
      (await resolveSignatureKey(artifact))!,
      artifact as unknown as Parameters<typeof decryptVerify>[1],
      () => keys[BILLER]!.privateKey,
    );
    expect(error).toBeUndefined();
    expect(payload?.document).toEqual(event);

    // What the receiving platform does at `before onArtifact`, after decrypting.
    const parsed = parseBtpEventDoc(payload?.document);
    expect(parsed.error).toBeUndefined();
    expect(validateBtpEventEnvelope(parsed.data!, artifact)).toBeUndefined();
  });

  it('an encrypted event opens through a PemDecrypter', async () => {
    store.trust(BILLER, PAYER);
    const event = load('partially-paid.json');
    const artifact = await send(PAYER, BILLER, event, { encrypted: true });
    expect((await deliver(artifact)).status.ok).toBe(true);

    const decrypter = new PemDecrypter({ privateKey: keys[BILLER]!.privateKey });
    const decrypt = vi.spyOn(decrypter, 'decrypt');
    const { payload, error } = await decryptVerify(
      (await resolveSignatureKey(artifact))!,
      artifact as unknown as Parameters<typeof decryptVerify>[1],
      decrypter,
    );
    expect(error).toBeUndefined();
    expect(decrypt).toHaveBeenCalledTimes(1);
    expect(payload?.document).toEqual(event);
    expect(parseBtpEventDoc(payload?.document).error).toBeUndefined();
  });
});
