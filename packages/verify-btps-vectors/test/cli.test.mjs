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

  // While a release is built, its checks are known to fail; strict passes once the list is empty.
  it('in strict mode exits 0 exactly when no check is known to fail on this tree', () => {
    const known = JSON.parse(fs.readFileSync(KNOWN_FAILING, 'utf8'));
    const { code, out } = run();
    const empty = Object.keys(known.checks).length === 0;
    expect(out).toMatch(empty ? /verify:btps-vectors: OK/ : /verify:btps-vectors: FAILED/);
    expect(code).toBe(empty ? 0 : 1);
  });

  it('exits 1 when the known-failing list names a check that now passes', () => {
    const known = JSON.parse(fs.readFileSync(KNOWN_FAILING, 'utf8'));
    known.checks['sdk/item-10/gcm-tag/truncated-4-byte-tag-rejected'] = 'already fixed';
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'btps-kf-')), 'known.json');
    fs.writeFileSync(file, JSON.stringify(known));
    const { code, out } = run('--known-failing', file);
    expect(code).toBe(1);
    expect(out).toMatch(/NOW PASSING.*sdk\/item-10\/gcm-tag\/truncated-4-byte-tag-rejected/);
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
