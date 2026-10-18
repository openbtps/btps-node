/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// The rules in AGENTS.md that a machine can check. Each list of exceptions
// below is what exists today; a new file is made to pass by moving or
// renaming it, not by adding to a list.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

const TOP_LEVEL = ['client', 'core', 'server', 'index.ts'];
const TOP_LEVEL_EXCEPTIONS: string[] = [];

const CORE_AREAS = [
  'authentication',
  'crypto',
  'delegation',
  'error',
  'server',
  'storage',
  'trust',
  'utils',
];

// Where a zod schema may be declared: what travels on the wire, and the
// client's own options and commands.
const SCHEMA_PLACES = ['core/server/schemas/', 'client/libs/schema.ts'];

// Exported names ending in "Schema" that are not `Btp…Schema`.
const SCHEMA_NAME_EXCEPTIONS = ['identitySchema', 'processBtpDocSchema'];

// Files that throw something other than BTPErrorException.
const PLAIN_THROW_EXCEPTIONS: string[] = [];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

const files = sourceFiles(SRC).map((path) => ({
  name: relative(SRC, path).split(sep).join('/'),
  text: readFileSync(path, 'utf8'),
}));

describe('repository conventions (AGENTS.md)', () => {
  it('keeps all source under core, client or server', () => {
    const found = readdirSync(SRC).filter((name) => !name.endsWith('.test.ts'));
    const unexpected = found.filter(
      (name) => !TOP_LEVEL.includes(name) && !TOP_LEVEL_EXCEPTIONS.includes(name),
    );
    expect(unexpected, 'new entries at the top of src/: move them under core, client or server').toEqual([]);
  });

  it('keeps core split into its known areas', () => {
    const unexpected = readdirSync(join(SRC, 'core')).filter((name) => !CORE_AREAS.includes(name));
    expect(unexpected, 'new entries in src/core/: use an existing area, or add the area here and to AGENTS.md').toEqual([]);
  });

  it('names every exported schema Btp…Schema, and keeps schemas where schemas go', () => {
    const misnamed: string[] = [];
    const misplaced: string[] = [];
    for (const { name, text } of files) {
      for (const [, exported] of text.matchAll(/^export const ([A-Za-z0-9_]*Schema)\b/gm)) {
        if (SCHEMA_NAME_EXCEPTIONS.includes(exported as string)) continue;
        if (!/^Btps?[A-Z]/.test(exported as string)) misnamed.push(`${name}: ${exported}`);
        if (!SCHEMA_PLACES.some((place) => name.startsWith(place))) misplaced.push(`${name}: ${exported}`);
      }
    }
    expect(misnamed, 'schemas not named Btp…Schema').toEqual([]);
    expect(misplaced, `schemas outside ${SCHEMA_PLACES.join(' and ')}`).toEqual([]);
  });

  it('throws BTPErrorException, never a plain Error', () => {
    const plain = files
      .filter(({ name }) => !PLAIN_THROW_EXCEPTIONS.includes(name))
      .flatMap(({ name, text }) =>
        [...text.matchAll(/throw new (Error|TypeError|RangeError)\(/g)].map(
          ([, kind]) => `${name}: throw new ${kind}`,
        ),
      );
    expect(plain, 'use BTPErrorException with a constant from core/error/constant.ts').toEqual([]);
  });

  it('keeps every error constant in core/error/constant.ts', () => {
    const elsewhere = files
      .filter(({ name }) => name !== 'core/error/constant.ts')
      .flatMap(({ name, text }) =>
        [...text.matchAll(/^export const (BTPS?_ERROR_[A-Z0-9_]+)\b/gm)].map(
          ([, constant]) => `${name}: ${constant}`,
        ),
      );
    expect(elsewhere, 'error constants declared outside core/error/constant.ts').toEqual([]);
  });

  it('has no exception listed that no longer exists', () => {
    const top = readdirSync(SRC);
    expect(TOP_LEVEL_EXCEPTIONS.filter((name) => !top.includes(name))).toEqual([]);
    const exportedSchemas = files.flatMap(({ text }) =>
      [...text.matchAll(/^export const ([A-Za-z0-9_]*Schema)\b/gm)].map(([, name]) => name),
    );
    expect(SCHEMA_NAME_EXCEPTIONS.filter((name) => !exportedSchemas.includes(name))).toEqual([]);
    const throwing = files
      .filter(({ text }) => /throw new (Error|TypeError|RangeError)\(/.test(text))
      .map(({ name }) => name);
    expect(PLAIN_THROW_EXCEPTIONS.filter((name) => !throwing.includes(name))).toEqual([]);
  });
});
