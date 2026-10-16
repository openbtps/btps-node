import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { refreshSdkChecks } from '../src/checks/refresh.mjs';
import { runChecks } from '../src/runner.mjs';
import { loadSdk } from '../src/sdk-loader.mjs';
import { VectorLoadError, loadVectorSet } from '../src/vectors.mjs';
import { REPO_ROOT, VECTORS_DIR } from './helpers.mjs';

const set = loadVectorSet(VECTORS_DIR);
const failing = (results) => results.filter((r) => !r.passed).map((r) => `${r.id}: ${r.message}`);

describe('refresh vectors', () => {
  it('covers the acceptance cases for self-held custody, and managed as not applicable', () => {
    const names = set.refresh.selfHeld.cases.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'refresh-without-rotation-accepted',
        'rotation-signed-by-current-key-with-countersigned-new-key-accepted',
        'rotation-signed-only-by-new-key-refused',
        'rotation-without-proof-refused',
        'rotation-proof-signed-by-another-key-refused',
      ]),
    );
    expect(set.refresh.selfHeld.tokens.some((t) => t.expect === 'refuse')).toBe(true);
    expect(set.refresh.managed.description).toMatch(/^Not applicable/);
    expect(set.refresh.managed.cases.every((c) => c.expect === 'refuse')).toBe(true);
  });

  it('the SDK on this tree passes every sdk/refresh check', async () => {
    const checks = refreshSdkChecks(await loadSdk(REPO_ROOT), set);
    expect(checks.length).toBe(
      set.refresh.selfHeld.cases.length + set.refresh.managed.cases.length + 1,
    );
    expect(checks.every((c) => c.id.startsWith('sdk/refresh/'))).toBe(true);
    expect(failing(await runChecks(checks))).toEqual([]);
  });

  it('every sdk/refresh check fails on an SDK without the refresh check', async () => {
    const results = await runChecks(refreshSdkChecks({ authentication: null }, set));
    expect(results.every((r) => !r.passed)).toBe(true);
  });

  it('a case with an unknown current key is a load error, not a skipped check', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'btps-vectors-'));
    fs.cpSync(VECTORS_DIR, dir, { recursive: true });
    const file = path.join(dir, 'refresh.vectors.json');
    const model = JSON.parse(fs.readFileSync(file, 'utf8'));
    model.selfHeld.cases[0].currentKey = 'missing';
    fs.writeFileSync(file, JSON.stringify(model));
    expect(() => loadVectorSet(dir)).toThrow(VectorLoadError);
  });
});
