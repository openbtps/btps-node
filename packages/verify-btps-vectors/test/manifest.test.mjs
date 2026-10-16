import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runChecks } from '../src/runner.mjs';
import { manifestChecks } from '../src/checks/manifest.mjs';
import { MANIFEST_FILE, buildManifest, listVectorFiles, readManifest } from '../src/manifest.mjs';
import { PACKAGE_DIR, VECTORS_DIR } from './helpers.mjs';

const SCRIPT = path.join(PACKAGE_DIR, 'scripts/vectors-manifest.mjs');

function copyVectors(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'btps-manifest-'));
  fs.cpSync(VECTORS_DIR, dir, { recursive: true });
  mutate?.(dir);
  return dir;
}

const failingIds = async (dir) =>
  (await runChecks(manifestChecks(dir))).filter((r) => !r.passed).map((r) => r.id);

describe('the published vector manifest (EBA-123)', () => {
  it('is version 1.1.1 and matches the committed set exactly', async () => {
    const manifest = readManifest(VECTORS_DIR);
    expect(manifest.version).toBe('1.1.1');
    expect(manifest).toEqual(buildManifest(VECTORS_DIR));
    expect(Object.keys(manifest.files)).toEqual(listVectorFiles(VECTORS_DIR));
    expect(await failingIds(VECTORS_DIR)).toEqual([]);
  });

  it('lists every vector file, and nothing that is not one', () => {
    const files = Object.keys(readManifest(VECTORS_DIR).files);
    expect(files).toContain('documents/invoice.v2.json');
    expect(files).toContain('events/paid.by-payer.json');
    expect(files).not.toContain(MANIFEST_FILE);
    expect(files).not.toContain('README.md');
    expect(files).not.toContain('known-failing.json');
  });

  it('fails when a vector changes by one byte', async () => {
    const dir = copyVectors((d) => fs.appendFileSync(path.join(d, 'oaep-wrap.vector.json'), ' '));
    expect(await failingIds(dir)).toEqual(['manifest/every-file-matches-its-hash']);
  });

  it('fails when a vector is missing, or one is added without the manifest', async () => {
    const removed = copyVectors((d) => fs.rmSync(path.join(d, 'events/refund.json')));
    expect(await failingIds(removed)).toEqual(['manifest/every-file-matches-its-hash']);
    const added = copyVectors((d) => fs.writeFileSync(path.join(d, 'events/extra.json'), '{}'));
    expect(await failingIds(added)).toEqual(['manifest/every-file-is-listed']);
  });

  it('fails every check when there is no manifest', async () => {
    const dir = copyVectors((d) => fs.rmSync(path.join(d, MANIFEST_FILE)));
    expect(await failingIds(dir)).toHaveLength(3);
  });

  it('the script reports a changed file and exits 1', () => {
    const dir = copyVectors((d) => fs.appendFileSync(path.join(d, 'jcs.vectors.json'), '\n'));
    const run = spawnSync(process.execPath, [SCRIPT, '--vectors', dir, '--no-sdk']);
    expect(run.status).toBe(1);
    expect(run.stdout.toString()).toMatch(/CHANGED\s+jcs\.vectors\.json/);
  });
});
