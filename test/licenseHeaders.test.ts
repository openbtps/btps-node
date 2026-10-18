/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// Every source file carries the Apache-2.0 header (scripts/license-header.txt).
// `yarn build` adds a missing one to the built files, but a source file
// committed without it would ship its header only by accident of the build.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HEADER = 'Licensed under the Apache License, Version 2.0';

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|js)$/.test(entry.name) ? [path] : [];
  });

describe('license headers', () => {
  it('are on every source file in src/', () => {
    const missing = sourceFiles(join(ROOT, 'src'))
      .filter((file) => !readFileSync(file, 'utf8').slice(0, 400).includes(HEADER))
      .map((file) => relative(ROOT, file));

    expect(missing).toEqual([]);
  });
});
