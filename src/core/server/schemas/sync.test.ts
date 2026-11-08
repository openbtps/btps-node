/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.2: a sync is an artifact.send to the user's own address, naming the
 * send it copies in `syncOf` on its envelope (readable, since the document is
 * encrypted to the user's own key), and a send's outcome is the provider's own
 * record, `meta.delivery`, on a sentbox result.
 */

import { describe, expect, it } from 'vitest';
import { createHash, generateKeyPairSync } from 'crypto';
import { BtpTransporterArtifactSchema } from './artifacts/transporterSchema.js';
import { BtpAgentArtifactSchema } from './artifacts/agentSchema.js';
import { BtpQueryResultEntrySchema } from './responseSchema.js';
import { BtpsAgent } from '../../../client/btpsAgent.js';
import { BtpsAgentCommandCallSchema } from '../../../client/libs/schema.js';
import { artifactVersion } from '../constants/index.js';
import { canonicalizeValue, syncOfArtifact } from '../../crypto/index.js';

const issuedAt = new Date().toISOString();
const sha256 = 'a'.repeat(64);
const artifact = (from: string, to: string) => ({
  version: '1.2.0',
  issuedAt,
  id: 'sync-1',
  type: 'BTPS_DOC',
  from,
  to,
  selector: 'btps1',
  signature: { algorithmHash: 'sha256', value: 'AA==', fingerprint: 'AA==' },
  encryption: {
    algorithm: 'aes-256-gcm',
    encryptedKey: 'AA==',
    iv: 'AA==',
    authTag: 'AA==',
    type: 'standardEncrypt',
  },
  document: 'ciphertext',
  syncOf: { id: 'artifact-1', sha256 },
});

describe('a sync', () => {
  it("names the send it copies on its envelope, to the user's own address", () => {
    const parsed = BtpTransporterArtifactSchema.safeParse(
      artifact('alice$saas.example', 'alice$saas.example'),
    );

    expect(parsed.success && Reflect.get(parsed.data, 'syncOf')).toEqual({
      id: 'artifact-1',
      sha256,
    });
  });

  it('is to the sender its own address however it is written', () => {
    expect(
      BtpTransporterArtifactSchema.safeParse(artifact('Alice$SaaS.example', 'alice$saas.example'))
        .success,
    ).toBe(true);
  });

  it('is refused to any address but the sender its own', () => {
    expect(
      BtpTransporterArtifactSchema.safeParse(artifact('alice$saas.example', 'pay$client.example'))
        .success,
    ).toBe(false);
  });

  it('names the copied send by a SHA-256 in lowercase hex', () => {
    const sync = artifact('alice$saas.example', 'alice$saas.example');

    expect(
      BtpTransporterArtifactSchema.safeParse({
        ...sync,
        syncOf: { id: 'artifact-1', sha256: 'ABC' },
      }).success,
    ).toBe(false);
  });

  it('is refused in a 1.1.0 artifact, and stamps its artifact 1.2.0', () => {
    const sync = artifact('alice$saas.example', 'alice$saas.example');

    expect(BtpTransporterArtifactSchema.safeParse({ ...sync, version: '1.1.0' }).success).toBe(
      false,
    );
    expect(artifactVersion(sync)).toBe('1.2.0');
  });

  it("names a send by the SHA-256 of the sent artifact's RFC 8785 form, signature included", () => {
    const sent = artifact('alice$saas.example', 'pay$client.example');
    const expected = createHash('sha256').update(canonicalizeValue(sent), 'utf8').digest('hex');

    expect(syncOfArtifact(sent)).toEqual({ id: 'sync-1', sha256: expected });
  });
});

describe("a device's sync", () => {
  const keys = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const agentArtifact = (action: string) => ({
    id: 'agent-1',
    issuedAt,
    version: '1.2.0',
    action,
    agentId: 'btps_ag_1',
    to: 'alice$saas.example',
    signature: { algorithmHash: 'sha256', value: 'AA==', fingerprint: 'AA==' },
    encryption: null,
    document: artifact('alice$saas.example', 'alice$saas.example'),
  });

  it('travels only inside its artifact.send', () => {
    const request = { ...artifact('alice$saas.example', 'alice$saas.example'), type: 'TRUST_REQ' };
    const { syncOf: _syncOf, ...plainRequest } = request;
    const trustRequest = (document: object) =>
      BtpAgentArtifactSchema.safeParse({ ...agentArtifact('trust.request'), document }).success;

    expect(BtpAgentArtifactSchema.safeParse(agentArtifact('artifact.send')).success).toBe(true);
    expect(trustRequest(plainRequest)).toBe(true);
    expect(trustRequest(request)).toBe(false);
  });

  it('is asked for on artifact.send only', () => {
    const invoice = {
      type: 'invoice',
      title: 'October',
      id: 'INV-1',
      issuedAt,
      totalAmount: { amount: 150000, currency: 'AUD' },
      lineItems: { columns: ['Item', 'Amount'], rows: [{ Item: 'Build', Amount: 150000 }] },
    };
    const call = (actionType: string, document: object, syncOf?: object) =>
      BtpsAgentCommandCallSchema.safeParse({
        actionType,
        to: 'alice$saas.example',
        document,
        options: syncOf ? { syncOf } : {},
      }).success;
    const draft = { type: 'BTPS_DOC', document: invoice };
    const syncOf = { id: 'artifact-1', sha256 };

    expect(call('artifact.send', invoice, syncOf)).toBe(true);
    expect(call('draft.create', draft)).toBe(true);
    expect(call('draft.create', draft, syncOf)).toBe(false);
  });

  it("is refused to anyone but the device's own address, before anything is looked up", async () => {
    const agent = new BtpsAgent({
      agent: { id: 'btps_ag_1', identityKey: keys.privateKey, identityCert: keys.publicKey },
      btpIdentity: 'alice$saas.example',
      host: 'btps.saas.example',
    });

    const { error } = await agent['buildTransportArtifact']({
      actionType: 'artifact.send',
      to: 'pay$client.example',
      document: {
        type: 'letter',
        title: 'Hello',
        id: 'LET-1',
        issuedAt,
        body: { format: 'text', content: 'Hi' },
      },
      options: { signature: { algorithmHash: 'sha256' }, syncOf: { id: 'artifact-1', sha256 } },
    });

    expect(error?.cause).toMatch(/own address/);
  });
});

describe("a send's outcome on a sentbox result", () => {
  const sent = artifact('alice$saas.example', 'pay$client.example');
  const { syncOf: _syncOf, ...send } = { ...sent, version: '1.1.0' };

  it('is taken as delivered, with when', () => {
    expect(
      BtpQueryResultEntrySchema.safeParse({
        artifact: send,
        meta: { delivery: { status: 'delivered', at: issuedAt } },
      }).success,
    ).toBe(true);
  });

  it('is taken as failed, with its code', () => {
    expect(
      BtpQueryResultEntrySchema.safeParse({
        artifact: send,
        meta: {
          delivery: { status: 'failed', code: 'BTP_ERROR_TRUST_NOT_ALLOWED', at: issuedAt },
        },
      }).success,
    ).toBe(true);
  });

  it('is refused with a status that is not pending, delivered or failed', () => {
    expect(
      BtpQueryResultEntrySchema.safeParse({
        artifact: send,
        meta: { delivery: { status: 'lost', at: issuedAt } },
      }).success,
    ).toBe(false);
  });

  it('is refused failed without being able to say when', () => {
    expect(
      BtpQueryResultEntrySchema.safeParse({
        artifact: send,
        meta: { delivery: { status: 'failed', code: 'BTP_ERROR_TRUST_NOT_ALLOWED' } },
      }).success,
    ).toBe(false);
  });
});
