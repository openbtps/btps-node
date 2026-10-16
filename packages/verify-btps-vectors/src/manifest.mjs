/**
 * The published vector set's manifest (EBA-123): `test/vectors/manifest.json`
 * names the set's version and the SHA-256 of every file in it, so a third
 * party can tell that the vectors it runs are byte for byte the ones
 * released, and so no vector changes without a new manifest.
 *
 * Node only: the runtime drivers and vector checks import nothing from Node,
 * and do not import this.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const MANIFEST_FILE = 'manifest.json';
export const VECTOR_SET_VERSION = '1.1.0';

/**
 * In the directory but not vectors: the manifest itself, the README, and the
 * harness's known-failing list, which is this repository's CI state.
 */
export const NOT_VECTORS = Object.freeze([MANIFEST_FILE, 'README.md', 'known-failing.json']);

/**
 * Every vector file of the set, as a sorted list of '/'-separated paths
 * relative to `dir`.
 * @param {string} dir
 * @returns {string[]}
 */
export function listVectorFiles(dir) {
  const files = [];
  const walk = (relative) => {
    for (const entry of fs.readdirSync(path.join(dir, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(name);
      else if (!NOT_VECTORS.includes(name)) files.push(name);
    }
  };
  walk('');
  return files.sort();
}

/** @param {string} file @returns {string} lowercase hex SHA-256 of the file's bytes */
export function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/**
 * The manifest for the files now in `dir`.
 * @param {string} dir
 */
export function buildManifest(dir) {
  return {
    name: 'btps-golden-vectors',
    version: VECTOR_SET_VERSION,
    protocol: 'BTPS 1.1',
    description:
      'The BTPS 1.1 golden vectors. Every file of the set, with the lowercase hex SHA-256 of its bytes. See docs/docusaurus/docs/protocol/specifications/golden-vectors.md.',
    hashAlgorithm: 'sha256',
    files: Object.fromEntries(
      listVectorFiles(dir).map((file) => [file, sha256File(path.join(dir, file))]),
    ),
  };
}

/** @param {string} dir */
export function readManifest(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, MANIFEST_FILE), 'utf8'));
}

/**
 * What differs between `dir` and its manifest.
 * @param {string} dir
 * @returns {{ changed: string[], missing: string[], unlisted: string[] }}
 */
export function compareManifest(dir) {
  const listed = readManifest(dir).files ?? {};
  const present = new Set(listVectorFiles(dir));
  const changed = [];
  const missing = [];
  for (const [file, hash] of Object.entries(listed)) {
    if (!present.has(file)) missing.push(file);
    else if (sha256File(path.join(dir, file)) !== hash) changed.push(file);
  }
  const unlisted = [...present].filter((file) => !(file in listed));
  return { changed, missing, unlisted };
}
