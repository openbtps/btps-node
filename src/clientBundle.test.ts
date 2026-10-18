/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { build } from 'esbuild';
import { builtinModules } from 'module';

// What a phone or a browser app imports. Bundling it must never reach the
// server or the JSON file stores, which need a file system and Node's loader.
const clientEntryPoints = [
  'src/client/index.ts',
  'src/core/authentication/index.ts',
  'src/core/crypto/index.ts',
];

const bundled = async (entry: string) => {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    metafile: true,
    format: 'esm',
    platform: 'neutral',
    logLevel: 'silent',
    external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
  });
  return Object.keys(result.metafile.inputs);
};

describe('a client bundle', () => {
  it.each(clientEntryPoints)('%s reaches no server code and no file store', async (entry) => {
    const inputs = await bundled(entry);

    expect(inputs.filter((file) => file.startsWith('src/server/'))).toEqual([]);
    expect(inputs.filter((file) => /Json\w*Store|proper-lockfile/.test(file))).toEqual([]);
  });
});
