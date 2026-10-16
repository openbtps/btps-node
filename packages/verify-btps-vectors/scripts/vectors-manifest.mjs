#!/usr/bin/env node
/**
 * The published golden vector set's manifest.
 *
 *   node packages/verify-btps-vectors/scripts/vectors-manifest.mjs [--check] [--no-sdk] [--vectors <dir>]
 *   node packages/verify-btps-vectors/scripts/vectors-manifest.mjs --write
 *
 * --check (the default) checks that every file in the set has the SHA-256 the
 * manifest gives it, that none is missing or unlisted, and that the set is
 * the version VECTOR_SET_VERSION names (src/manifest.mjs). Then it reproduces the set's derived values: it runs the
 * whole harness (bin/verify-btps-vectors.mjs) over the set, which recomputes
 * every canonical form, signature, fingerprint, unwrap and verdict from the
 * vectors' inputs and compares it with the published one. --no-sdk runs only
 * the checks that need no SDK source tree, as a third party would.
 *
 * --write rewrites manifest.json from the files now in the set. Only do that
 * when the set is meant to change: vectors are frozen once other code is
 * tested against them (test/vectors/README.md), and a changed set is a new
 * version of it.
 *
 * Exit codes: 0 OK, 1 a check failed, 2 the run could not start.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { MANIFEST_FILE, buildManifest, compareManifest, readManifest } from '../src/manifest.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '../..');

function main() {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        vectors: { type: 'string', default: path.join(REPO_ROOT, 'test/vectors') },
        write: { type: 'boolean', default: false },
        check: { type: 'boolean', default: false },
        'no-sdk': { type: 'boolean', default: false },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    console.error(`vectors-manifest: ${error.message}`);
    return 2;
  }
  const dir = path.resolve(values.vectors);
  if (!fs.existsSync(dir)) {
    console.error(`vectors-manifest: no vector set at ${dir}`);
    return 2;
  }

  if (values.write) {
    const manifest = buildManifest(dir);
    fs.writeFileSync(path.join(dir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(
      `wrote ${MANIFEST_FILE}: ${Object.keys(manifest.files).length} files, version ${manifest.version}`,
    );
    return 0;
  }

  let manifest;
  try {
    manifest = readManifest(dir);
  } catch (error) {
    console.error(`vectors-manifest: cannot read ${MANIFEST_FILE}: ${error.message}`);
    return 2;
  }
  const { changed, missing, unlisted } = compareManifest(dir);
  for (const file of changed) console.log(`CHANGED   ${file}`);
  for (const file of missing) console.log(`MISSING   ${file}`);
  for (const file of unlisted) console.log(`UNLISTED  ${file}`);
  const files = Object.keys(manifest.files ?? {}).length;
  if (changed.length || missing.length || unlisted.length) {
    console.log(`manifest: FAILED (version ${manifest.version}, ${files} files)`);
    return 1;
  }
  console.log(`manifest: OK (version ${manifest.version}, ${files} files, sha256)`);

  const harness = [
    path.join(PACKAGE_ROOT, 'bin/verify-btps-vectors.mjs'),
    '--vectors',
    dir,
    ...(values['no-sdk']
      ? ['--no-sdk']
      : ['--known-failing', path.join(dir, 'known-failing.json')]),
  ];
  const run = spawnSync(process.execPath, harness, { stdio: ['ignore', 'pipe', 'inherit'] });
  const summary = run.stdout.toString().trim().split('\n').slice(-3).join('\n');
  console.log(summary);
  return run.status ?? 1;
}

process.exitCode = main();
