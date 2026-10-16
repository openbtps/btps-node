/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * The server enforces a trust's `privacyType`. Real
 * keys, end to end through parse, signature and trust; only DNS key lookup is
 * faked. Every privacy type × BTPS_DOC and BTPS_EVENT × encrypted and
 * unencrypted, and an event over the flipped record is governed by that record.
 *
 * Adapted from the failing test on `test/identity-lookup-failing`
 * (sdkDefects.test.ts, "trust privacy type"), which failed on master 2ac824f:
 * an unencrypted document passed an encrypted-only trust.
 */

import { describe, it, expect, beforeEach, vi, afterEach, type Mock } from 'vitest';
import crypto from 'crypto';
import tls, { type TLSSocket } from 'tls';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'events';
import { BtpsServer } from '../btpsServer.js';
import { signEncrypt } from '../../core/crypto/index.js';
import { AbstractTrustStore } from '../../core/trust/storage/AbstractTrustStore.js';
import { computeTrustId, isPrivacyAllowed } from '../../core/trust/index.js';
import { BTP_ERROR_TRUST_PRIVACY, getWireErrorRule, toWireError } from '../../core/error/index.js';
import type { BTPEncryptionType, BTPTrustRecord } from '../../core/trust/types.js';
import type { PemKeys } from '../../core/crypto/types.js';
import type { BTPServerResponse, BTPTransporterArtifact } from '../../core/server/types.js';
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

// The biller (B) sends the invoice; the payer (A) writes back.
const BILLER = 'billing$acme.example';
const PAYER = 'finance$client.example';
const keys: Record<string, PemKeys> = { [BILLER]: genKeys(), [PAYER]: genKeys() };

const VECTORS = new URL('../../../test/vectors/', import.meta.url);
const load = (path: string): unknown =>
  JSON.parse(readFileSync(new URL(path, VECTORS), 'utf8')) as unknown;

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
  /** An accepted trust from `senderId` to `receiverId`, stored under its computed id. */
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
      privacyType: 'mixed',
      ...overrides,
    });
  }
}

