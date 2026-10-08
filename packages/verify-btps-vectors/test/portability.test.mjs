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
  // EBA-150: the iOS and Android drivers run inside the Expo app, so they
  // must clear the same bar as the web driver they stand next to.
  'src/runtimes/ios.mjs',
  'src/runtimes/android.mjs',
];
const BUILTINS = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));
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
      else offending.push(`${path.relative(PACKAGE_DIR, file)} → ${specifier} (third-party)`);
    }
  }
  return { files: seen, offending };
}

describe('portability of the web driver and vector checks', () => {
  for (const entry of PORTABLE_ENTRIES) {
    it(`${entry} imports nothing Node-specific or third-party`, () => {
      const { files, offending } = closure(entry);
      expect(files.size).toBeGreaterThan(0);
      expect(offending).toEqual([]);
    });
  }

  it('the scan does catch a Node import (guards against a regex that matches nothing)', () => {
    expect(closure('src/runtimes/node.mjs').offending).toContain(
      'src/runtimes/node.mjs → node:crypto',
    );
  });
});
