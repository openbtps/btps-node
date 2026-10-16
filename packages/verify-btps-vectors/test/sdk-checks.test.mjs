import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sdkChecks } from '../src/checks/sdk.mjs';
import { runChecks } from '../src/runner.mjs';
import { loadSdk } from '../src/sdk-loader.mjs';
import { loadVectorSet } from '../src/vectors.mjs';
import { KNOWN_FAILING, REPO_ROOT, VECTORS_DIR, createFixedSdkFake } from './helpers.mjs';

const set = loadVectorSet(VECTORS_DIR);
const failing = (results) =>
  results
    .filter((r) => !r.passed)
    .map((r) => r.id)
    .sort();

describe('SDK checks', () => {
  it('every regression check can pass: a fake SDK with the 1.1 fixes passes them all', async () => {
    const results = await runChecks(sdkChecks(createFixedSdkFake(), set));
    expect(
      results.filter((r) => /^sdk\/(jcs|selectors|defects)\//.test(r.id)).length,
    ).toBeGreaterThanOrEqual(11);
    expect(failing(results)).toEqual([]);
  });

  it('on this tree, the SDK fails exactly the checks in test/vectors/known-failing.json', async () => {
    const known = JSON.parse(fs.readFileSync(KNOWN_FAILING, 'utf8'));
    const results = await runChecks(sdkChecks(await loadSdk(REPO_ROOT), set));
    expect(failing(results)).toEqual(Object.keys(known.checks).sort());
  });

  it('every known-failing entry names an SDK check and what fixes it', () => {
    const known = JSON.parse(fs.readFileSync(KNOWN_FAILING, 'utf8'));
    for (const [id, note] of Object.entries(known.checks)) {
      expect(id).toMatch(/^sdk\/(jcs|selectors|defects)\//);
      expect(typeof note === 'string' && note.trim().length > 0).toBe(true);
    }
  });

  it('loadSdk refuses a directory that is not a btps-node checkout', async () => {
    await expect(loadSdk(VECTORS_DIR)).rejects.toThrow(/not a btps-node checkout/);
  });
});
