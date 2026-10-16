/**
 * Item D, a key-rotating refresh is signed by the current key (EBA-112):
 * refresh.vectors.json against the SDK's parts, loaded from the tree under
 * test (@btps/sdk/authentication).
 *
 * - self-held and managed cases: `verifyAgentRefresh` accepts or refuses
 *   each signed auth.refresh, with the vector's reason and error code, when
 *   the server holds `currentKey` (null: none) and its clock reads `now`.
 * - tokens: `BtpsAuthentication.validateAndReissueRefreshToken` over an
 *   `InMemoryTokenStore`, one enrolled device, steps in order: a refresh
 *   token is single-use.
 *
 * The server's pipeline runs the same cases in src/server/test/refresh.test.ts.
 */

import { ensure } from '../check.mjs';

const ITEM = 'D';

/** The few trust store calls BtpsAuthentication makes, over a Map. */
function mapTrustStore() {
  const records = new Map();
  return {
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
  };
}

/**
 * @param {import('../sdk-loader.mjs').LoadedSdk} sdk
 * @param {ReturnType<import('../vectors.mjs').loadVectorSet>} set
 * @returns {import('../check.mjs').Check[]}
 */
export function refreshSdkChecks(sdk, set) {
  const model = set.refresh;
  const check = (name, run) => ({
    id: `sdk/item-D/${name}`,
    item: ITEM,
    tickets: model.tickets,
    run() {
      ensure(
        typeof sdk.authentication?.verifyAgentRefresh === 'function',
        'the SDK has no refresh check (verifyAgentRefresh in @btps/sdk/authentication)',
      );
      return run();
    },
  });
  const checks = [];

  const caseCheck = (custody, c) =>
    check(`${custody}/${c.name}`, () => {
      const currentPublicKey =
        c.currentKey === null ? null : model.selfHeld.keys[c.currentKey].publicKeyPem;
      const result = sdk.authentication.verifyAgentRefresh({
        artifact: c.artifact,
        currentPublicKey,
        nowMs: Date.parse(model.now),
        windowMs: model.windowMs,
      });
      if (c.expect === 'accept') {
        ensure(result.ok, `refused (${result.reason}); expected accept`);
        ensure(
          result.rotation === c.rotation,
          `rotation ${result.rotation}; expected ${c.rotation}`,
        );
      } else {
        ensure(!result.ok, 'accepted; expected refusal');
        ensure(result.reason === c.reason, `refused as ${result.reason}; expected ${c.reason}`);
        ensure(result.error?.code === c.error, `error ${result.error?.code}; expected ${c.error}`);
      }
    });

  for (const c of model.selfHeld.cases) checks.push(caseCheck('self-held', c));
  for (const c of model.managed.cases) checks.push(caseCheck('managed', c));

  checks.push(
    check('self-held/tokens/single-use', async () => {
      const { BtpsAuthentication, InMemoryTokenStore } = sdk.authentication;
      ensure(typeof BtpsAuthentication === 'function', 'the SDK has no BtpsAuthentication');
      const auth = new BtpsAuthentication({
        trustStore: mapTrustStore(),
        tokenStore: new InMemoryTokenStore(),
      });
      const publicKey = model.selfHeld.keys.current.publicKeyPem;
      const enrolled = await auth.createAgent(
        { userIdentity: model.identity, publicKey, decidedBy: 'system' },
        model.identity,
      );
      const issued = [enrolled.refreshToken];
      for (const [index, step] of model.selfHeld.tokens.entries()) {
        const token = issued[Number(step.use.replace('issued-', ''))];
        ensure(token !== undefined, `step ${index + 1}: ${step.use} was never issued`);
        const { data } = await auth.validateAndReissueRefreshToken(enrolled.agentId, token, {
          decidedBy: 'system',
          publicKey,
          decryptBy: model.identity,
        });
        const outcome = data ? 'accept' : 'refuse';
        ensure(outcome === step.expect, `step ${index + 1}: ${outcome}; expected ${step.expect}`);
        if (data) issued.push(data.refreshToken);
      }
    }),
  );

  return checks;
}
