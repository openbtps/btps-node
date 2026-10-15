/**
 * Item F, replay and duplicate protection (EBA-114): replay.vectors.json
 * against the SDK's parts, loaded from the tree under test.
 *
 * - window: `checkIssuedAtWindow` (@btps/sdk) accepts or refuses each
 *   issuedAt, with the vector's reason.
 * - deliveries: each sequence runs against one `InMemoryReplayStore`
 *   (@btps/sdk/storage) in the order the protocol checks them: the window
 *   first, then `(from, id)`. The server's own pipeline runs the same
 *   vectors in src/server/test/replay.test.ts.
 */

import { ensure } from '../check.mjs';

const ITEM = 'F';

/**
 * @param {import('../sdk-loader.mjs').LoadedSdk} sdk
 * @param {ReturnType<import('../vectors.mjs').loadVectorSet>} set
 * @returns {import('../check.mjs').Check[]}
 */
export function replaySdkChecks(sdk, set) {
  const model = set.replay;
  const check = (name, run) => ({
    id: `sdk/item-F/${name}`,
    item: ITEM,
    tickets: model.tickets,
    run() {
      ensure(
        typeof sdk.utils?.checkIssuedAtWindow === 'function',
        'the SDK has no issuedAt window (checkIssuedAtWindow in @btps/sdk)',
      );
      ensure(
        typeof sdk.storage?.InMemoryReplayStore === 'function',
        'the SDK has no replay store (InMemoryReplayStore in @btps/sdk/storage)',
      );
      return run();
    },
  });
  const checks = [];

  const now = Date.parse(model.now);
  for (const c of model.window) {
    checks.push(
      check(`window/${c.name}`, () => {
        const result = sdk.utils.checkIssuedAtWindow(c.issuedAt, now, c.windowMs ?? model.windowMs);
        if (c.expect === 'accept') {
          ensure(result.ok, `refused (${result.reason}); expected accept`);
        } else {
          ensure(!result.ok, 'accepted; expected refusal');
          ensure(result.reason === c.reason, `refused as ${result.reason}; expected ${c.reason}`);
        }
      }),
    );
  }

  for (const d of model.deliveries) {
    checks.push(
      check(`deliveries/${d.name}`, async () => {
        let clock = now;
        const store = new sdk.storage.InMemoryReplayStore({ now: () => clock });
        for (const [index, step] of d.steps.entries()) {
          clock = Date.parse(step.receivedAt);
          const window = sdk.utils.checkIssuedAtWindow(step.issuedAt, clock, model.windowMs);
          let outcome;
          if (!window.ok) {
            outcome = 'refuse-window';
          } else {
            const expiresAt = new Date(window.issuedAtMs + model.windowMs);
            outcome = (await store.remember(step.from, step.id, expiresAt))
              ? 'accept'
              : 'refuse-duplicate';
          }
          ensure(outcome === step.expect, `step ${index + 1}: ${outcome}; expected ${step.expect}`);
        }
      }),
    );
  }

  return checks;
}
