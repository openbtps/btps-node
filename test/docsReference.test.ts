/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * The docs keep up with what the SDK exports (AGENTS.md, Changes).
 *
 * - Every name a code block on any page imports from `@btps/sdk`, by any of its published
 *   subpaths, is exported there: a renamed or removed export fails here, sketch or not.
 * - Every name each published subpath exports is in the SDK reference (sdk/apiReference.md,
 *   sdk/classApiReference.md, sdk/typesAndInterfaces.md): a new export ships documented.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs/docusaurus/docs');
const REFERENCE = ['sdk/apiReference.md', 'sdk/classApiReference.md', 'sdk/typesAndInterfaces.md'];

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
  exports: Record<string, { import?: string }>;
};
// `@btps/sdk/trust` → src/core/trust/index.ts, as the build maps each subpath.
const SUBPATHS = Object.entries(pkg.exports).flatMap(([subpath, target]) =>
  target.import
    ? [[`@btps/sdk${subpath.slice(1)}`, path.join(ROOT, 'src', target.import.replace('./dist/', '').replace(/\.js$/, '.ts'))] as const]
    : [],
);

const PAGES = (fs.readdirSync(DOCS, { recursive: true }) as string[])
  .filter((file) => file.endsWith('.md') || file.endsWith('.mdx'))
  .map((file) => file.split(path.sep).join('/'))
  .sort();

type Imported = { at: string; from: string; name: string };

// `import { a, type B, c as d } from '@btps/sdk/x'` in a ts, tsx, js or jsx block.
const imported: Imported[] = PAGES.flatMap((page) => {
  const text = fs.readFileSync(path.join(DOCS, page), 'utf8');
  const found: Imported[] = [];
  const fence = /^```(?:ts|tsx|js|jsx|typescript|javascript)\b[^\n]*\n([\s\S]*?)^```/gm;
  for (let block = fence.exec(text); block; block = fence.exec(text)) {
    const line = text.slice(0, block.index).split('\n').length;
    const statement = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"](@btps\/sdk[^'"]*)['"]/g;
    for (let match = statement.exec(block[1] ?? ''); match; match = statement.exec(block[1] ?? '')) {
      for (const part of (match[1] ?? '').split(',')) {
        const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]?.trim();
        if (name) found.push({ at: `${page}:${line}`, from: match[2] ?? '', name });
      }
    }
  }
  return found;
});

describe('the docs and what the SDK exports', () => {
  const exported = new Map<string, Set<string>>();

  beforeAll(() => {
    const config = ts.parseJsonConfigFileContent(
      ts.readConfigFile(path.join(ROOT, 'tsconfig.json'), ts.sys.readFile).config,
      ts.sys,
      ROOT,
    );
    const program = ts.createProgram(
      SUBPATHS.map(([, file]) => file),
      config.options,
    );
    const checker = program.getTypeChecker();
    for (const [subpath, file] of SUBPATHS) {
      const source = program.getSourceFile(file);
      const symbol = source && checker.getSymbolAtLocation(source);
      exported.set(subpath, new Set(symbol ? checker.getExportsOfModule(symbol).map((s) => s.name) : []));
    }
  }, 120_000);

  it('reads every published subpath', () => {
    expect([...exported].filter(([, names]) => names.size === 0).map(([subpath]) => subpath)).toEqual([]);
  });

  it('are imported by the docs only as exported', () => {
    expect(imported.length).toBeGreaterThan(0);
    const wrong = imported
      .filter(({ from, name }) => !exported.get(from)?.has(name))
      .map(({ at, from, name }) =>
        exported.has(from) ? `${at}: ${from} exports no ${name}` : `${at}: no subpath ${from}`,
      );
    expect(wrong).toEqual([]);
  });

  it('are each in the SDK reference', () => {
    const reference = REFERENCE.filter((page) => fs.existsSync(path.join(DOCS, page)))
      .map((page) => fs.readFileSync(path.join(DOCS, page), 'utf8'))
      .join('\n');
    const missing = [...exported].flatMap(([subpath, names]) =>
      [...names].filter((name) => !new RegExp(`\\b${name}\\b`).test(reference)).map((name) => `${subpath}: ${name}`),
    );
    expect(missing).toEqual([]);
  });
});
