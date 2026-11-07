/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// The 1.2 security review's findings, each attacked over a real server and a
// real connection, as an attacker would. A signed answer flood is attacked in
// signedAnswers.security.test.ts.

import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import tls, { type TLSSocket } from 'tls';
import { randomUUID } from 'crypto';
import { spawnSync } from 'child_process';
import { BtpsAuthentication } from '../../src/core/authentication/BtpsAuthentication.js';
import { InMemoryTokenStore } from '../../src/core/authentication/storage/InMemoryTokenStore.js';
import { BtpsClient } from '../../src/client/btpsClient.js';
import { signBtpPayload } from '../../src/core/crypto/index.js';
import { assertStrictJson } from '../../src/core/crypto/jcs.js';
import {
  BTPErrorException,
  BTP_ERROR_SIG_VERIFICATION,
  BTP_ERROR_TEMPORARILY_UNAVAILABLE,
  BTP_ERROR_UNKNOWN,
  BTP_ERROR_VALIDATION,
} from '../../src/core/error/index.js';
import { computeAgentTrustId } from '../../src/core/trust/trustUtils.js';
import { agreementRef, signAgreement, signStatement } from '../../src/core/trust/agreements.js';
import { buildEvidenceBundle } from '../../src/core/trust/evidence.js';
import type { BTPAuthReqDoc, BTPServerResponse } from '../../src/core/server/types.js';
import {
  addUser,
  artifactFrom,
  deliver,
  invoiceDocument,
  newKeys,
  publishHost,
  recordTrust,
  sendRaw,
  senderTls,
  serverTls,
  startProvider,
  freePort,
  type Provider,
  type User,
} from '../e2e/harness.js';

vi.mock('dns/promises', async () => (await import('../e2e/zone.js')).dnsModule);

const ISSUED_AT = () => new Date().toISOString();

