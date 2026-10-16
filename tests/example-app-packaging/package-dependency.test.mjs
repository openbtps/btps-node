// EBA-156: @btps/sdk must resolve reproducibly for btps-nest-app (workspace link or
// published version), not a gitignored, hand-built package.tgz.
//
// These checks are static (no install, no network) so they fail fast and name the
// exact cause: today examples/btps-nest-app/package.json and yarn.lock both still
// point @btps/sdk at ./package.tgz, a file that .gitignore excludes and that isn't
// reproducible across `yarn pack` runs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NEST_APP = path.join(ROOT, 'examples/btps-nest-app');

describe('examples/btps-nest-app dependency on @btps/sdk', () => {
  it('package.json resolves @btps/sdk through portal:, not a hand-built tarball', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(NEST_APP, 'package.json'), 'utf8'));
    const spec = pkg.dependencies?.['@btps/sdk'];

    expect(spec, '@btps/sdk must stay listed in dependencies').toBeTruthy();
    expect(spec).not.toMatch(/\.tgz/);
    expect(spec).not.toMatch(/^file:/);
    expect(spec).toMatch(/^portal:/);
  });

  it('yarn.lock carries a portal: resolution for @btps/sdk, with no package.tgz artifact reference', () => {
    const lockfile = fs.readFileSync(path.join(NEST_APP, 'yarn.lock'), 'utf8');

    expect(lockfile).not.toMatch(/@btps\/sdk@file:\.\/package\.tgz/);
    expect(lockfile).not.toContain('./package.tgz');
    expect(lockfile).toMatch(/@btps\/sdk@portal:/);
  });

  it('no gitignored package.tgz is required for the example app to resolve @btps/sdk', () => {
    // A hand-built tarball is exactly what made `yarn install --immutable` unreproducible
    // (EBA-154 discovery). If this file is still part of the resolution, the fix regressed.
    const pkg = JSON.parse(fs.readFileSync(path.join(NEST_APP, 'package.json'), 'utf8'));
    expect(fs.existsSync(path.join(NEST_APP, 'package.tgz'))).toBe(false);
    expect(JSON.stringify(pkg)).not.toContain('package.tgz');
  });
});
