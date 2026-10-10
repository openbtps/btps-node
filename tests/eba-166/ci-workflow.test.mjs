// EBA-166 acceptance criterion: "CI builds the image". Today
// .github/workflows/ci.yml never invokes `docker build` or
// `docker compose build` anywhere — the btps-server image (built from
// examples/btps-nest-app/Dockerfile) is never exercised in CI, so the
// breakage this ticket fixes (build context "." cannot reach the
// portal:../..-linked @btps/sdk at the repository root) would keep
// regressing silently.
//
// Same approach as tests/eba-156/ci-workflow.test.mjs and
// tests/eba-152/ci-pipeline.test.mjs: no YAML parser is a project
// dependency, so jobs/steps are isolated with small indentation-based
// splitters rather than adding one just for this test.
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

function allRunLines() {
  return allJobs().flatMap((j) => j.body.split('\n').filter((l) => /^\s*run:/.test(l) || /^\s{2,}/.test(l)));
}

describe('CI: the btps-server Docker image (examples/btps-nest-app) is built', () => {
  // EBA-166 acceptance criterion "CI builds the image" (the docker-image job
  // in .github/workflows/ci.yml). Without that step, the breakage this ticket
  // fixes (build context "." could not reach the portal:../..-linked
  // @btps/sdk at the repository root) would never be exercised by CI and
  // could come back without anyone noticing. This checks the workflow's
  // shape only. The evidence that the image builds is that job going green.
  it('a workflow step runs `docker build` or `docker compose build` against examples/btps-nest-app', () => {
    const lines = allRunLines();
    expect(lines.length, 'expected at least one line inside a job body').toBeGreaterThan(0);

    const dockerBuildRe = /\bdocker\s+(build|compose\s+(-f\s+\S+\s+)?build)\b/;
    const buildLines = lines.filter((l) => dockerBuildRe.test(l));

    expect(
      buildLines.length,
      'expected a `run:` step invoking `docker build` or `docker compose build`',
    ).toBeGreaterThan(0);

    const scoped = buildLines.some((l) => /btps-nest-app/.test(l));
    const job = allJobs().find((j) => dockerBuildRe.test(j.body));
    const scopedByWorkingDirectory =
      job && /working-directory:\s*['"]?examples\/btps-nest-app\b/.test(job.body);

    expect(
      scoped || scopedByWorkingDirectory,
      'expected the docker build step (or its job) to be scoped to examples/btps-nest-app, ' +
        'either via a path/file argument or a working-directory',
    ).toBe(true);
  });
});