describe('the 1.2 security review, attacked over the wire', () => {
  let vendorHost: Provider;
  let host: Provider;
  let vendor: User;
  let user: User;
  let auth: BtpsAuthentication;
  const deviceKeys = newKeys();
  const handled: string[] = [];
  const reused = vi.fn();
  const onError = vi.fn<(error: BTPErrorException) => void>();

  beforeAll(async () => {
    vendorHost = await startProvider('vendor.test');
    host = await startProvider('saas.test', { server: { onError } });
    vendor = await addUser(vendorHost, 'billing');
    user = await addUser(host, 'alice');
    await recordTrust(host.trustStore, vendor.identity, user.identity, 'accepted', {
      privacyType: 'unencrypted',
    });
    auth = new BtpsAuthentication({
      trustStore: host.trustStore,
      tokenStore: new InMemoryTokenStore(),
      refreshGraceMs: 2000,
    });
    auth.on('refreshTokenReused', reused);
    // The provider's devices, as a platform writes them around the SDK.
    host.server.onIncomingArtifact('Agent', async (artifact, resCtx) => {
      handled.push(artifact.action);
      const answer = (document: unknown) =>
        resCtx.sendRes({
          ...host.server.prepareBtpsResponse({ ok: true, message: 'success', code: 200 }),
          type: 'btps_response',
          document,
        } as Parameters<typeof resCtx.sendRes>[0]);
      const doc = artifact.document as BTPAuthReqDoc;
      if (artifact.action === 'auth.request') {
        const valid = await auth.validateAuthToken(doc.identity, doc.authToken);
        if (!valid.isValid) return resCtx.sendError(BTP_ERROR_VALIDATION);
        return answer(
          await auth.createAgent(
            { userIdentity: doc.identity, publicKey: doc.publicKey, decidedBy: 'alice' },
            doc.identity,
          ),
        );
      }
      if (artifact.action === 'auth.refresh') {
        const { data, error } = await auth.validateAndReissueRefreshToken(
          artifact.agentId,
          doc.authToken,
          { decidedBy: 'alice', publicKey: doc.publicKey, decryptBy: doc.identity },
        );
        // A failure is thrown, so the server logs it and onError receives it.
        if (error) throw error;
        return answer(data);
      }
      return answer({ results: [] });
    });
  });

  afterAll(() => {
    vendorHost.stop();
    host.stop();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    handled.length = 0;
    onError.mockClear();
    reused.mockClear();
  });

  /** A device the provider registered, as its sign-in leaves it. */
  const registered = async () =>
    auth.createAgent(
      { userIdentity: user.identity, publicKey: deviceKeys.publicKey, decidedBy: 'alice' },
      user.identity,
    );

  describe('1. a line that passes as another kind of artifact', () => {
    it('is refused when a signed transporter artifact that breaks its rules also names a control action', async () => {
      const unsigned = {
        version: '1.2.0',
        id: randomUUID(),
        issuedAt: ISSUED_AT(),
        type: 'BTPS_DOC',
        from: vendor.identity,
        to: user.identity,
        selector: vendor.selector,
        document: { not: 'an invoice' },
        encryption: null,
        action: 'PING',
      };
      const line = JSON.stringify({
        ...unsigned,
        signature: signBtpPayload(unsigned, vendor.keys),
      });

      const answer = await sendRaw(host, line);

      expect(answer.status).toMatchObject({ ok: false, error: BTP_ERROR_VALIDATION.code });
      expect(host.inbox.some((a) => a.id === unsigned.id)).toBe(false);
    });

    it("is refused when a registered device's agent artifact that breaks its rules also names an identity lookup", async () => {
      const { agentId } = await registered();
      const unsigned = {
        version: '1.1.0',
        id: randomUUID(),
        issuedAt: ISSUED_AT(),
        action: 'inbox.fetch',
        agentId,
        to: user.identity,
        document: 'not a query',
        encryption: null,
        identity: user.identity,
        from: user.identity,
        hostSelector: 'btps1',
      };
      const line = JSON.stringify({ ...unsigned, signature: signBtpPayload(unsigned, deviceKeys) });

      const answer = await sendRaw(host, line);

      expect(answer.status).toMatchObject({ ok: false, error: BTP_ERROR_VALIDATION.code });
      expect(handled).not.toContain('inbox.fetch');
    });
  });

  describe('2. a line of millions of list entries', () => {
    it('is refused quickly, and the server answers the next sender as usual', async () => {
      const unsigned = {
        version: '1.2.0',
        id: randomUUID(),
        issuedAt: ISSUED_AT(),
        type: 'TRUST_REQ',
        from: vendor.identity,
        to: user.identity,
        selector: vendor.selector,
        document: { name: 'Vendor', email: 'billing@vendor.test' },
        encryption: null,
        // About two bytes an entry: the most entries a line under the limit can hold.
        given: Array.from({ length: 2_200_000 }, () => 0),
      };
      const line = JSON.stringify({
        ...unsigned,
        signature: { algorithmHash: 'sha256', value: 'AA==', fingerprint: 'AA==' },
      });
      // Under the server's 5 MB limit, so the lists themselves are what is checked.
      expect(line.length).toBeGreaterThan(4 * 1024 * 1024);
      expect(line.length).toBeLessThan(5 * 1024 * 1024);

      // What the server spends reading and checking the line, apart from sending it.
      const parse = host.server['_parseAndValidateArtifact'];
      let checking = 0;
      host.server['_parseAndValidateArtifact'] = (raw: string) => {
        const started = performance.now();
        try {
          return parse.call(host.server, raw);
        } finally {
          checking = Math.max(checking, performance.now() - started);
        }
      };
      try {
        const answer = await sendRaw(host, line);
        const next = await sendRaw(
          host,
          JSON.stringify({
            version: '1.1.0',
            id: randomUUID(),
            issuedAt: ISSUED_AT(),
            action: 'PING',
          }),
        );

        expect(answer.status).toMatchObject({ ok: false, error: BTP_ERROR_VALIDATION.code });
        // No issue is made for each entry: the check stops at the list's length.
        // Reading the line alone, as the server must, timed here: checking it costs barely more.
        const started = performance.now();
        assertStrictJson(line);
        JSON.parse(line);
        const reading = performance.now() - started;
        expect(checking).toBeLessThan(reading * 1.5 + 100);
        expect(next.status.ok).toBe(true);
      } finally {
        host.server['_parseAndValidateArtifact'] = parse;
      }
    }, 30_000);
  });

  describe('4. two refreshes with one refresh token, over two connections', () => {
    it('lets one through and tells the other to try again, revoking nothing', async () => {
      const { agentId, refreshToken } = await registered();
      // The provider's store is slow, so the two refreshes are made at the same time.
      const update = host.trustStore.update.bind(host.trustStore);
      vi.spyOn(host.trustStore, 'update').mockImplementation(async (...args) => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return update(...args);
      });
      const refresh = () =>
        BtpsAuthentication.refreshSession(
          agentId,
          user.identity,
          refreshToken,
          deviceKeys,
          {},
          {
            btpMtsOptions: senderTls,
            maxRetries: 0,
          },
        );

      const results = await Promise.all([refresh(), refresh()]);
      vi.restoreAllMocks();
      const device = await host.trustStore.getById(computeAgentTrustId(agentId, user.identity));

      expect(results.filter((r) => r.success)).toHaveLength(1);
      const refused = results.find((r) => !r.success)?.error as BTPErrorException | undefined;
      expect(refused?.meta?.status).toMatchObject({
        error: BTP_ERROR_TEMPORARILY_UNAVAILABLE.code,
      });
      expect(device?.status).toBe('accepted');
      expect(reused).not.toHaveBeenCalled();
    }, 20_000);
  });

  describe('5. a forged evidence bundle, read with the command', () => {
    it('shows the fingerprint of every key it was checked with, and that none was confirmed online', async () => {
      // Fresh keys, labelled as the parties: the bundle checks against itself.
      const forger = { bank: newKeys(), alice: newKeys() };
      const BANK = 'loans$bank.example';
      const ALICE = 'alice$client.example';
      const agreement = await signAgreement(
        {
          type: 'agreement',
          title: 'Loan',
          id: 'AGR-1',
          issuedAt: '2026-11-01T00:00:00.000Z',
          body: { format: 'text', content: 'A loan.' },
          acceptance: { terms: [], signers: [{ address: ALICE }], signingOrder: 'any' },
        },
        { originator: BANK, selector: 'btps1', pemFiles: forger.bank },
      );
      const statement = await signStatement(
        {
          agreement: agreementRef(agreement, BANK),
          terms: [],
          signer: ALICE,
          decision: 'accepted',
          signedAt: '2026-11-02T00:00:00.000Z',
        },
        { selector: 'btps1', pemFiles: forger.alice },
      );
      const bundle = buildEvidenceBundle(
        { originator: BANK, agreement, statements: [statement] },
        (identity) => (identity === BANK ? forger.bank : forger.alice).publicKey,
      );
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'btps-forged-'));
      const file = path.join(dir, 'forged.json');
      fs.writeFileSync(file, JSON.stringify(bundle));

      const cli = path.resolve(__dirname, '../../bin/verify-evidence-bundle.mjs');
      const { status, stdout, stderr } = spawnSync(process.execPath, [cli, file], {
        encoding: 'utf8',
      });
      fs.rmSync(dir, { recursive: true, force: true });

      expect(status, stderr).toBe(0);
      for (const key of bundle.keys) expect(stdout).toContain(key.fingerprint);
      expect(stdout).toContain('not confirmed online');
    });
  });

  describe('6. a refresh that fails', () => {
    it('leaves no token in the error the server logs, or in what a device is told', async () => {
      const { agentId } = await registered();
      const unknownToken = 'SECRET-REFRESH-TOKEN-NOBODY-ISSUED';
      const code = 'SECRET-SIGN-IN-CODE';

      const refreshed = await BtpsAuthentication.refreshSession(
        agentId,
        user.identity,
        unknownToken,
        deviceKeys,
        {},
        { btpMtsOptions: senderTls, maxRetries: 0 },
      );
      const signedIn = await BtpsAuthentication.authenticate(
        user.identity,
        code,
        newKeys(),
        {},
        {
          btpMtsOptions: senderTls,
          maxRetries: 0,
        },
      );

      expect(onError).toHaveBeenCalled();
      for (const [error] of onError.mock.calls) {
        expect(JSON.stringify(error.toJSON())).not.toContain(unknownToken);
      }
      expect(refreshed.success).toBe(false);
      expect(JSON.stringify((refreshed.error as BTPErrorException).toJSON())).not.toContain(
        unknownToken,
      );
      expect(signedIn.success).toBe(false);
      expect(JSON.stringify((signedIn.error as BTPErrorException).toJSON())).not.toContain(code);
    });
  });

  describe('7. a hostile server that says every answer ends the connection, unsigned', () => {
    it('cannot make a client that requires its signature drop the connection', async () => {
      const port = await freePort();
      const connections: TLSSocket[] = [];
      const hostile = tls.createServer(serverTls, (socket) => {
        connections.push(socket);
        let buffered = '';
        socket.on('data', (data) => {
          buffered += data.toString();
          let end;
          while ((end = buffered.indexOf('\n')) !== -1) {
            const { id } = JSON.parse(buffered.slice(0, end));
            buffered = buffered.slice(end + 1);
            const answer: BTPServerResponse = {
              version: '1.2.0',
              id: randomUUID(),
              issuedAt: ISSUED_AT(),
              type: 'btps_response',
              reqId: id,
              status: { ok: true, code: 200, closing: true },
            };
            socket.write(`${JSON.stringify(answer)}\n`);
          }
        });
      });
      // Every interface, as a BtpsServer listens, so 'localhost' reaches it however it resolves.
      await new Promise<void>((resolve) => hostile.listen(port, resolve));
      publishHost('hostile.test', { port, selector: 'btps1', operator: 'admin$hostile.test' });
      const client = new BtpsClient({
        to: 'bob$hostile.test',
        btpMtsOptions: senderTls,
        maxRetries: 0,
        requireSignedBy: { identity: 'admin$hostile.test', selector: 'btps1' },
      });
      const ping = () =>
        client.send({ version: '1.1.0', id: randomUUID(), issuedAt: ISSUED_AT(), action: 'PING' });

      try {
        const first = await ping();
        const second = await ping();

        // Each answer reached the client, and was refused for its missing signature.
        expect(first.response).toBeUndefined();
        expect(first.error?.code).toBe(BTP_ERROR_SIG_VERIFICATION.code);
        expect(second.error?.code).toBe(BTP_ERROR_SIG_VERIFICATION.code);
        expect(connections).toHaveLength(1);
      } finally {
        client.destroy();
        hostile.close();
      }
    });
  });

  describe("8. a provider's store that fails with a code and words of its own", () => {
    it.each([
      [
        'an SDK error with a status and code',
        Object.assign(new Error('internal acme-keys bucket denied'), {
          status: 403,
          code: 'AccessDenied',
        }),
        'acme-keys',
      ],
      [
        'a database duplicate-key error',
        Object.assign(new Error('E11000 duplicate key error collection: btps.trust index: id_1'), {
          code: 11000,
        }),
        'E11000',
      ],
    ])(
      'answers the sender with a generic 500 for %s, telling it nothing of it',
      async (_name, failure, detail) => {
        vi.spyOn(host.trustStore, 'getById').mockRejectedValueOnce(failure);
        const invoice = await artifactFrom(vendor, user.identity, 'BTPS_DOC', invoiceDocument(), {
          encrypt: false,
        });

        const { response } = await deliver(invoice);

        expect(response?.status).toEqual({
          ok: false,
          code: 500,
          message: BTP_ERROR_UNKNOWN.message,
          error: BTP_ERROR_UNKNOWN.code,
        });
        expect(JSON.stringify(response)).not.toContain(detail);
      },
    );

    it('answers a generic 500 when middleware passes the store’s error on as caught', async () => {
      host.use([
        {
          phase: 'after',
          step: 'signatureVerification',
          handler: async (_req, res, next) => {
            try {
              throw Object.assign(new Error('internal acme-keys bucket denied'), {
                status: 403,
                code: 'AccessDenied',
              });
            } catch (caught) {
              return res.sendError(caught as BTPErrorException);
            }
            return next();
          },
        },
      ]);
      try {
        const invoice = await artifactFrom(vendor, user.identity, 'BTPS_DOC', invoiceDocument(), {
          encrypt: false,
        });

        const { response } = await deliver(invoice);

        expect(response?.status).toMatchObject({ ok: false, code: 500 });
        expect(JSON.stringify(response)).not.toContain('acme-keys');
      } finally {
        host.use([]);
      }
    });
  });
});
