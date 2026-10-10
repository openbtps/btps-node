// EBA-166: the btps-server Docker image (examples/btps-nest-app/Dockerfile,
// built via examples/btps-nest-app/docker-compose.yml) cannot build on a
// fresh clone. docker-compose.yml sets the build context to ".", and the
// Dockerfile does `COPY package.tgz ./package.tgz` — but package.tgz is
// *.tgz-gitignored (see .gitignore) and is not produced by any earlier step
// in that build stage, so a fresh `git clone` has no such file inside the
// build context. `docker build` fails at that COPY with "file not found"
// before it ever reaches @btps/sdk, which examples/btps-nest-app now
// resolves via `portal:../..` into the repository root (EBA-156) — a
// directory the "." build context cannot see at all.
//
// This check needs no Docker daemon: a COPY instruction that does not use
// `--from=<stage>` can only succeed if its source pre-exists in the build
// context on disk, and the only way a file is guaranteed to exist right
// after `git clone` is for it to be tracked by git. So every non---from=
// COPY source, resolved against the compose-declared build context, must be
// a path `git ls-files` actually tracks.
//
// This does not by itself prove @btps/sdk is reachable or importable inside
// the built image (that needs a real `docker build` + run, which
// docker-build.integration.test.mjs does, opt-in, since this sandbox has no
// docker binary) — only that nothing in the instruction list is doomed to
// fail before that. No YAML parser is a project dependency, so
// docker-compose.yml is read with a small indentation-based slicer, the same
// approach tests/eba-156/ci-workflow.test.mjs uses for workflow YAML.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NEST_APP = path.join(ROOT, 'examples/btps-nest-app');
const COMPOSE_FILE = path.join(NEST_APP, 'docker-compose.yml');
const DOCKERFILE = path.join(NEST_APP, 'Dockerfile');

// Finds the `build:` mapping for a given service and pulls out `context:`
// and `dockerfile:` (defaulting dockerfile to "Dockerfile" per Compose spec).
function readBuildConfig(composeText, serviceName) {
  const lines = composeText.split('\n');
  const serviceRe = new RegExp(`^  ${serviceName}:\\s*$`);
  const serviceStart = lines.findIndex((l) => serviceRe.test(l));
  expect(serviceStart, `expected a top-level service named "${serviceName}" in docker-compose.yml`).toBeGreaterThanOrEqual(0);

  // Next top-level (2-space indented) key ends this service's block.
  let serviceEnd = lines.length;
  for (let i = serviceStart + 1; i < lines.length; i++) {
    if (/^  \S/.test(lines[i])) {
      serviceEnd = i;
      break;
    }
  }
  const block = lines.slice(serviceStart, serviceEnd).join('\n');

  const contextMatch = block.match(/^\s*context:\s*['"]?([^\s'"]+)/m);
  const dockerfileMatch = block.match(/^\s*dockerfile:\s*['"]?([^\s'"]+)/m);

  expect(contextMatch, `expected a "context:" under the "${serviceName}" service's build: key`).toBeTruthy();

  return {
    context: contextMatch[1],
    dockerfile: dockerfileMatch ? dockerfileMatch[1] : 'Dockerfile',
  };
}

// Extracts { sources, isFromStage } for every COPY instruction in a Dockerfile.
function parseCopyInstructions(dockerfileText) {
  return dockerfileText
    .split('\n')
    .filter((l) => /^\s*COPY\s+/i.test(l))
    .map((line) => {
      const tokens = line.trim().split(/\s+/).slice(1); // drop the COPY keyword
      const isFromStage = tokens.some((t) => /^--from=/.test(t));
      const positional = tokens.filter((t) => !t.startsWith('--'));
      // Last positional token is the destination; everything else is a source.
      const sources = positional.slice(0, -1);
      return { line: line.trim(), isFromStage, sources };
    })
    .filter((c) => c.sources.length > 0);
}

function isTrackedByGit(absPath) {
  const rel = path.relative(ROOT, absPath);
  try {
    const out = execFileSync('git', ['ls-files', rel], { cwd: ROOT, encoding: 'utf8' });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

describe('examples/btps-nest-app Dockerfile: every COPY source must survive a fresh clone', () => {
  const composeText = fs.readFileSync(COMPOSE_FILE, 'utf8');
  const { context, dockerfile } = readBuildConfig(composeText, 'btps-server');
  const resolvedContext = path.resolve(NEST_APP, context);
  const resolvedDockerfile = path.resolve(resolvedContext, dockerfile);

  it('the compose-declared Dockerfile exists at the resolved build context', () => {
    expect(fs.existsSync(resolvedDockerfile), `expected ${resolvedDockerfile} to exist`).toBe(true);
  });

  it('no COPY instruction (other than --from=<stage>) copies a file the build context will not have on a fresh clone', () => {
    // Sanity-check this test still targets the real file this ticket is about.
    expect(resolvedDockerfile, 'expected docker-compose.yml to still point at examples/btps-nest-app/Dockerfile').toBe(
      DOCKERFILE,
    );

    const instructions = parseCopyInstructions(fs.readFileSync(resolvedDockerfile, 'utf8'));
    const fromContext = instructions.filter((c) => !c.isFromStage);
    expect(fromContext.length, 'expected at least one COPY instruction reading from the build context').toBeGreaterThan(
      0,
    );

    const untracked = [];
    for (const { line, sources } of fromContext) {
      for (const src of sources) {
        const abs = path.resolve(resolvedContext, src);
        if (!isTrackedByGit(abs)) {
          untracked.push(`${line}  (source "${src}" -> ${path.relative(ROOT, abs)}, not tracked by git)`);
        }
      }
    }

    expect(
      untracked,
      `the following COPY instructions reference files that will not exist in a fresh clone:\n${untracked.join('\n')}`,
    ).toEqual([]);
  });
});
