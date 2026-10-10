import { describe, expect, it } from 'vitest';
import { documentModelChecks, loadDocumentModelFixtures } from '../src/checks/documentModel.mjs';
import { loadVectorSet } from '../src/vectors.mjs';
import { createNodeRuntime } from '../src/runtimes/node.mjs';
import { createWebRuntime } from '../src/runtimes/web.mjs';
import { DOCUMENT_FIXTURES_DIR, VECTORS_DIR } from './helpers.mjs';

/*
 * EBA-119 review, round 1: "vectors pass on Node, web and the third runtime
 * available in CI" was unmet — the document-model fixtures were never run
 * against a runtime driver at all, so "still verifying" (the acceptance
 * criterion for the unknown-category/unknown-extensions payslip fixture)
 * was never shown by an actual signature check. This wires the fixtures
 * into the existing harness's runtime drivers directly, so it runs under
 * `yarn test` (ci/test) on every push, on both Node and WebCrypto. The
 * third runtime (Hermes) is EBA-150's, per this ticket's acceptance
 * criteria and the review ruling.
 */
describe('EBA-119: document-model fixtures sign-then-verify on every runtime', () => {
  const set = loadVectorSet(VECTORS_DIR);
  const fixtures = loadDocumentModelFixtures(DOCUMENT_FIXTURES_DIR);
  const runtimes = [createNodeRuntime(), createWebRuntime()];

  it('loaded every EBA-119 fixture, including the unknown-category/extensions one', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(8);
    expect(fixtures.some((f) => f.name === 'payslip.unknown-extensions.v2.json')).toBe(true);
  });

  for (const runtime of runtimes) {
    describe(runtime.name, () => {
      for (const check of documentModelChecks(runtime, set, fixtures)) {
        it(check.id, () => check.run());
      }
    });
  }
});
