// The web driver and the vector checks must run in a browser unchanged, so
// nothing they import (transitively) may be a Node built-in.

import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { describe, expect, it } from 'vitest';
import { PACKAGE_DIR } from './helpers.mjs';

const PORTABLE_ENTRIES = [
  'src/runtimes/web.mjs',
  'src/checks/vectors.mjs',
  'src/checks/interop.mjs',
  'src/checks/documents.mjs',
  'src/checks/events.mjs',
  'src/hermes-crypto-core.mjs',
];
const BUILTINS = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));
// Third-party packages the portable files may import. Each is plain
// ECMAScript with no Node built-ins, which the bundle test below proves.
const PORTABLE_PACKAGES = new Set(['@humanwhocodes/momoa', 'json-canonicalize']);
const IMPORT =
  /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function importsOf(file) {
  // Drop comments first: JSDoc types such as {import('../x.mjs').T} are not imports.
  const source = fs
    .readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  return [...source.matchAll(IMPORT)].map((m) => m[1] ?? m[2]);
}

function closure(entry) {
  const seen = new Set();
  const stack = [path.join(PACKAGE_DIR, entry)];
  const offending = [];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of importsOf(file)) {
      if (specifier.startsWith('.')) stack.push(path.resolve(path.dirname(file), specifier));
      else if (BUILTINS.has(specifier) || specifier.startsWith('node:'))
        offending.push(`${path.relative(PACKAGE_DIR, file)} → ${specifier}`);
      else if (!PORTABLE_PACKAGES.has(specifier))
        offending.push(`${path.relative(PACKAGE_DIR, file)} → ${specifier} (third-party)`);
    }
  }
  return { files: seen, offending };
}

describe('portability of the web driver and vector checks', () => {
  for (const entry of PORTABLE_ENTRIES) {
    it(`${entry} imports nothing Node-specific, and no third-party package but the portable ones`, () => {
      const { files, offending } = closure(entry);
      expect(files.size).toBeGreaterThan(0);
      expect(offending).toEqual([]);
    });

    it(`${entry} bundles for a platform with no Node built-ins`, async () => {
      const { build } = await import('esbuild');
      const result = await build({
        entryPoints: [path.join(PACKAGE_DIR, entry)],
        bundle: true,
        write: false,
        platform: 'neutral',
        mainFields: ['module', 'main'],
        format: 'esm',
        logLevel: 'silent',
      });
      expect(result.errors).toEqual([]);
      expect(result.outputFiles[0].text).not.toMatch(/from\s*["']node:/);
    });
  }

  it('the scan does catch a Node import (guards against a regex that matches nothing)', () => {
    expect(closure('src/runtimes/node.mjs').offending).toContain(
      'src/runtimes/node.mjs → node:crypto',
    );
  });
});
