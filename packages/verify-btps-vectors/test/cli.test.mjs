import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BIN, KNOWN_FAILING } from './helpers.mjs';

const run = (...args) => {
  const r = spawnSync(process.execPath, ['--no-deprecation', BIN, ...args], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

describe('verify-btps-vectors CLI', () => {
  it('exits 0 when the failures are exactly the known-failing list', () => {
    const { code, out } = run('--known-failing', KNOWN_FAILING);
    expect(out).toMatch(/verify:btps-vectors: OK/);
    expect(code).toBe(0);
  });

  it('in strict mode exits 1 and names each failing check and its ticket', () => {
    const { code, out } = run();
    expect(code).toBe(1);
    expect(out).toMatch(
      /FAIL  sdk\/item-5\/managed\/verifySignature-accepts-reordered-payload \[item 5: EBA-115\]/,
    );
    expect(out).toMatch(/FAIL  sdk\/item-10\/gcm-tag\/truncated-4-byte-tag-rejected/);
  });

  it('exits 1 when the known-failing list is missing an entry', () => {
    const known = JSON.parse(fs.readFileSync(KNOWN_FAILING, 'utf8'));
    delete known.checks['sdk/item-10/gcm-tag/truncated-4-byte-tag-rejected'];
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'btps-kf-')), 'known.json');
    fs.writeFileSync(file, JSON.stringify(known));
    const { code, out } = run('--known-failing', file);
    expect(code).toBe(1);
    expect(out).toMatch(/^FAIL  sdk\/item-10\/gcm-tag\/truncated-4-byte-tag-rejected/m);
  });

  it('--json emits machine-readable results', () => {
    const { code, out } = run('--no-sdk', '--json');
    expect(code).toBe(0);
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.results.some((r) => r.id.startsWith('interop/web->node/'))).toBe(true);
  });

  it('exits 2 on an unknown option or an unreadable vector directory', () => {
    expect(run('--nope').code).toBe(2);
    expect(run('--vectors', path.join(os.tmpdir(), 'does-not-exist-btps')).code).toBe(2);
  });
});
