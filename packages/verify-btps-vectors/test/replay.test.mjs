import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { replaySdkChecks } from '../src/checks/replay.mjs';
import { runChecks } from '../src/runner.mjs';
import { loadSdk } from '../src/sdk-loader.mjs';
import { VectorLoadError, loadVectorSet } from '../src/vectors.mjs';
import { REPO_ROOT, VECTORS_DIR } from './helpers.mjs';

const set = loadVectorSet(VECTORS_DIR);
const failing = (results) => results.filter((r) => !r.passed).map((r) => `${r.id}: ${r.message}`);

describe('item F: replay vectors (EBA-114)', () => {
  it('covers both window edges, just outside both, a duplicate, another sender and a late duplicate', () => {
    const names = set.replay.window.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'exactly-5-00-old',
        'exactly-5-00-ahead',
        '1ms-past-5-00-old',
        '1ms-past-5-00-ahead',
        '10-minutes-old',
      ]),
    );
    const deliveries = set.replay.deliveries.map((d) => d.name);
    expect(deliveries).toEqual(
      expect.arrayContaining([
        'same-artifact-twice',
        'same-id-from-another-sender',
        'duplicate-after-the-window',
      ]),
    );
  });

  it('the SDK on this tree passes every item F check', async () => {
    const checks = replaySdkChecks(await loadSdk(REPO_ROOT), set);
    expect(checks.length).toBe(set.replay.window.length + set.replay.deliveries.length);
    expect(checks.every((c) => c.item === 'F' && c.id.startsWith('sdk/item-F/'))).toBe(true);
    expect(failing(await runChecks(checks))).toEqual([]);
  });

  it('every item F check fails on an SDK without replay protection', async () => {
    const results = await runChecks(replaySdkChecks({ utils: {}, storage: {} }, set));
    expect(results.every((r) => !r.passed)).toBe(true);
  });

  it('a step with an unknown outcome is a load error, not a skipped check', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'btps-vectors-'));
    fs.cpSync(VECTORS_DIR, dir, { recursive: true });
    const file = path.join(dir, 'replay.vectors.json');
    const model = JSON.parse(fs.readFileSync(file, 'utf8'));
    model.deliveries[0].steps[0].expect = 'maybe';
    fs.writeFileSync(file, JSON.stringify(model));
    expect(() => loadVectorSet(dir)).toThrow(VectorLoadError);
  });
});