/** `from` sends `document` to `to` as `type`, signed with its key, encrypted when asked. */
const send = async (
  from: string,
  to: string,
  type: 'BTPS_DOC' | 'BTPS_EVENT',
  document: unknown,
  encrypted: boolean,
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

const PRIVACY_TYPES: BTPEncryptionType[] = ['unencrypted', 'encrypted', 'mixed'];
const allowed = (privacyType: BTPEncryptionType, encrypted: boolean) =>
  privacyType === 'mixed' || (privacyType === 'encrypted') === encrypted;

/**
 * Each way an artifact reaches the server here, all over the one trust the
 * biller holds to the payer (BILLER -> PAYER):
 * - a document from the biller, over the normal record;
 * - an event from the biller, over the normal record;
 * - an event from the payer, over the flipped record.
 */
const ROUTES = [
  {
    name: 'BTPS_DOC over the normal record',
    type: 'BTPS_DOC' as const,
    from: BILLER,
    to: PAYER,
    document: () => load('documents/invoice.v2.json'),
  },
  {
    name: 'BTPS_EVENT over the normal record',
    type: 'BTPS_EVENT' as const,
    from: BILLER,
    to: PAYER,
    document: () => load('events/response.accepts-paid.json'),
  },
  {
    name: 'BTPS_EVENT over the flipped record',
    type: 'BTPS_EVENT' as const,
    from: PAYER,
    to: BILLER,
    document: () => load('events/paid.by-payer.json'),
  },
];

const CASES = ROUTES.flatMap((route) =>
  PRIVACY_TYPES.flatMap((privacyType) =>
    [false, true].map((encrypted) => ({ ...route, privacyType, encrypted })),
  ),
);

describe('the server enforces privacyType', () => {
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

  it.each(CASES)(
    '$name, trust $privacyType, encrypted: $encrypted',
    async ({ type, from, to, document, privacyType, encrypted }) => {
      store.trust(BILLER, PAYER, { privacyType });
      const artifact = await send(from, to, type, document(), encrypted);
      expect(parses(artifact).error).toBeUndefined();
      expect(artifact.encryption !== null).toBe(encrypted);

      const result = await trusts(artifact);
      const response = await deliver(artifact);

      if (allowed(privacyType, encrypted)) {
        expect(result).toEqual({ isTrusted: true, error: undefined });
        expect(response.type).toBe('btps_response');
        expect(response.status.ok).toBe(true);
      } else {
        expect(result.isTrusted).toBe(false);
        expect(result.error?.code).toBe(BTP_ERROR_TRUST_PRIVACY.code);
        expect(response.type).toBe('btps_error');
        expect(response.status).toMatchObject({ ok: false, code: 403 });
        expect(response.code).toBe(BTP_ERROR_TRUST_PRIVACY.code);
      }
    },
  );

  it('governs an event over the flipped trust by the flipped record, not an inactive normal one', async () => {
    // The payer's own trust to the biller exists but is revoked, and says
    // unencrypted; the event is accepted over the biller's trust, which says encrypted.
    store.trust(BILLER, PAYER, { privacyType: 'encrypted' });
    store.trust(PAYER, BILLER, { status: 'revoked', privacyType: 'unencrypted' });
    const event = load('events/paid.by-payer.json');

    const plain = await send(PAYER, BILLER, 'BTPS_EVENT', event, false);
    const refused = await trusts(plain);
    expect(refused.isTrusted).toBe(false);
    expect(refused.error?.code).toBe(BTP_ERROR_TRUST_PRIVACY.code);
    expect(refused.error?.meta).toMatchObject({
      privacyType: 'encrypted',
      trustId: computeTrustId(BILLER, PAYER),
    });

    const sealed = await send(PAYER, BILLER, 'BTPS_EVENT', event, true);
    expect(await trusts(sealed)).toEqual({ isTrusted: true, error: undefined });
  });

  it('governs an event by the normal record when that one is active', async () => {
    store.trust(BILLER, PAYER, { privacyType: 'encrypted' });
    store.trust(PAYER, BILLER, { privacyType: 'unencrypted' });
    const event = load('events/paid.by-payer.json');

    expect(await trusts(await send(PAYER, BILLER, 'BTPS_EVENT', event, false))).toEqual({
      isTrusted: true,
      error: undefined,
    });
    const sealed = await trusts(await send(PAYER, BILLER, 'BTPS_EVENT', event, true));
    expect(sealed.error?.code).toBe(BTP_ERROR_TRUST_PRIVACY.code);
  });

  it('does not apply privacy to a trust request: it negotiates the agreement', async () => {
    // A pending request from the payer, agreed nothing yet: the request itself is not refused for its form.
    const request = {
      id: crypto.randomUUID(),
      name: 'Client Ltd',
      email: 'finance@client.example',
      reason: 'Invoices',
      phone: '+61000000000',
      privacyType: 'encrypted',
    };
    const artifact = await signEncrypt(
      BILLER,
      {
        accountName: 'finance',
        domainName: 'client.example',
        selector: 'btps1',
        pemFiles: keys[PAYER]!,
      },
      { version: '1.1.0', type: 'TRUST_REQ', from: PAYER, to: BILLER, document: request },
    );
    expect(artifact.error).toBeUndefined();
    const result = await trusts(artifact.payload as unknown as BTPTransporterArtifact);
    expect(result.error?.code).not.toBe(BTP_ERROR_TRUST_PRIVACY.code);
    expect(result.isTrusted).toBe(true);
  });

  it('a refusal is a 403, not retryable, sent under its own code', () => {
    expect(getWireErrorRule(BTP_ERROR_TRUST_PRIVACY.code)).toMatchObject({
      status: 403,
      retryable: false,
    });
    expect(toWireError(BTP_ERROR_TRUST_PRIVACY)).toEqual({
      code: BTP_ERROR_TRUST_PRIVACY.code,
      status: 403,
      message: BTP_ERROR_TRUST_PRIVACY.message,
      retryable: false,
    });
  });
});

describe('isPrivacyAllowed', () => {
  it.each([
    ['encrypted', true, true],
    ['encrypted', false, false],
    ['unencrypted', true, false],
    ['unencrypted', false, true],
    ['mixed', true, true],
    ['mixed', false, true],
  ] as const)('%s trust, encrypted %s: %s', (privacyType, encrypted, expected) => {
    expect(isPrivacyAllowed(privacyType, encrypted)).toBe(expected);
  });

  it('treats a record with no privacyType as mixed', () => {
    for (const absent of [undefined, null]) {
      expect(isPrivacyAllowed(absent, true)).toBe(true);
      expect(isPrivacyAllowed(absent, false)).toBe(true);
    }
  });

  it('allows nothing on a value it does not know', () => {
    const unknown = 'Encrypted' as unknown as BTPEncryptionType;
    expect(isPrivacyAllowed(unknown, true)).toBe(false);
    expect(isPrivacyAllowed(unknown, false)).toBe(false);
  });
});
