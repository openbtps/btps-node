/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.1 addendum item 10 (EBA-122). Reproduced 2026-10-04: agent
 * artifacts built by BtpsAgent for `artifact.send`, `trust.request` and
 * `sentbox.fetch` failed the server's own schema (BtpArtifactServerSchema),
 * and so did `event.send` and `trust.respond`. The first four carry the
 * transporter artifact the device built, which was checked as a bare
 * document; `sentbox.fetch` was missing from AGENT_ACTIONS.
 */

import { describe, expect, it } from 'vitest';
import crypto from 'crypto';
import { readFileSync } from 'node:fs';
import { BtpsAgent } from '../../../../client/btpsAgent.js';
import { BtpArtifactServerSchema } from './artifacts.js';
import { BtpAgentArtifactSchema } from './agentSchema.js';
import type { AgentAction, BTPAgentArtifact } from '../../types.js';

const ME = 'billing$acme.example';
const THEM = 'finance$client.example';

const vector = (file: string) =>
  JSON.parse(readFileSync(new URL(`../../../../../test/vectors/${file}`, import.meta.url), 'utf8'));

const keys = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const agent = new BtpsAgent({
  agent: { id: 'btps_ag_device-1', identityKey: keys.privateKey, identityCert: keys.publicKey },
  btpIdentity: ME,
  host: '127.0.0.1',
});

/** An agent artifact exactly as BtpsAgent builds and signs it. */
const build = async (action: AgentAction, document: unknown) => {
  const { payload, error } = await agent['getAgentArtifact']({
    actionType: action,
    to: THEM,
    document: document as never,
  });
  expect(error).toBeUndefined();
  return structuredClone(payload) as unknown as BTPAgentArtifact & {
    document: Record<string, unknown>;
  };
};

const documents: Record<string, unknown> = {
  'artifact.send': vector('documents/invoice.v2.json'),
  'event.send': vector('events/paid.by-biller.json'),
  'trust.request': {
    id: 'trust-req-1',
    name: 'Acme Billing',
    email: 'billing@acme.example',
    reason: 'Invoices for your account',
    phone: '+61200000000',
  },
  'trust.respond': {
    id: 'trust-res-1',
    decision: 'accepted',
    decidedAt: '2026-10-16T00:00:00.000Z',
    decidedBy: ME,
  },
  'sentbox.fetch': { limit: 10 },
  'sentbox.delete': { ids: ['a'] },
};

const issues = (artifact: unknown) => {
  const result = BtpAgentArtifactSchema.safeParse(artifact);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

describe('item 10: what BtpsAgent builds passes the server schema', () => {
  it.each(Object.keys(documents))('%s', async (action) => {
    const artifact = await build(action as AgentAction, documents[action]);
    expect(issues(artifact)).toEqual([]);
    expect(BtpArtifactServerSchema.safeParse(artifact).success).toBe(true);
  });

  it('a transporter action goes to the agent’s own identity, its artifact to the receiver', async () => {
    const artifact = await build('artifact.send', documents['artifact.send']);
    expect(artifact.to).toBe(ME);
    expect(artifact.document).toMatchObject({ type: 'BTPS_DOC', from: ME, to: THEM });
  });
});

describe('item 10: the carried transporter artifact is held to every transporter rule', () => {
  it('refuses a transporter artifact of another type than the action’s', async () => {
    const artifact = await build('artifact.send', documents['artifact.send']);
    const trustRequest = await build('trust.request', documents['trust.request']);
    artifact.document = trustRequest.document;
    expect(issues(artifact)).toContain(
      'document.type: artifact.send carries a BTPS_DOC transporter artifact',
    );
  });

  it('refuses a transporter artifact sent as another identity than the agent’s', async () => {
    const artifact = await build('artifact.send', documents['artifact.send']);
    artifact.document.from = 'mallory$acme.example';
    expect(issues(artifact)).toContain(
      'document.from: an agent sends only as the identity it acts for: document.from must be its to',
    );
  });

  it('refuses a carried document that fails its own schema', async () => {
    const artifact = await build('artifact.send', documents['artifact.send']);
    (artifact.document.document as Record<string, unknown>).status = 'paid';
    expect(issues(artifact)).toContain(
      'document.document: Document type does not match the artifact type',
    );
  });

  it('refuses a carried invoice whose attachment is not the file it names', async () => {
    const artifact = await build('artifact.send', documents['artifact.send']);
    const doc = artifact.document.document as { attachments: { sha256: string }[] };
    doc.attachments[0]!.sha256 = '0'.repeat(64);
    expect(issues(artifact).some((i) => i.startsWith('document.document.attachments.0.'))).toBe(
      true,
    );
  });

  it('refuses a carried document that references another sender’s', async () => {
    const correction = vector('documents/invoice.correction.v2.json');
    correction.references[0].from = ME; // the vector's biller is another identity
    const artifact = await build('artifact.send', correction);
    expect(issues(artifact)).toEqual([]);
    const doc = artifact.document.document as { references: { from: string }[] };
    doc.references[0]!.from = 'mallory$other.example';
    expect(issues(artifact)).toContain(
      'document.document.references.0.from: a document may only reference a document from its own sender',
    );
  });

  it('refuses a carried event whose id is not its artifact’s', async () => {
    const artifact = await build('event.send', documents['event.send']);
    artifact.document.id = crypto.randomUUID();
    expect(issues(artifact)).toContain(
      "document.document.id: an event's id must be the id of the artifact that carries it",
    );
  });

  it('still needs the document', async () => {
    const artifact = await build('artifact.send', documents['artifact.send']);
    delete (artifact as Partial<typeof artifact>).document;
    expect(issues(artifact)).toContain(
      'document: Document is required for this action type or document format is invalid',
    );
  });
});
