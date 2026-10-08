// EBA-150 is declared test-only, changing nothing on the wire: its file
// scope is packages/verify-btps-vectors/ (iOS and Android harness
// additions) plus this ticket's own tests, and its outcome is a harness
// that runs EBA-110's test/vectors/ unchanged. Both are guard rails a diff
// can drift past without anyone noticing — e.g. a driver that "just needs"
// one adapter tweak in src/core, or a vector edited to make a new platform
// pass more easily. This pins both down the same way EBA-156's
// tests/eba-156/ci-workflow.test.mjs pins CI shape: by reading the actual
// diff, not by trusting the PR description.
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './helpers.mjs';

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
}

function changedSinceMaster() {
  const base = git(['merge-base', 'origin/master', 'HEAD']).trim();
  const tracked = git(['diff', '--name-only', base]).split('\n').filter(Boolean);
  const untracked = git(['ls-files', '--others', '--exclude-standard'])
    .split('\n')
    .filter(Boolean);
  return [...new Set([...tracked, ...untracked])];
}

describe('EBA-150 touches only its declared scope', () => {
  it('every changed or added file is under packages/verify-btps-vectors/', () => {
    const changed = changedSinceMaster();
    expect(changed.length, 'expected at least this ticket\'s own new test files').toBeGreaterThan(
      0,
    );
    const outOfScope = changed.filter((f) => !f.startsWith('packages/verify-btps-vectors/'));
    expect(
      outOfScope,
      `out-of-scope changes (declared scope is packages/verify-btps-vectors/): ${outOfScope.join(', ')}`,
    ).toEqual([]);
  });

  it("EBA-110's test/vectors/ is unchanged", () => {
    const changed = changedSinceMaster();
    const vectorChanges = changed.filter((f) => f.startsWith('test/vectors/'));
    expect(
      vectorChanges,
      `test/vectors/ must run unchanged; changed: ${vectorChanges.join(', ')}`,
    ).toEqual([]);
  });
});
