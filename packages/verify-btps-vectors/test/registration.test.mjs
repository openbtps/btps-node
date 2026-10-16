import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { registrationSdkChecks } from '../src/checks/registration.mjs';
import { runChecks } from '../src/runner.mjs';
import { loadSdk } from '../src/sdk-loader.mjs';
import { VectorLoadError, loadVectorSet } from '../src/vectors.mjs';
import { REPO_ROOT, VECTORS_DIR } from './helpers.mjs';

const set = loadVectorSet(VECTORS_DIR);
const failing = (results) => results.filter((r) => !r.passed).map((r) => `${r.id}: ${r.message}`);

describe('item E: registration vectors (EBA-113)', () => {
  it('covers the acceptance cases', () => {
    const names = set.registration.sequences.map((s) => s.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'lifecycle-register-then-reuse-refused',
        'token-reused-on-second-device-refused',
        'expired-token-refused',
        'missing-token-refused',
        'token-of-another-identity-refused',
        'no-token-store-refused',
      ]),
    );
    expect(set.registration.sequences.some((s) => s.lifecycle)).toBe(true);
    expect(set.registration.concurrent.requests).toHaveLength(2);
    const reasons = new Set(
      set.registration.forged.cases.filter((c) => c.expect === 'refuse').map((c) => c.reason),
    );
    expect([...reasons].sort()).toEqual(['no-record', 'not-an-agent', 'signature']);
  });

  it('the SDK on this tree passes every item E check', async () => {
    const checks = registrationSdkChecks(await loadSdk(REPO_ROOT), set);
    expect(checks.length).toBe(
      set.registration.sequences.length + 1 + set.registration.forged.cases.length,
    );
    expect(checks.every((c) => c.item === 'E' && c.id.startsWith('sdk/item-E/'))).toBe(true);
    expect(failing(await runChecks(checks))).toEqual([]);
  });

  it('every item E check fails on an SDK without the registration check', async () => {
    const results = await runChecks(registrationSdkChecks({ authentication: null }, set));
    expect(results.every((r) => !r.passed)).toBe(true);
  });

  it('a sequence issuing an unknown token is a load error, not a skipped check', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'btps-vectors-'));
    fs.cpSync(VECTORS_DIR, dir, { recursive: true });
    const file = path.join(dir, 'registration.vectors.json');
    const model = JSON.parse(fs.readFileSync(file, 'utf8'));
    model.sequences[0].issue = ['missing'];
    fs.writeFileSync(file, JSON.stringify(model));
    expect(() => loadVectorSet(dir)).toThrow(VectorLoadError);
  });
});
