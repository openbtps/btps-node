// EBA-156: real end-to-end checks that run actual `yarn`/`npm` processes.
//
// These are slower and, for the pack-smoke install step, network-dependent
// (installing the example app's real dependency tree touches the registry).
// They are kept here anyway because the acceptance criteria describe process
// exit codes, not file contents — a static check of package.json cannot see
// whether `yarn install --immutable` actually exits 0. This repo already
// accepts this kind of process-level test (see
// packages/verify-btps-vectors/test/cli.test.mjs), so it is written the same
// way: spawnSync against the real CLI.
//
// Root devDependencies (vitest, esbuild, tsc, ...) are assumed already
// installed, since this file cannot run under vitest at all otherwise.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NEST_APP = path.join(ROOT, 'examples/btps-nest-app');

const LONG_TIMEOUT = 10 * 60 * 1000;

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('fresh-clone install (EBA-156 acceptance criterion 2)', () => {
  it(
    'root `yarn build`, then `yarn install --immutable` in examples/btps-nest-app, exits 0',
    () => {
      const build = run('yarn', ['build'], ROOT);
      expect(build.status, `yarn build failed:\n${build.out}`).toBe(0);
      expect(
        fs.existsSync(path.join(ROOT, 'dist/index.js')),
        'root yarn build did not produce dist/index.js',
      ).toBe(true);

      const install = run('yarn', ['install', '--immutable'], NEST_APP);
      expect(install.status, `yarn install --immutable failed:\n${install.out}`).toBe(0);
    },
    LONG_TIMEOUT,
  );
});

describe('pack smoke (EBA-156 acceptance criterion 4)', () => {
  it(
    'yarn pack at the root produces a tarball that installs (without --immutable) and imports as @btps/sdk',
    () => {
      const build = run('yarn', ['build'], ROOT);
      expect(build.status, `yarn build failed:\n${build.out}`).toBe(0);

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'btps-pack-smoke-'));
      const tarballPath = path.join(tmpDir, 'btps-sdk.tgz');

      const pack = run('yarn', ['pack', '-o', tarballPath], ROOT);
      expect(pack.status, `yarn pack failed:\n${pack.out}`).toBe(0);
      expect(fs.existsSync(tarballPath), 'yarn pack did not produce a tarball at the requested path').toBe(true);

      const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'btps-pack-install-'));
      fs.writeFileSync(
        path.join(installDir, 'package.json'),
        JSON.stringify({ name: 'btps-pack-smoke', version: '0.0.0', private: true }),
      );

      // Deliberately not --immutable: this job proves the published artifact
      // installs on its own, independent of this repo's own lockfile.
      const install = run('npm', ['install', tarballPath], installDir);
      expect(install.status, `npm install of the packed tarball failed:\n${install.out}`).toBe(0);

      const importCheck = run(
        'node',
        ['-e', "import('@btps/sdk').then(() => console.log('OK')).catch((e) => { console.error(e); process.exit(1); })"],
        installDir,
      );
      expect(importCheck.status, `import of @btps/sdk from the packed tarball failed:\n${importCheck.out}`).toBe(0);
      expect(importCheck.out).toContain('OK');
    },
    LONG_TIMEOUT,
  );
});
