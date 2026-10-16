// EBA-152 criterion: "a smoke test in btps-nest-app imports each @btps/sdk
// subpath it uses, and it runs in this pipeline."
//
// The smoke test is examples/btps-nest-app/smoke/sdk-subpaths.mjs, run by
// `yarn test:sdk-smoke`. It is a plain Node ESM script rather than a jest
// spec because the app's jest goes through ts-jest, which compiles to
// CommonJS, and @btps/sdk's exports map has only an "import" condition — a
// spec importing '@btps/sdk/server' fails to resolve under jest (observed
// 2026-10-08, TS2307), so it could not prove runtime loading.
//
// These checks guard three things without needing node_modules or a build:
//   1. the script's scanner finds every @btps/sdk specifier in the app's
//      source, cross-checked against an independent, deliberately simpler
//      scan here (so a scanner regression cannot silently shrink coverage);
//   2. the app wires it as `test:sdk-smoke`;
//   3. CI runs it in examples/btps-nest-app after `yarn build` there (it
//      imports the compiled dist/ modules, so order matters).
// The script itself passing is proven by the CI step, not here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { appSourceFiles, compiledPathFor, findSdkImports } from '../../examples/btps-nest-app/smoke/sdk-subpaths.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NEST_APP = path.join(ROOT, 'examples/btps-nest-app');
const CI = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');

// Independent scan: every quoted '@btps/sdk' or '@btps/sdk/...' string in
// non-spec app source. Cruder than the script's import-statement regex, on
// purpose — it over-matches rather than under-matches.
function crudeSdkSpecifiers() {
  const found = new Set();
  for (const file of appSourceFiles(NEST_APP)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/['"](@btps\/sdk(?:\/[^'"]*)?)['"]/g)) found.add(m[1]);
  }
  return [...found].sort();
}

function exampleSteps() {
  // Steps of the job that works in examples/btps-nest-app, in order.
  const job = CI.split(/\n  (?=[A-Za-z0-9_-]+:\n)/).find((j) => j.startsWith('example-app:'));
  expect(job, 'expected an example-app job in ci.yml').toBeTruthy();
  return job.split(/\n      - /).slice(1);
}

describe('examples/btps-nest-app smoke test covers every @btps/sdk subpath the app uses', () => {
  it('the scanner finds the same specifiers as an independent scan', () => {
    const { specifiers } = findSdkImports(NEST_APP);
    expect(specifiers.length).toBeGreaterThan(0);
    expect(specifiers).toEqual(crudeSdkSpecifiers());
  });

  it('covers the subpaths the app used when this was written (a floor, not the definition)', () => {
    const { specifiers } = findSdkImports(NEST_APP);
    for (const s of [
      '@btps/sdk/authentication',
      '@btps/sdk/error',
      '@btps/sdk/server',
      '@btps/sdk/server/core',
      '@btps/sdk/storage',
      '@btps/sdk/trust',
    ]) {
      expect(specifiers).toContain(s);
    }
  });

  it('handles multi-line, type-only, re-export, side-effect and dynamic imports', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eba-152-app-'));
    try {
      fs.mkdirSync(path.join(tmp, 'src/nested'), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, 'src/nested/a.ts'),
        "import {\n  A,\n  B,\n} from '@btps/sdk/one';\nimport type { T } from '@btps/sdk/two';\nexport { C } from '@btps/sdk/three';\nimport '@btps/sdk/four';\nconst m = await import('@btps/sdk/five');\nimport x from 'not-the-sdk';\n",
      );
      fs.writeFileSync(path.join(tmp, 'src/a.spec.ts'), "import { S } from '@btps/sdk/spec-only';\n");
      fs.writeFileSync(path.join(tmp, 'root.mjs'), "import { R } from '@btps/sdk';\n");
      const { specifiers, files } = findSdkImports(tmp);
      expect(specifiers).toEqual([
        '@btps/sdk',
        '@btps/sdk/five',
        '@btps/sdk/four',
        '@btps/sdk/one',
        '@btps/sdk/three',
        '@btps/sdk/two',
      ]);
      expect(files.map((f) => path.relative(tmp, f))).toEqual(['root.mjs', 'src/nested/a.ts']);
      expect(path.relative(tmp, compiledPathFor(path.join(tmp, 'src/nested/a.ts'), tmp))).toBe('dist/nested/a.js');
      expect(compiledPathFor(path.join(tmp, 'root.mjs'), tmp)).toBe(path.join(tmp, 'root.mjs'));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('the smoke test runs in this pipeline', () => {
  it('btps-nest-app declares test:sdk-smoke as running the smoke script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(NEST_APP, 'package.json'), 'utf8'));
    expect(pkg.scripts['test:sdk-smoke']).toBe('node smoke/sdk-subpaths.mjs');
  });

  it('ci.yml runs `yarn test:sdk-smoke` in examples/btps-nest-app, after `yarn build` there', () => {
    const steps = exampleSteps();
    const inApp = (s) => /working-directory:\s*examples\/btps-nest-app\b/.test(s);
    const buildIdx = steps.findIndex((s) => inApp(s) && /run:\s*yarn build\s*$/m.test(s));
    const smokeIdx = steps.findIndex((s) => inApp(s) && /run:\s*yarn test:sdk-smoke\s*$/m.test(s));
    expect(buildIdx, 'expected `yarn build` in examples/btps-nest-app').toBeGreaterThanOrEqual(0);
    expect(smokeIdx, 'expected `yarn test:sdk-smoke` in examples/btps-nest-app').toBeGreaterThan(buildIdx);
  });
});
