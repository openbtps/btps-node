// EBA-150 is declared test-only, changing nothing on the wire: its file
// scope is packages/verify-btps-vectors/ plus this ticket's own tests (the
// ticket was re-scoped to Hermes-in-container only on 2026-10-08; the
// iOS/Android/KMS/device-keystore work this comment used to describe is
// EBA-168's, not this ticket's), and its outcome is a harness that runs
// EBA-110's test/vectors/ unchanged. Both are guard rails a diff
// can drift past without anyone noticing — e.g. a driver that "just needs"
// one adapter tweak in src/core, or a vector edited to make a new platform
// pass more easily. This pins both down the same way EBA-156's
// tests/eba-156/ci-workflow.test.mjs pins CI shape: by reading the actual
// diff, not by trusting the PR description.
//
// This is a PR-time check, not a standing invariant: it needs a base to
// diff this branch against. Round 1 of EBA-150's review
// (https://ebilladdress.atlassian.net/browse/EBA-150) found it broke
// master once merged — after a squash merge HEAD *is* master,
// merge-base(origin/master, HEAD) is HEAD itself, the changed-file list is
// legitimately empty, and the old toBeGreaterThan(0) assertion failed
// every time. It also throws outright in a shallow clone or any checkout
// that never fetched origin/master. Both cases mean "nothing to compare
// against", not "scope violated", so this skips rather than failing or
// throwing when either is true.
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './helpers.mjs';

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
}

function tryMergeBase() {
  try {
    return git(['merge-base', 'origin/master', 'HEAD']).trim();
  } catch {
    return null; // no origin/master reachable: shallow clone, or a checkout that never fetched it
  }
}

function changedSince(base) {
  const tracked = git(['diff', '--name-only', base]).split('\n').filter(Boolean);
  const untracked = git(['ls-files', '--others', '--exclude-standard'])
    .split('\n')
    .filter(Boolean);
  return [...new Set([...tracked, ...untracked])];
}

const base = tryMergeBase();
const changed = base ? changedSince(base) : [];
// Nothing to compare against: no base ref, or HEAD already matches it
// (post-merge on master). Either way there is no diff for this check to
// read, so it has nothing to say.
const hasComparison = base !== null && changed.length > 0;

describe.skipIf(!hasComparison)('EBA-150 touches only its declared scope', () => {
  it('every changed or added file is under packages/verify-btps-vectors/', () => {
    const outOfScope = changed.filter((f) => !f.startsWith('packages/verify-btps-vectors/'));
    expect(
      outOfScope,
      `out-of-scope changes (declared scope is packages/verify-btps-vectors/): ${outOfScope.join(', ')}`,
    ).toEqual([]);
  });

  it("EBA-110's test/vectors/ is unchanged", () => {
    const vectorChanges = changed.filter((f) => f.startsWith('test/vectors/'));
    expect(
      vectorChanges,
      `test/vectors/ must run unchanged; changed: ${vectorChanges.join(', ')}`,
    ).toEqual([]);
  });
});
