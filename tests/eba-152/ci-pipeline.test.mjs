// EBA-152: the pipeline EBA-156 added builds the root package, then
// installs/tests examples/btps-nest-app and pack-smokes the published
// tarball — but it never runs the root package's own `yarn test`
// (vitest run) or `yarn verify:btps-vectors`, and it never builds
// examples/btps-nest-app itself (only the root SDK it depends on).
// .github/workflows/ci.yml says as much:
//   "The full root `yarn test` and verify:btps-vectors belong to EBA-152,
//    which builds on this file; the scoped tests/eba-156 step is not a
//    substitute for it."
//
// These checks read the workflow file the same way
// tests/eba-156/ci-workflow.test.mjs does: no YAML parser is a project
// dependency, so jobs and steps are isolated with small indentation-based
// splitters instead of adding one just for this test.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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

// Splits a job body's `steps:` list into one string per step, using the
// indentation of the first `- ` list item found as "the" step indent (steps
// are a flat list; anything nested under a step, e.g. `with:` entries, sits
// at a deeper indent and is ignored here).
function parseSteps(jobBody) {
  const lines = jobBody.split('\n');
  const stepStartRe = /^(\s*)- /;
  const starts = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(stepStartRe);
    if (m) starts.push({ indent: m[1].length, line: i });
  }
  if (starts.length === 0) return [];

  const stepIndent = starts[0].indent;
  const stepStarts = starts.filter((s) => s.indent === stepIndent);
  return stepStarts.map((s, idx) => {
    const end = idx + 1 < stepStarts.length ? stepStarts[idx + 1].line : lines.length;
    return lines.slice(s.line, end).join('\n');
  });
}

function allSteps() {
  return allJobs().flatMap((j) => parseSteps(j.body).map((body) => ({ job: j.name, body })));
}

function stepWorkingDirectory(stepBody) {
  const m = stepBody.match(/working-directory:\s*['"]?([^\s'"]+)/);
  return m ? m[1] : null;
}

describe('CI: the root test suite (`yarn test`) runs on every PR', () => {
  // The scoped `yarn vitest run tests/eba-156` step (added by EBA-156) only
  // runs this ticket's directory, not the project's full vitest suite
  // (src/**/*.test.ts, test/vectors, etc). That scoped step is not a
  // substitute for the root `yarn test` script.
  it('a workflow step runs `yarn test` at the repository root, not scoped to examples/btps-nest-app', () => {
    const steps = allSteps();
    expect(steps.length, 'expected at least one step to be parseable from the workflow(s)').toBeGreaterThan(0);

    const rootTestStep = steps.find((s) => {
      if (!/\byarn\s+test\b(?!:)/.test(s.body)) return false;
      const wd = stepWorkingDirectory(s.body);
      return !wd || !/^examples\/btps-nest-app\b/.test(wd);
    });

    expect(
      rootTestStep,
      'expected a `run:` step executing `yarn test` with no working-directory (or a working-directory other than examples/btps-nest-app)',
    ).toBeTruthy();
  });
});

describe('CI: `yarn verify:btps-vectors` runs on every PR', () => {
  it('a workflow step runs `yarn verify:btps-vectors`', () => {
    const steps = allSteps();
    const found = steps.some((s) => /\byarn\s+verify:btps-vectors\b/.test(s.body));
    expect(found, 'expected a `run:` step executing `yarn verify:btps-vectors`').toBe(true);
  });
});

describe('CI: checks report under the names EBA-133 will require', () => {
  // A required-status-check rule matches the check name exactly; EBA-133 and
  // the EBA-107 check catalogue (page 8978471) name them ci/test and
  // ci/vectors. Renaming a job silently orphans the rule.
  const jobNamed = (name) => allJobs().find((j) => new RegExp(`^    name:\\s*${name}\\s*$`, 'm').test(j.body));

  it('a job named ci/test runs root `yarn test`', () => {
    const job = jobNamed('ci/test');
    expect(job, 'expected a job with `name: ci/test`').toBeTruthy();
    const rootTest = parseSteps(job.body).some((s) => /run:\s*yarn test\s*$/m.test(s) && !stepWorkingDirectory(s));
    expect(rootTest, 'expected ci/test to run `yarn test` at the repository root').toBe(true);
  });

  it('ci/test installs the example before `yarn test` (root vitest collects its specs)', () => {
    const steps = parseSteps(jobNamed('ci/test').body);
    const installIdx = steps.findIndex(
      (s) => stepWorkingDirectory(s) === 'examples/btps-nest-app' && /yarn install --immutable/.test(s),
    );
    const testIdx = steps.findIndex((s) => /run:\s*yarn test\s*$/m.test(s) && !stepWorkingDirectory(s));
    expect(installIdx).toBeGreaterThanOrEqual(0);
    expect(testIdx).toBeGreaterThan(installIdx);
  });

  it('a job named ci/vectors runs `yarn verify:btps-vectors`, whose script carries --known-failing', () => {
    const job = jobNamed('ci/vectors');
    expect(job, 'expected a job with `name: ci/vectors`').toBeTruthy();
    expect(job.body).toMatch(/run:\s*yarn verify:btps-vectors\s*$/m);
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts['verify:btps-vectors']).toMatch(/--known-failing test\/vectors\/known-failing\.json/);
  });

  it('the workflow stays read-only and runs on pull_request and pushes to master', () => {
    const text = fs.readFileSync(path.join(WORKFLOWS_DIR, 'ci.yml'), 'utf8');
    expect(text).toMatch(/^permissions:\s*\n\s+contents:\s*read\s*$/m);
    expect(text).toMatch(/^on:\s*\n\s+pull_request:\s*\n\s+push:\s*\n\s+branches:\s*\[master\]/m);
    expect(text).not.toMatch(/\$\{\{\s*secrets\./);
  });
});

describe('CI: examples/btps-nest-app itself is built, not just the SDK it depends on', () => {
  // The existing "Build @btps/sdk" step builds the root package (main
  // points at dist) so the example can install/test against it, but
  // nothing in the workflow runs `nest build` (the example's own `yarn
  // build` script) for examples/btps-nest-app.
  it('a step with working-directory examples/btps-nest-app runs `yarn build`', () => {
    const steps = allSteps();
    const exampleBuildStep = steps.find((s) => {
      const wd = stepWorkingDirectory(s.body);
      if (!wd || !/^examples\/btps-nest-app\b/.test(wd)) return false;
      return /\byarn\s+build\b(?!:)/.test(s.body);
    });

    expect(
      exampleBuildStep,
      'expected a step with working-directory examples/btps-nest-app that runs `yarn build`',
    ).toBeTruthy();
  });
});
