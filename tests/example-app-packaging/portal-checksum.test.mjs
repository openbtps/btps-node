// EBA-156 acceptance criterion 1: before relying on a `portal:` link (Option A)
// to resolve @btps/sdk reproducibly, verify whether Yarn 4.9.2 writes a
// `checksum:` field for portal: entries in the lockfile.
//
// Why this matters: a checksum is an integrity hash over fetched package
// contents. A portal: dependency is never fetched — it's a live link to a
// local directory — so if Yarn ever started hashing it, the hash would go
// stale the moment a source file changed without a lockfile update, and
// `yarn install --immutable` would then fail unpredictably on untouched
// clones. That would make Option A exactly as unreproducible as the
// gitignored package.tgz it's meant to replace.
//
// The ticket is explicit about what a positive finding means: "If they do,
// Option A fails — stop, say so on EBA-156, and return to Bhupendra; do not
// switch to Option B." This test is that gate, not just a sanity check — a
// failure here means stop and escalate, not patch the code and re-run.
//
// No YAML/lockfile parser is a project dependency (see ci-workflow.test.mjs),
// so this reads the lockfile as text, the same way.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NEST_APP = path.join(ROOT, 'examples/btps-nest-app');

const STOP_MESSAGE =
  'EBA-156 criterion 1: portal: entries carry a checksum under this Yarn version. ' +
  'Per the ticket, Option A fails — STOP, record this on EBA-156, and return to ' +
  'Bhupendra. Do not switch to Option B.';

function readPackageManager(pkgJsonPath) {
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
  return pkg.packageManager;
}

// Slices a single lockfile entry block: from its resolution header line
// (an unindented line ending in ':') up to the next unindented line or EOF.
function entryBlock(lockfileText, headerPredicate) {
  const lines = lockfileText.split('\n');
  const headerIndex = lines.findIndex(headerPredicate);
  if (headerIndex === -1) return null;

  let end = lines.length;
  for (let i = headerIndex + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(headerIndex, end).join('\n');
}

describe('EBA-156 criterion 1: Yarn 4.9.2 portal: checksum gate', () => {
  it('pins the Yarn version this finding is valid for', () => {
    // If this ever changes, criterion 1 needs re-verification under the new
    // version before anyone trusts the assertions below.
    expect(readPackageManager(path.join(ROOT, 'package.json'))).toBe('yarn@4.9.2');
    expect(readPackageManager(path.join(NEST_APP, 'package.json'))).toBe('yarn@4.9.2');
  });

  it('root yarn.lock has no checksum on any portal: resolution', () => {
    const lockfileText = fs.readFileSync(path.join(ROOT, 'yarn.lock'), 'utf8');
    const portalHeaders = lockfileText
      .split('\n')
      .filter((l) => /^"?[^"\s]+@portal:/.test(l) && l.trim().endsWith(':'));

    for (const header of portalHeaders) {
      const block = entryBlock(lockfileText, (l) => l === header);
      expect(block, STOP_MESSAGE).not.toMatch(/^\s*checksum:/m);
    }
  });

  it('examples/btps-nest-app/yarn.lock has no checksum on the @btps/sdk portal: resolution', () => {
    const lockfileText = fs.readFileSync(path.join(NEST_APP, 'yarn.lock'), 'utf8');
    const block = entryBlock(lockfileText, (l) => /^"@btps\/sdk@portal:/.test(l));

    expect(block, '@btps/sdk must resolve via a portal: entry in this lockfile').not.toBeNull();
    expect(block, STOP_MESSAGE).not.toMatch(/^\s*checksum:/m);
  });

  it('examples/btps-nest-app/yarn.lock has no checksum on any portal: resolution', () => {
    const lockfileText = fs.readFileSync(path.join(NEST_APP, 'yarn.lock'), 'utf8');
    const portalHeaders = lockfileText
      .split('\n')
      .filter((l) => /^"?[^"\s]+@portal:/.test(l) && l.trim().endsWith(':'));

    expect(portalHeaders.length, 'expected at least one portal: entry (the @btps/sdk link)').toBeGreaterThan(0);

    for (const header of portalHeaders) {
      const block = entryBlock(lockfileText, (l) => l === header);
      expect(block, STOP_MESSAGE).not.toMatch(/^\s*checksum:/m);
    }
  });

  it('would actually catch a checksum on a portal: entry (negative control)', () => {
    // Guards against the three checks above passing vacuously — e.g. because
    // entryBlock silently matched nothing. Proves the detection regex fires
    // on a fabricated entry shaped like a real one, before trusting it to
    // stay silent on the real lockfiles above.
    const fixture = [
      'unrelated-package@npm:1.0.0:',
      '  version: 1.0.0',
      '  languageName: node',
      '',
      '"@btps/sdk@portal:../..::locator=btps-nest-app%40workspace%3A.":',
      '  version: 0.0.0-use.local',
      '  resolution: "@btps/sdk@portal:../..::locator=btps-nest-app%40workspace%3A."',
      '  checksum: 10/deadbeef',
      '  languageName: node',
      '',
      'another-package@npm:2.0.0:',
      '  version: 2.0.0',
    ].join('\n');

    const block = entryBlock(fixture, (l) => /^"@btps\/sdk@portal:/.test(l));
    expect(block).not.toBeNull();
    expect(block).toMatch(/^\s*checksum:/m);
  });
});
