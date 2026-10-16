/**
 * The published set is the one its manifest names: the version is
 * 1.1.0, and every file is present, unchanged and listed. A vector edited
 * without a new manifest fails here, so the set cannot drift from what was
 * released.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ensure } from '../check.mjs';
import { MANIFEST_FILE, VECTOR_SET_VERSION, compareManifest, readManifest } from '../manifest.mjs';

/**
 * @param {string} vectorsDir
 * @returns {import('../check.mjs').Check[]}
 */
export function manifestChecks(vectorsDir) {
  const present = () => fs.existsSync(path.join(vectorsDir, MANIFEST_FILE));
  return [
    {
      id: 'manifest/names-the-set-version',
      run() {
        ensure(present(), `${MANIFEST_FILE} is missing from ${vectorsDir}`);
        const { version, hashAlgorithm } = readManifest(vectorsDir);
        ensure(
          version === VECTOR_SET_VERSION,
          `version is ${version}, expected ${VECTOR_SET_VERSION}`,
        );
        ensure(hashAlgorithm === 'sha256', `hashAlgorithm is ${hashAlgorithm}, expected sha256`);
      },
    },
    {
      id: 'manifest/every-file-matches-its-hash',
      run() {
        ensure(present(), `${MANIFEST_FILE} is missing from ${vectorsDir}`);
        const { changed, missing } = compareManifest(vectorsDir);
        ensure(missing.length === 0, `listed but missing: ${missing.join(', ')}`);
        ensure(
          changed.length === 0,
          `changed since the manifest was written: ${changed.join(', ')}`,
        );
      },
    },
    {
      id: 'manifest/every-file-is-listed',
      run() {
        ensure(present(), `${MANIFEST_FILE} is missing from ${vectorsDir}`);
        const { unlisted } = compareManifest(vectorsDir);
        ensure(unlisted.length === 0, `not in the manifest: ${unlisted.join(', ')}`);
      },
    },
  ];
}

/**
 * A runtime with `sha256Hex` recomputes every listed file's lowercase hex
 * SHA-256 itself, so the manifest is checkable wherever the set is run.
 *
 * @param {import('../runtimes/types.mjs').RuntimeDriver} runtime
 * @param {string} vectorsDir
 * @returns {import('../check.mjs').Check[]}
 */
export function manifestDigestChecks(runtime, vectorsDir) {
  if (!runtime.sha256Hex) return [];
  return [
    {
      id: `vectors/${runtime.name}/sha256/manifest-files`,
      async run() {
        ensure(
          fs.existsSync(path.join(vectorsDir, MANIFEST_FILE)),
          `${MANIFEST_FILE} is missing from ${vectorsDir}`,
        );
        for (const [file, hash] of Object.entries(readManifest(vectorsDir).files ?? {})) {
          const full = path.join(vectorsDir, file);
          ensure(fs.existsSync(full), `${file} is listed but missing`);
          const digest = await runtime.sha256Hex(new Uint8Array(fs.readFileSync(full)));
          ensure(digest === hash, `${file}: sha256 ${digest}, the manifest says ${hash}`);
        }
      },
    },
  ];
}
