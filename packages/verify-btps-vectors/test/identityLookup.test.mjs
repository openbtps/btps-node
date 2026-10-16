import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { identityLookupSdkChecks } from '../src/checks/identityLookup.mjs';
import { runChecks } from '../src/runner.mjs';
import { loadSdk } from '../src/sdk-loader.mjs';
import { VectorLoadError, loadVectorSet } from '../src/vectors.mjs';
import { REPO_ROOT, VECTORS_DIR } from './helpers.mjs';

const set = loadVectorSet(VECTORS_DIR);
const failing = (results) => results.filter((r) => !r.passed).map((r) => `${r.id}: ${r.message}`);
const total = () =>
  set.identityLookup.parse.length +
  set.identityLookup.dns.length +
  set.identityLookup.lookup.cases.length;

describe('item J: identity lookup vectors (EBA-442, EBA-186)', () => {
  it('covers padded keys, an absent record, and every answer the client must refuse', () => {
    const model = set.identityLookup;
    expect(model.parse.map((c) => c.name)).toEqual(
      expect.arrayContaining(['3072-bit-padded', '4096-bit-padded']),
    );
    for (const c of model.parse.filter((p) => p.name.endsWith('-padded'))) {
      expect(c.expect.p.endsWith('=')).toBe(true);
    }
    expect(model.dns.map((c) => c.expect)).toEqual(
      expect.arrayContaining(['key', 'absent', 'error']),
    );
    expect(model.lookup.cases.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'signed-answer-accepted',
        'signed-with-encryption-null-added-refused',
        'signed-outside-the-address-domain-refused',
        'answer-to-another-request-refused',
      ]),
    );
  });

  it('the SDK on this tree passes every item J check', async () => {
    const checks = identityLookupSdkChecks(await loadSdk(REPO_ROOT), set);
    expect(checks.length).toBe(total());
    expect(checks.every((c) => c.item === 'J' && c.id.startsWith('sdk/item-J/'))).toBe(true);
    expect(failing(await runChecks(checks))).toEqual([]);
  });

  it('every item J check fails on an SDK without the repaired lookup', async () => {
    const results = await runChecks(
      identityLookupSdkChecks({ utils: {}, crypto: {}, setTxtRecords: () => {} }, set),
    );
    expect(results.every((r) => !r.passed)).toBe(true);
  });

  it('a lookup case with an unknown outcome is a load error, not a skipped check', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'btps-vectors-'));
    fs.cpSync(VECTORS_DIR, dir, { recursive: true });
    const file = path.join(dir, 'identity-lookup.vectors.json');
    const model = JSON.parse(fs.readFileSync(file, 'utf8'));
    model.lookup.cases[0].expect = 'maybe';
    fs.writeFileSync(file, JSON.stringify(model));
    expect(() => loadVectorSet(dir)).toThrow(VectorLoadError);
  });
});
