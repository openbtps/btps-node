/**
 * Loads the SDK under test (@btps/sdk, TypeScript in src/) straight from a
 * source tree, so the vectors can be run against any checkout — the working
 * tree, or the 367cd09 baseline in a `git worktree` — without building it.
 *
 * esbuild bundles the SDK's crypto and utils modules (it honours the
 * tsconfig `@core/*` paths) into one temporary ES module. `dns/promises` is
 * replaced by an in-memory resolver: the vectors never touch the network,
 * and each check states exactly which TXT records exist.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const FAKE_DNS_NAMESPACE = 'verify-btps-vectors-dns';
const DOCUMENTS_ENTRY = 'src/core/server/schemas/documents/index.ts';

const fakeDnsModule = `
let records = new Map();
export async function resolveTxt(name) {
  const found = records.get(name);
  if (!found) {
    const error = new Error('verify-btps-vectors: no TXT record for ' + name + ' (DNS is offline in vector runs)');
    error.code = 'ENOTFOUND';
    throw error;
  }
  return found.map((value) => [value]);
}
export function __setTxtRecords(entries) {
  records = new Map(Object.entries(entries));
}
`;

const fakeDnsPlugin = {
  name: 'verify-btps-vectors-fake-dns',
  setup(build) {
    build.onResolve({ filter: /^(node:)?dns\/promises$|^verify-btps-vectors:dns$/ }, () => ({
      path: 'dns',
      namespace: FAKE_DNS_NAMESPACE,
    }));
    build.onLoad({ filter: /.*/, namespace: FAKE_DNS_NAMESPACE }, () => ({
      contents: fakeDnsModule,
      loader: 'js',
    }));
  },
};

/**
 * @typedef {object} LoadedSdk
 * @property {Record<string, any>} crypto exports of src/core/crypto/index.ts
 * @property {Record<string, any>} utils  exports of src/core/utils/index.ts
 * @property {Record<string, any> | null} documents exports of
 *   src/core/server/schemas/documents/index.ts (@btps/sdk/documents), or
 *   null on a tree without document model v2
 * @property {(records: Record<string, string[]>) => void} setTxtRecords replace the fake DNS zone
 * @property {string} root the SDK source tree that was loaded
 */

/**
 * @param {string} sdkRoot a checkout of openbtps/btps-node
 * @returns {Promise<LoadedSdk>}
 * @throws {Error} when the tree is not an SDK checkout or does not bundle
 */
export async function loadSdk(sdkRoot) {
  const root = path.resolve(sdkRoot);
  for (const required of ['src/core/crypto/index.ts', 'src/core/utils/index.ts', 'tsconfig.json']) {
    if (!fs.existsSync(path.join(root, required))) {
      throw new Error(`${root} is not a btps-node checkout: ${required} is missing`);
    }
  }

  // Document model v2 (item 7) is absent from trees before EBA-119/EBA-402;
  // its checks then fail rather than the whole run.
  const hasDocuments = fs.existsSync(path.join(root, DOCUMENTS_ENTRY));

  const { build } = await import('esbuild');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-btps-vectors-sdk-'));
  const outfile = path.join(outDir, 'sdk.mjs');
  try {
    await build({
      stdin: {
        contents: [
          "export * as crypto from './src/core/crypto/index.ts';",
          "export * as utils from './src/core/utils/index.ts';",
          hasDocuments
            ? `export * as documents from './${DOCUMENTS_ENTRY}';`
            : 'export const documents = null;',
          "export { __setTxtRecords } from 'verify-btps-vectors:dns';",
        ].join('\n'),
        resolveDir: root,
        sourcefile: 'verify-btps-vectors-sdk-entry.mjs',
        loader: 'js',
      },
      absWorkingDir: root,
      tsconfig: path.join(root, 'tsconfig.json'),
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node20',
      outfile,
      logLevel: 'silent',
      // Bundled CommonJS dependencies may call require(); give ESM output one.
      banner: {
        js: "import { createRequire as __vbvCreateRequire } from 'node:module'; const require = __vbvCreateRequire(import.meta.url);",
      },
      plugins: [fakeDnsPlugin],
    });
    const mod = await import(pathToFileURL(outfile).href);
    return {
      crypto: mod.crypto,
      utils: mod.utils,
      documents: mod.documents,
      setTxtRecords: mod.__setTxtRecords,
      root,
    };
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}
