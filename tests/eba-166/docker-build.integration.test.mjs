// EBA-166: real end-to-end proof that the btps-server image builds from a
// fresh clone and can actually load @btps/sdk, not just that its Dockerfile
// looks plausible (dockerfile-copy-sources.test.mjs is the static version of
// that half of the check).
//
// "Fresh clone" is load-bearing: this checkout may have local artifacts
// (dist/, node_modules/, a hand-built package.tgz) lying around that a real
// fresh clone would not have and that could mask the bug. So this test
// exports the current commit with `git archive` into a clean temp directory
// and builds from there, the same way tests/eba-156/install-and-pack
// .integration.test.mjs avoids trusting the ambient checkout state.
//
// Opt-in only, same convention as that file: requires a Docker daemon (this
// sandbox has none — `docker` is not even on PATH here), is slow, and is not
// run by a plain `yarn test`. Run deliberately with:
//
//   BTPS_INTEGRATION=1 yarn vitest run tests/eba-166/docker-build.integration.test.mjs
//
// CI does not need this flag: once this ticket is implemented, a workflow
// step runs the equivalent `docker build`/`docker compose build` natively on
// a real fresh checkout (see ci-workflow.test.mjs), which is the actual
// acceptance signal; this file is a local reproduction tool.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LONG_TIMEOUT = 10 * 60 * 1000;

const INTEGRATION = process.env.BTPS_INTEGRATION === '1';
const hasDocker = (() => {
  if (!INTEGRATION) return false;
  const r = spawnSync('docker', ['version'], { encoding: 'utf8' });
  return r.status === 0;
})();

const integration = describe.skipIf(!INTEGRATION || !hasDocker);

if (INTEGRATION && !hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('BTPS_INTEGRATION=1 but no Docker daemon is reachable; skipping tests/eba-166/docker-build.integration.test.mjs');
}

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

let cloneDir;
let imageTag;

beforeAll(() => {
  if (!INTEGRATION || !hasDocker) return;
  cloneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'btps-docker-build-'));
  // `git archive` reproduces exactly what a fresh clone of HEAD would have on
  // disk: tracked files only, no local node_modules/dist/package.tgz.
  execFileSync('sh', ['-c', `git archive HEAD | tar -x -C "${cloneDir}"`], { cwd: ROOT });
}, LONG_TIMEOUT);

afterAll(() => {
  if (cloneDir) fs.rmSync(cloneDir, { recursive: true, force: true });
  if (imageTag) spawnSync('docker', ['image', 'rm', '-f', imageTag]);
});

integration('fresh-clone docker build (EBA-166 acceptance criteria 1-3)', () => {
  it(
    'builds the btps-server image from examples/btps-nest-app on a fresh clone',
    () => {
      imageTag = `btps-server-eba-166-test:${Date.now()}`;
      const nestAppDir = path.join(cloneDir, 'examples/btps-nest-app');

      const build = run('docker', ['compose', 'build', 'btps-server'], nestAppDir);
      expect(build.status, `docker compose build failed on a fresh clone:\n${build.out}`).toBe(0);

      // Resolve the image id docker-compose just tagged, independent of its
      // naming convention, so the next step runs the exact image that was built.
      const images = run('docker', ['compose', 'images', '-q', 'btps-server'], nestAppDir);
      expect(images.status, `docker compose images failed:\n${images.out}`).toBe(0);
      const imageId = images.out.trim().split('\n')[0];
      expect(imageId, 'expected docker compose to have tagged an image for the btps-server service').toBeTruthy();
      imageTag = imageId;
    },
    LONG_TIMEOUT,
  );

  it(
    'the built image can actually load @btps/sdk (not just complete the build)',
    () => {
      expect(imageTag, 'expected the previous build step to have produced an image').toBeTruthy();

      const importCheck = run('docker', [
        'run',
        '--rm',
        '--entrypoint',
        'node',
        imageTag,
        '-e',
        "import('@btps/sdk').then(() => { console.log('OK'); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); })",
      ]);

      expect(importCheck.status, `importing @btps/sdk inside the built image failed:\n${importCheck.out}`).toBe(0);
      expect(importCheck.out).toContain('OK');
    },
    LONG_TIMEOUT,
  );
});
