/**
 * Item E, device registration bound to the identity (EBA-113), and fix-list
 * item 5 (a forged agent message): registration.vectors.json against the
 * SDK's parts, loaded from the tree under test (@btps/sdk/authentication).
 *
 * The server's two steps for an auth.request, composed here from the same
 * parts the server uses:
 *   1. the signature, by the key in `document.publicKey`;
 *   2. `consumeRegistrationToken` over an `InMemoryTokenStore`; on success,
 *      `BtpsAuthentication.createAgent` binds the device to the token's
 *      identity.
 * Forged cases: `resolveAgentKey` finds the key an agent artifact is
 * verified with, and the signature is checked against it.
 *
 * The server's pipeline runs the same vectors in src/server/test/registration.test.ts.
 */

import crypto from 'node:crypto';
import { ensure } from '../check.mjs';

const ITEM = 'E';
const WINDOW_MS = 5 * 60 * 1000;

/** The trust id the protocol keys records by: sha256 of lowercase `from:to`, hex. */
const trustId = (from, to) =>
  crypto.createHash('sha256').update(`${from}:${to}`.toLowerCase()).digest('hex');

/** The few trust store calls the SDK makes, over a Map. */
function mapTrustStore() {
  const records = new Map();
  return {
    records,
    async getById(id) {
      return records.get(id);
    },
    async create(record, id) {
      const full = { ...record, id };
      records.set(id, full);
      return full;
    },
    async update(id, patch) {
      const next = { ...records.get(id), ...patch };
      records.set(id, next);
      return next;
    },
    seed(senderId, receiverId, publicKeyPem, utils, cryptoSdk) {
      const id = trustId(senderId, receiverId);
      records.set(id, {
        id,
        senderId,
        receiverId,
        status: 'accepted',
        createdAt: '2026-10-01T00:00:00.000Z',
        decidedBy: receiverId,
        decidedAt: '2026-10-01T00:00:00.000Z',
        expiresAt: '2099-01-01T00:00:00.000Z',
        publicKeyBase64: utils.pemToBase64(publicKeyPem),
        publicKeyFingerprint: cryptoSdk.getFingerprintFromPem(publicKeyPem, 'sha256'),
        keyHistory: [],
        privacyType: 'unencrypted',
      });
    },
  };
}

const unsign = (artifact) => {
  const { signature, ...signed } = artifact;
  return { signed, signature };
};

/**
 * @param {import('../sdk-loader.mjs').LoadedSdk} sdk
 * @param {ReturnType<import('../vectors.mjs').loadVectorSet>} set
 * @returns {import('../check.mjs').Check[]}
 */
