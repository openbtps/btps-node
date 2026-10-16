import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BIN, KNOWN_FAILING } from './helpers.mjs';

// Hermes, where installed, is exercised by hermes-runtime.test.mjs; these
// stay on node and web so they take the same time everywhere.
const run = (...args) => {
  const r = spawnSync(process.execPath, ['--no-deprecation', BIN, '--no-hermes', ...args], {
    encoding: 'utf8',
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

describe('verify-btps-vectors CLI', () => {
  it('exits 0 when the failures are exactly the known-failing list', () => {
    const { code, out } = run('--known-failing', KNOWN_FAILING);
    expect(out).toMatch(/verify:btps-vectors: OK/);
    expect(code).toBe(0);
  });

  it('in strict mode exits 0 once every check passes, naming each', () => {
    const { code, out } = run();
    expect(code).toBe(0);
    // Strict identity rules: a second `$`, and a `:`, are refused.
    expect(out).toMatch(
      /PASS {2}sdk\/defects\/identity\/reject\/alice\$saas\.example\$evil\.example$/m,
    );
    expect(out).toMatch(/PASS {2}sdk\/defects\/identity\/reject\/alice:evil\$saas\.example/);
    // A short GCM tag is refused on every decrypt path.
    expect(out).toMatch(/PASS {2}sdk\/defects\/gcm-tag\/truncated-4-byte-tag-rejected/);
    // Separate signature and encryption selectors.
    expect(out).toMatch(/PASS {2}sdk\/selectors\/artifact-names-signature-selector/);
  });

  it('exits 1 when the known-failing list names a check that now passes', () => {
    const known = JSON.parse(fs.readFileSync(KNOWN_FAILING, 'utf8'));
    known.checks['sdk/defects/identity/reject/alice$saas.example$evil.example'] =
      'strict identity rules';
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'btps-kf-')), 'known.json');
    fs.writeFileSync(file, JSON.stringify(known));
    const { code, out } = run('--known-failing', file);
    expect(code).toBe(1);
    expect(out).toMatch(
      /NOW PASSING, remove from the known-failing list: sdk\/defects\/identity\/reject\/alice\$saas\.example\$evil\.example/,
    );
  });

  it('--json emits machine-readable results', () => {
    const { code, out } = run('--no-sdk', '--json');
    expect(code).toBe(0);
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.results.some((r) => r.id.startsWith('interop/web->node/'))).toBe(true);
    expect(parsed.hermes).toEqual({ available: false, reason: '--no-hermes' });
    expect(parsed.results.some((r) => r.id.includes('hermes'))).toBe(false);
  });

  it('says when Hermes is not run, and why', () => {
    const { out } = run('--no-sdk');
    expect(out).toMatch(/verify-btps-vectors: hermes not run: --no-hermes/);
  });

  it('exits 2 on an unknown option or an unreadable vector directory', () => {
    expect(run('--nope').code).toBe(2);
    expect(run('--vectors', path.join(os.tmpdir(), 'does-not-exist-btps')).code).toBe(2);
  });
});
