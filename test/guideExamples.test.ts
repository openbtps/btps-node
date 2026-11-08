/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * The examples in the feature guides and the What's new pages are what the SDK takes.
 *
 * Every JSON example names what it is in its code fence (```json btps=<kind>) and is
 * checked against that schema, so a guide cannot show an artifact a server refuses.
 * A JSON example that names nothing fails the test.
 *
 *   transporter, agent, response, bundle  the artifact or file itself
 *   permissions                           a trust record's `permissions`
 *   record                                a trust record
 *   document:<TYPE>                       an opened document of that artifact type, under 1.2.0
 *
 * A TypeScript example fenced ```ts check is typechecked against the SDK's source,
 * imported by its published subpaths (`@btps/sdk/server/core`, ...).
 */

import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import type { z } from 'zod';
import {
  BtpTransporterArtifactSchema,
  BtpTrustRecordPermissionsSchema,
} from '../src/core/server/schemas/artifacts/transporterSchema.js';
import { BtpAgentArtifactSchema } from '../src/core/server/schemas/artifacts/agentSchema.js';
import {
  BtpServerResponseSchema,
  BtpTrustRecordSchema,
} from '../src/core/server/schemas/responseSchema.js';
import { BtpEvidenceBundleSchema } from '../src/core/server/schemas/btpsDocsSchema.js';
import { processBtpDocSchema } from '../src/core/server/schemas/helpers.js';
import type { BTPArtifactType } from '../src/core/server/types.js';

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs/docusaurus/docs');
const DIRS = ['features', 'whats-new'];

const schemaFor = (kind: string): z.ZodTypeAny => {
  if (kind.startsWith('document:')) {
    const schema = processBtpDocSchema(kind.slice('document:'.length) as BTPArtifactType, '1.2.0');
    if (!schema) throw new Error(`no document schema for btps=${kind}`);
    return schema;
  }
  const schemas: Record<string, z.ZodTypeAny> = {
    transporter: BtpTransporterArtifactSchema,
    agent: BtpAgentArtifactSchema,
    response: BtpServerResponseSchema,
    bundle: BtpEvidenceBundleSchema,
    permissions: BtpTrustRecordPermissionsSchema,
    record: BtpTrustRecordSchema,
  };
  const schema = schemas[kind];
  if (!schema) throw new Error(`no schema for btps=${kind}`);
  return schema;
};

type Fence = { page: string; line: number; lang: string; meta: string; code: string };

const fences: Fence[] = DIRS.flatMap((dir) =>
  fs
    .readdirSync(path.join(DOCS, dir))
    .filter((file) => file.endsWith('.md') || file.endsWith('.mdx'))
    .map((file) => `${dir}/${file}`),
).flatMap((page) => {
  const text = fs.readFileSync(path.join(DOCS, page), 'utf8');
  const found: Fence[] = [];
  const fence = /^```(\w+)([^\n]*)\n([\s\S]*?)^```/gm;
  for (let match = fence.exec(text); match; match = fence.exec(text)) {
    const line = text.slice(0, match.index).split('\n').length;
    found.push({ page, line, lang: match[1] ?? '', meta: match[2] ?? '', code: match[3] ?? '' });
  }
  return found;
});

const examples = fences.filter((f) => f.lang === 'json');
const snippets = fences.filter((f) => f.lang === 'ts' && /\bcheck\b/.test(f.meta));

describe("the guides' JSON examples", () => {
  it('are there to check', () => {
    expect(examples.length).toBeGreaterThan(0);
  });

  it.each(examples.map((e) => [`${e.page}:${e.line}`, e] as const))(
    '%s is what the SDK takes',
    (_name, example) => {
      const kind = /btps=(\S+)/.exec(example.meta)?.[1];
      expect(kind, 'every JSON example names what it is: ```json btps=<kind>').toBeDefined();
      const result = schemaFor(kind!).safeParse(JSON.parse(example.code));
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    },
  );
});

describe("the guides' TypeScript examples", () => {
  // Each snippet is a module beside this test, importing the SDK by its published subpaths,
  // resolved to the source each subpath is built from.
  const files = new Map(
    snippets.map((s, i) => [path.join(ROOT, 'test', `__guide_snippet_${i}.ts`), s] as const),
  );
  let program: ts.Program;

  beforeAll(() => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
      exports: Record<string, { import: string }>;
    };
    const sdkPaths = Object.fromEntries(
      Object.entries(pkg.exports).map(([subpath, target]) => [
        `@btps/sdk${subpath.slice(1)}`,
        [target.import.replace('./dist/', '').replace(/\.js$/, '.ts')],
      ]),
    );
    const config = ts.parseJsonConfigFileContent(
      ts.readConfigFile(path.join(ROOT, 'tsconfig.json'), ts.sys.readFile).config,
      ts.sys,
      ROOT,
    );
    const options = { ...config.options, paths: { ...config.options.paths, ...sdkPaths } };
    const host = ts.createCompilerHost(options);
    const { getSourceFile, fileExists, readFile } = host;
    host.fileExists = (name) => files.has(name) || fileExists(name);
    host.readFile = (name) => files.get(name)?.code ?? readFile(name);
    host.getSourceFile = (name, language, ...rest) => {
      const snippet = files.get(name);
      return snippet
        ? ts.createSourceFile(name, snippet.code, language)
        : getSourceFile(name, language, ...rest);
    };
    program = ts.createProgram([...files.keys()], options, host);
  }, 120_000);

  it('are there to check', () => {
    expect(snippets.length).toBeGreaterThan(0);
  });

  it.each([...files].map(([file, s]) => [`${s.page}:${s.line}`, file] as const))(
    '%s typechecks against the SDK',
    (_name, file) => {
      const source = program.getSourceFile(file);
      expect(source).toBeDefined();
      const problems = [
        ...program.getSyntacticDiagnostics(source),
        ...program.getSemanticDiagnostics(source),
      ].map((d) => {
        const at =
          d.start === undefined ? undefined : source?.getLineAndCharacterOfPosition(d.start);
        const message = ts.flattenDiagnosticMessageText(d.messageText, '\n');
        return `line ${at ? at.line + 1 : '?'}: ${message}`;
      });
      expect(problems).toEqual([]);
    },
  );
});