export function registrationSdkChecks(sdk, set) {
  const model = set.registration;
  const keyPair = (name) => ({
    publicKey: model.keys[name].publicKeyPem,
    privateKey: model.keys[name].privateKeyPem,
  });
  const deviceOf = (publicKeyPem) =>
    Object.keys(model.keys).find((name) => model.keys[name].publicKeyPem === publicKeyPem);

  const check = (name, run) => ({
    id: `sdk/item-E/${name}`,
    item: ITEM,
    tickets: model.tickets,
    run() {
      ensure(
        typeof sdk.authentication?.consumeRegistrationToken === 'function' &&
          typeof sdk.authentication?.resolveAgentKey === 'function',
        'the SDK has no registration check (consumeRegistrationToken and resolveAgentKey in @btps/sdk/authentication)',
      );
      return run();
    },
  });

  /** A token store holding `names`, each issued `issuedMsBeforeUse` ago. */
  const issue = async (names) => {
    const tokenStore = new sdk.authentication.InMemoryTokenStore();
    for (const name of names) {
      const t = model.tokens[name];
      await tokenStore.store(
        t.token,
        null,
        t.identity,
        model.tokenExpiryMs - t.issuedMsBeforeUse,
        t.identity,
      );
    }
    return tokenStore;
  };

  /** The server's two steps for one auth.request. */
  const register = async (tokenStore, trustStore, artifact) => {
    const { signed, signature } = unsign(artifact);
    const sig = sdk.crypto.verifySignature(signed, signature, artifact.document.publicKey);
    if (!sig.isValid) {
      return { outcome: 'refuse', reason: 'signature', error: 'BTP_ERROR_SIG_VERIFICATION' };
    }
    const result = await sdk.authentication.consumeRegistrationToken(tokenStore, {
      identity: artifact.document.identity,
      to: artifact.to,
      authToken: artifact.document.authToken,
    });
    if (!result.ok) return { outcome: 'refuse', reason: result.reason, error: result.error.code };
    const auth = new sdk.authentication.BtpsAuthentication({ trustStore, tokenStore });
    const bound = await auth.createAgent(
      {
        userIdentity: result.token.userIdentity,
        publicKey: artifact.document.publicKey,
        agentInfo: artifact.document.agentInfo,
        decidedBy: result.token.userIdentity,
      },
      result.token.decryptBy,
    );
    return { outcome: 'accept', identity: result.token.userIdentity, auth, ...bound };
  };

  /** A device is bound to exactly the identity it registered for, with its key. */
  const ensureBound = async (trustStore, artifact, accepted) => {
    const { agentId } = accepted;
    ensure(agentId !== artifact.agentId, `agent id ${agentId} was taken from the request`);
    ensure(sdk.authentication.isAgentId(agentId), `agent id ${agentId} is not an agent id`);
    ensure(
      accepted.identity === artifact.document.identity,
      `bound to ${accepted.identity}; expected ${artifact.document.identity}`,
    );
    const resolved = await sdk.authentication.resolveAgentKey(trustStore, {
      agentId,
      to: accepted.identity,
    });
    ensure(resolved.ok, `no agent record for ${agentId} → ${accepted.identity}`);
    ensure(
      resolved.record.publicKeyFingerprint ===
        model.keys[deviceOf(artifact.document.publicKey)].fingerprint,
      'the agent record does not hold the registered key',
    );
    const bindings = [...trustStore.records.values()].filter((r) => r.senderId === agentId);
    ensure(bindings.length === 1, `${bindings.length} records for ${agentId}; expected 1`);
  };

  /** Uses the device, rotates its key through auth.refresh, and refuses the old key. */
  const lifecycle = async (trustStore, accepted, device) => {
    const { agentId, identity, auth } = accepted;
    const verifyAs = async (signedBy) => {
      const unsigned = {
        version: '1.1.0',
        id: crypto.randomUUID(),
        action: 'inbox.fetch',
        agentId,
        to: identity,
        issuedAt: new Date().toISOString(),
        encryption: null,
      };
      const signature = await sdk.crypto.signBtpPayload(unsigned, keyPair(signedBy));
      const resolved = await sdk.authentication.resolveAgentKey(trustStore, unsigned);
      ensure(resolved.ok, 'the registered device has no agent record');
      return sdk.crypto.verifySignature(unsigned, signature, resolved.publicKeyPem).isValid;
    };
    ensure(await verifyAs(device), 'the registered device cannot be used');

    const { publicKey, keyProof } = await sdk.authentication.signKeyProof({
      agentId,
      identity,
      newKey: keyPair('deviceA2'),
    });
    const unsigned = {
      version: '1.1.0',
      id: crypto.randomUUID(),
      action: 'auth.refresh',
      agentId,
      to: identity,
      issuedAt: new Date().toISOString(),
      encryption: null,
      document: { identity, authToken: accepted.refreshToken, publicKey, keyProof },
    };
    const refresh = {
      ...unsigned,
      signature: await sdk.crypto.signBtpPayload(unsigned, keyPair(device)),
    };
    const current = await sdk.authentication.resolveAgentKey(trustStore, refresh);
    const checked = sdk.authentication.verifyAgentRefresh({
      artifact: refresh,
      currentPublicKey: current.ok ? current.publicKeyPem : null,
      nowMs: Date.now(),
      windowMs: WINDOW_MS,
    });
    ensure(checked.ok && checked.rotation, `the rotating refresh was refused (${checked.reason})`);
    const { data } = await auth.validateAndReissueRefreshToken(agentId, accepted.refreshToken, {
      decidedBy: 'system',
      publicKey,
      decryptBy: identity,
    });
    ensure(data, 'the refresh token was not reissued');
    ensure(await verifyAs('deviceA2'), 'the rotated key cannot be used');
    ensure(!(await verifyAs(device)), 'the old key is still accepted after rotation');
  };

  const checks = model.sequences.map((sequence) =>
    check(`sequence/${sequence.name}`, async () => {
      const tokenStore = sequence.tokenStore ? await issue(sequence.issue) : undefined;
      const trustStore = mapTrustStore();
      for (const [index, step] of sequence.steps.entries()) {
        const at = `step ${index + 1}`;
        const result = await register(tokenStore, trustStore, step.request);
        ensure(
          result.outcome === step.expect,
          `${at}: ${result.outcome} (${result.reason ?? 'bound'}); expected ${step.expect}`,
        );
        if (step.expect === 'refuse') {
          ensure(
            result.reason === step.reason,
            `${at}: refused as ${result.reason}; expected ${step.reason}`,
          );
          ensure(
            result.error === step.error,
            `${at}: error ${result.error}; expected ${step.error}`,
          );
          continue;
        }
        await ensureBound(trustStore, step.request, result);
        if (sequence.lifecycle && index === 0) {
          await lifecycle(trustStore, result, deviceOf(step.request.document.publicKey));
        }
      }
    }),
  );

  checks.push(
    check(`concurrent/${model.concurrent.name}`, async () => {
      const { concurrent } = model;
      const tokenStore = await issue(concurrent.issue);
      const trustStore = mapTrustStore();
      const results = await Promise.all(
        concurrent.requests.map((r) => register(tokenStore, trustStore, r)),
      );
      const accepted = results.filter((r) => r.outcome === 'accept');
      const refused = results.filter((r) => r.outcome === 'refuse');
      ensure(
        accepted.length === concurrent.expect.accept && refused.length === concurrent.expect.refuse,
        `${accepted.length} accepted, ${refused.length} refused; expected ${concurrent.expect.accept} and ${concurrent.expect.refuse}`,
      );
      ensure(
        refused.every((r) => r.error === concurrent.expect.error),
        `refused with ${refused.map((r) => r.error).join(', ')}; expected ${concurrent.expect.error}`,
      );
    }),
  );

  const { enrolled, correspondentTrust } = model.forged;
  for (const c of model.forged.cases) {
    checks.push(
      check(`forged/${c.name}`, async () => {
        const trustStore = mapTrustStore();
        trustStore.seed(
          enrolled.agentId,
          enrolled.identity,
          model.keys[enrolled.key].publicKeyPem,
          sdk.utils,
          sdk.crypto,
        );
        trustStore.seed(
          correspondentTrust.senderId,
          correspondentTrust.receiverId,
          model.keys[correspondentTrust.key].publicKeyPem,
          sdk.utils,
          sdk.crypto,
        );
        const resolved = await sdk.authentication.resolveAgentKey(trustStore, c.artifact);
        let outcome;
        let reason;
        if (!resolved.ok) {
          outcome = 'refuse';
          reason = resolved.reason;
        } else {
          const { signed, signature } = unsign(c.artifact);
          const valid = sdk.crypto.verifySignature(
            signed,
            signature,
            resolved.publicKeyPem,
          ).isValid;
          outcome = valid ? 'accept' : 'refuse';
          reason = valid ? undefined : 'signature';
        }
        ensure(outcome === c.expect, `${outcome} (${reason ?? 'verified'}); expected ${c.expect}`);
        if (c.expect === 'refuse') {
          ensure(reason === c.reason, `refused as ${reason}; expected ${c.reason}`);
        }
      }),
    );
  }

  return checks;
}
