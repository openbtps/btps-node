/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * What an app's bundle holds. An app that only draws never gets the
 * snapshot's code or opentype.js; an app that only captures never gets more
 * of the renderer than the snapshot uses; and no bundled font is in either
 * until a drawing needs it, each in a chunk of its own.
 */

import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const entry = path.join(root, 'packages/boundview/src/index.ts');

/**
 * The files in the chunk an app loads up front, and in each chunk it loads on demand, and what the bundler said.
 * `mainFields`: which of a package's builds it takes, as the app's bundler would.
 */
const bundle = async (names: string[], mainFields?: string[]) => {
  const result = await build({
    stdin: {
      contents: `import { ${names.join(', ')} } from '${entry}'; globalThis.used = [${names.join(', ')}];`,
      resolveDir: root,
      loader: 'js',
      sourcefile: 'app.js',
    },
    bundle: true,
    format: 'esm',
    splitting: true,
    outdir: path.join(root, 'node_modules/.cache/boundview-bundle'),
    write: false,
    metafile: true,
    platform: 'browser',
    tsconfig: path.join(root, 'tsconfig.json'),
    external: ['node:*'],
    ...(mainFields ? { mainFields } : {}),
    logLevel: 'silent',
  });
  const outputs = Object.values(result.metafile.outputs).filter((output) => Object.keys(output.inputs).length > 0);
  const inputsOf = (output: (typeof outputs)[number]) =>
    Object.entries(output.inputs)
      .filter(([, { bytesInOutput }]) => bytesInOutput > 0)
      .map(([file]) => file);
  const main = outputs.find((output) => output.entryPoint !== undefined);
  return {
    upFront: main ? inputsOf(main) : [],
    onDemand: outputs.filter((output) => output !== main).map(inputsOf),
    warnings: result.warnings.map((warning) => warning.text),
  };
};

const has = (files: string[], part: string) => files.some((file) => file.includes(part));

describe("an app's bundle", () => {
  it('holds no snapshot code and no font reader when the app only draws', async () => {
    const { upFront } = await bundle(['renderBoundView']);
    expect(has(upFront, 'opentype.js')).toBe(false);
    expect(has(upFront, 'snapshot/')).toBe(false);
    expect(has(upFront, 'render.ts')).toBe(true);
  });

  it('holds the snapshot and what it uses when the app only captures', async () => {
    const { upFront } = await bundle(['snapshotBoundView']);
    expect(has(upFront, 'snapshot/index.ts')).toBe(true);
    expect(has(upFront, 'opentype.js')).toBe(true);
  });

  // 1.2.0-rc.3 imported opentype.js's default export, which its ES module build does not have: a bundler that takes
  // that build (Turbopack, as Next.js uses it) refused the snapshot.
  it('takes opentype.js from its ES module build as well as from its UMD build, saying nothing of either', async () => {
    for (const mainFields of [['module'], ['main']]) {
      const { upFront, warnings } = await bundle(['snapshotBoundView'], mainFields);
      expect(has(upFront, 'opentype.js')).toBe(true);
      expect(warnings).toEqual([]);
    }
  });

  it('loads each bundled font only when a drawing needs it, in a chunk of its own', async () => {
    for (const names of [['renderBoundView'], ['snapshotBoundView']]) {
      const { upFront, onDemand } = await bundle(names);
      expect(has(upFront, 'glyphs/')).toBe(false);
      for (const font of ['arimo', 'tinos', 'cousine', 'carlito', 'caladea', 'caveat']) {
        expect(onDemand.some((files) => files.length === 1 && has(files, `glyphs/${font}.json`))).toBe(true);
      }
    }
  });
});
