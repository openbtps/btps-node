// EBA-152: runtime smoke test for the @btps/sdk subpaths btps-nest-app uses.
//
// Why this is a plain Node ESM script and not a jest spec: the app's jest
// runs through ts-jest, which compiles specs to CommonJS, and @btps/sdk's
// exports map only has an "import" condition. A spec that imports
// '@btps/sdk/server' therefore fails to resolve under jest (observed
// 2026-10-08: TS2307 "Cannot find module '@btps/sdk/server'"), while the
// app itself is "type": "module", compiled by `nest build` with NodeNext,
// and runs as ESM. So the honest runtime check is the one Node does when
// the app starts: real ESM resolution through the real exports map.
//
// It does two things and reports every failure, not just the first:
//   1. For every @btps/sdk specifier the app's source imports (scanned, not
//      hand-listed, so a new subpath is covered without editing this file),
//      import it and check it has exports.
//   2. Import the compiled module (dist/) of every source file that imports
//      the SDK, plus root-level *.mjs files that do. That proves the app's
//      own build output loads the SDK, not just that the SDK loads, and it
//      is where a missing named export shows up: ESM linking refuses a
//      named import the SDK does not export. Names are not checked in
//      step 1 because the source imports types without the `type` keyword
//      (e.g. BTPTrustRecord), so source syntax cannot tell a type from a
//      value; the compiled output can, because tsc has elided the types.
//      Requires `yarn build` (nest build) to have run first.
//
// Run from examples/btps-nest-app:  yarn test:sdk-smoke
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SDK_RE = /^@btps\/sdk(\/.*)?$/;

// A static import or re-export (`import ... from '...'`, `export ... from
// '...'`, multi-line clauses included) or a side-effect import
// (`import '...'`). Group 1 is the `from` specifier, group 2 the bare one.
const STATIC_IMPORT_RE = /\b(?:import|export)\s[^;'"]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_RE = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules') return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

/** Source files whose @btps/sdk imports describe what the app uses at runtime. */
export function appSourceFiles(appRoot = APP_ROOT) {
  const src = walk(path.join(appRoot, 'src')).filter(
    (f) => /\.(ts|mts|js|mjs)$/.test(f) && !/\.(spec|test)\.[mc]?[jt]s$/.test(f) && !f.endsWith('.d.ts'),
  );
  const rootMjs = fs
    .readdirSync(appRoot)
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => path.join(appRoot, f));
  return [...src, ...rootMjs];
}

/**
 * Scans the app's source for @btps/sdk imports, type-only ones included (a
 * type-only subpath must still resolve for the build, and importing it at
 * runtime is harmless).
 * Returns { specifiers, files }, both sorted: the SDK specifiers, and the
 * source files that import the SDK at all.
 */
export function findSdkImports(appRoot = APP_ROOT) {
  const specifiers = new Set();
  const files = new Set();
  for (const file of appSourceFiles(appRoot)) {
    const text = fs.readFileSync(file, 'utf8');
    const found = [
      ...[...text.matchAll(STATIC_IMPORT_RE)].map((m) => m[1] ?? m[2]),
      ...[...text.matchAll(DYNAMIC_IMPORT_RE)].map((m) => m[1]),
    ].filter((spec) => SDK_RE.test(spec));
    if (found.length > 0) files.add(file);
    for (const spec of found) specifiers.add(spec);
  }
  return { specifiers: [...specifiers].sort(), files: [...files].sort() };
}

/** Maps a source file to the module `nest build` emits for it. */
export function compiledPathFor(file, appRoot = APP_ROOT) {
  const rel = path.relative(path.join(appRoot, 'src'), file);
  if (rel.startsWith('..')) return file; // root-level .mjs runs as-is
  return path.join(appRoot, 'dist', rel.replace(/\.(m?)ts$/, '.$1js'));
}

function describeError(err) {
  return [err?.code, err?.message ?? String(err)].filter(Boolean).join(' ');
}

/** Runs both steps; returns the list of failures (empty means pass). */
export async function runSmoke(appRoot = APP_ROOT, log = console.log) {
  const { specifiers, files } = findSdkImports(appRoot);
  const failures = [];

  if (specifiers.length === 0) {
    failures.push('found no @btps/sdk imports in the app source; the scanner or the app has changed');
  }

  for (const spec of specifiers) {
    let ns;
    try {
      ns = await import(spec);
    } catch (err) {
      failures.push(`${spec}: import failed: ${describeError(err)}`);
      continue;
    }
    if (Object.keys(ns).length === 0) {
      failures.push(`${spec}: imported, but has no exports`);
      continue;
    }
    const where = fileURLToPath(import.meta.resolve(spec));
    log(`ok   ${spec} -> ${path.relative(appRoot, where)}`);
  }

  for (const file of files) {
    const compiled = compiledPathFor(file, appRoot);
    const label = path.relative(appRoot, compiled);
    if (!fs.existsSync(compiled)) {
      failures.push(`${label}: not found; run \`yarn build\` before this smoke test`);
      continue;
    }
    try {
      await import(pathToFileURL(compiled).href);
      log(`ok   ${label} loads`);
    } catch (err) {
      failures.push(`${label}: import failed: ${describeError(err)}`);
    }
  }

  return failures;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const failures = await runSmoke();
  if (failures.length > 0) {
    for (const f of failures) console.error(`FAIL ${f}`);
    console.error(`@btps/sdk smoke: ${failures.length} failure(s)`);
    process.exit(1);
  }
  console.log('@btps/sdk smoke: all subpaths and compiled modules load');
}
