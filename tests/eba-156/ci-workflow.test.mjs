// EBA-156: CI must build the root package before installing/testing
// examples/btps-nest-app (main points at dist), and must run a separate
// "pack smoke" job that `yarn pack`s the root, installs the resulting
// tarball in a temp directory without --immutable, and imports @btps/sdk.
//
// Expected failures (`it.fails`) until .github/workflows/ci.yml exists. There
// is no such directory in this repository today, so every check here fails
// now for the simplest possible reason: the file these checks read does not
// exist yet. .github/workflows/** is a protected path that an agent run may
// not write, so the file is written up for a human to apply:
// https://ebilladdress.atlassian.net/wiki/spaces/ES/pages/8749306/EBA-156+proposed+.github+workflows+ci.yml+for+a+human+to+apply+and+root-build+blocker Whoever adds it must flip `it.fails` to `it` in the same change,
// or every test here turns red. Same ratchet as src/core/crypto/jcs.test.ts
// and test/vectors/known-failing.json.
//
// No YAML parser is a project dependency, so job bodies are isolated with a
// small indentation-based splitter rather than adding one just for this test.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const XFAIL = 'expected failure until a human applies .github/workflows/ci.yml (protected path)';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WORKFLOWS_DIR = path.join(ROOT, '.github/workflows');

function listWorkflowFiles() {
  if (!fs.existsSync(WORKFLOWS_DIR)) return [];
  return fs
    .readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => path.join(WORKFLOWS_DIR, f));
}

// Splits a workflow file's `jobs:` section into { name, body } entries by
// locating top-level (2-space indented) job keys and slicing the text
// between one job key and the next.
function parseJobs(yamlText) {
  const lines = yamlText.split('\n');
  const jobsStart = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (jobsStart === -1) return [];

  const jobHeaderRe = /^  ([A-Za-z0-9_-]+):\s*$/;
  const headers = [];
  for (let i = jobsStart + 1; i < lines.length; i++) {
    const m = lines[i].match(jobHeaderRe);
    if (m) headers.push({ name: m[1], line: i });
  }

  return headers.map((h, idx) => {
    const end = idx + 1 < headers.length ? headers[idx + 1].line : lines.length;
    return { name: h.name, body: lines.slice(h.line, end).join('\n') };
  });
}

function allJobs() {
  return listWorkflowFiles().flatMap((file) => {
    const text = fs.readFileSync(file, 'utf8');
    return parseJobs(text).map((j) => ({ ...j, file }));
  });
}

describe('CI: root build runs before the example app is installed/tested', () => {
  it.fails(`a GitHub Actions workflow exists (${XFAIL})`, () => {
    expect(
      listWorkflowFiles().length,
      'expected at least one file under .github/workflows',
    ).toBeGreaterThan(0);
  });

  it.fails(`the job that installs/tests examples/btps-nest-app runs root \`yarn build\` first (${XFAIL})`, () => {
    const jobs = allJobs();
    expect(jobs.length, 'expected at least one job to be parseable from the workflow(s)').toBeGreaterThan(0);

    const exampleDirRe = /working-directory:\s*['"]?examples\/btps-nest-app\b/;
    const exampleJob = jobs.find((j) => exampleDirRe.test(j.body));
    expect(exampleJob, 'expected a job with a step whose working-directory is examples/btps-nest-app').toBeTruthy();

    // The example's own install and tests must both run, --immutable.
    const exampleSteps = exampleJob.body.slice(exampleJob.body.search(exampleDirRe));
    expect(exampleSteps).toMatch(/\byarn install --immutable\b/);
    expect(exampleSteps).toMatch(/\byarn test\b/);

    const needsMatch = exampleJob.body.match(/^\s*needs:\s*\[?\s*([A-Za-z0-9_-]+)/m);

    if (needsMatch) {
      // Build happens in a prerequisite job — assert that job builds the root package.
      const buildJob = jobs.find((j) => j.name === needsMatch[1]);
      expect(buildJob, `expected a job named "${needsMatch[1]}" referenced by needs:`).toBeTruthy();
      expect(buildJob.body).toMatch(/\byarn build\b/);
    } else {
      // Build and example install/test share one job — assert the root build
      // comes before the first step that runs in the example's directory. (The
      // root's own `yarn install --immutable` legitimately precedes the build,
      // so position is measured against the example's working-directory.)
      const buildIndex = exampleJob.body.search(/\byarn build\b/);
      const exampleDirIndex = exampleJob.body.search(exampleDirRe);

      expect(buildIndex, 'expected `yarn build` to run somewhere in the job').toBeGreaterThanOrEqual(0);
      expect(buildIndex).toBeLessThan(exampleDirIndex);
    }
  });
});

describe('CI: a separate pack-smoke job validates the published tarball', () => {
  it.fails(`a job runs \`yarn pack\` at the root, installs the tarball without --immutable, and imports @btps/sdk (${XFAIL})`, () => {
    const jobs = allJobs();
    const packJob = jobs.find((j) => /\byarn pack\b/.test(j.body));

    expect(packJob, 'expected a job that runs `yarn pack`').toBeTruthy();

    // Must install the resulting tarball, and must not pass --immutable while doing so
    // (an --immutable install is exactly the workspace-resolution problem this ticket fixes;
    // the pack-smoke job exists to prove the *published artifact* installs on its own).
    // Only the *tarball* install is checked: the job's root install, which
    // builds the artifact, should be --immutable and is not constrained here.
    expect(packJob.body).toMatch(/\.tgz/);
    const tarballInstallLines = packJob.body
      .split('\n')
      .filter((l) => /\b(npm|yarn)\s+(install|add)\b/.test(l) && /\.tgz\b/.test(l));
    expect(tarballInstallLines.length, 'expected a step installing the packed tarball').toBeGreaterThan(0);
    expect(tarballInstallLines.some((l) => /--immutable/.test(l))).toBe(false);

    // Must actually import @btps/sdk, not just install it.
    expect(packJob.body).toMatch(/@btps\/sdk/);
    expect(packJob.body).toMatch(/\brequire\(|\bimport\(|\bimport\s+.*from\b/);

    // Must be distinct from the job that builds/tests the example app.
    const exampleJob = jobs.find((j) => /btps-nest-app/.test(j.body));
    if (exampleJob) expect(packJob.name).not.toBe(exampleJob.name);
  });
});
