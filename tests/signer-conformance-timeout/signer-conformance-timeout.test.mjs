// test/signer-conformance.test.ts's tsc type-check test ("this file
// type-checks under tsc (so the expectTypeOf assertions above are actually
// enforced)") spawns a real `tsc` subprocess and took 5467 ms on one
// observed CI run, against vitest's default per-test timeout of 5000 ms.
// The test itself is correct; the timeout was too tight — so the fix (#11)
// is to raise the timeout (a per-test override, or vitest.config.ts's
// `testTimeout`), not to make tsc itself faster.
//
// This check reads source rather than spawning tsc itself, so it can't
// reintroduce the same kind of timing flake it exists to guard against.
//
// Same convention as tests/ci-pipeline, tests/example-app-packaging, tests/docker-image: static,
// regex-based source inspection, no new parser dependency.
//
// What this does NOT test, stated plainly:
//
// - That the tsc type-check completes in under 5000 ms on CI. This change
//   raises the timeout; it does not make tsc faster, and a wall-clock
//   assertion of < 5000 ms would itself be the timing flake this check
//   exists to remove. Measured locally on 2026-10-10 (10 cores): the tsc run
//   checks 368 files; a cold run took 6.74 s, warm runs ~3.1 s.
// - That there are no timeout failures over many consecutive CI runs: that
//   is an observation over CI history after merge, not a property of the code.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TEST_FILE = path.join(ROOT, 'test/signer-conformance.test.ts');
const VITEST_CONFIG = path.join(ROOT, 'vitest.config.ts');

// vitest's documented default per-test timeout, absent any override.
const VITEST_DEFAULT_TIMEOUT_MS = 5000;

// Observed worst-case run time for the tsc subprocess on CI. The
// fixed timeout must clear this with real margin, not by a handful of ms —
// CI runners vary, and a bare-minimum bump just moves the flake.
const OBSERVED_WORST_CASE_MS = 5467;
const SAFE_TIMEOUT_MS = 15000;

function readGlobalTestTimeout() {
  if (!fs.existsSync(VITEST_CONFIG)) return undefined;
  const source = fs.readFileSync(VITEST_CONFIG, 'utf8');
  const match = source.match(/testTimeout\s*:\s*(\d+)/);
  return match ? Number(match[1]) : undefined;
}

// Finds the `it(...)` block for the flaky tsc test and returns any
// explicit per-test timeout set on it, as either a trailing numeric third
// argument (`}, 15000);`) or a trailing options object
// (`}, { timeout: 15000 });`).
function readPerTestTimeout(source) {
  const titleMarker = 'this file type-checks under tsc';
  const titleIndex = source.indexOf(titleMarker);
  if (titleIndex === -1) {
    throw new Error(`expected to find the tsc type-check test ("${titleMarker}") in ${TEST_FILE}`);
  }

  // The matching `it(...)` block closes at the same 2-space indent the
  // `it(` line itself starts at; everything inside the test body sits at a
  // deeper indent, so this does not match early on a nested `}`.
  const closingRe = /\n {2}\}(,[^\n]*)?\);/g;
  closingRe.lastIndex = titleIndex;
  const closingMatch = closingRe.exec(source);
  if (!closingMatch) {
    throw new Error(`expected to find the closing "});" for the tsc type-check test in ${TEST_FILE}`);
  }

  const trailer = closingMatch[1] ?? '';
  const numericMatch = trailer.match(/,\s*(\d+)\s*$/);
  if (numericMatch) return Number(numericMatch[1]);

  const optionMatch = trailer.match(/timeout\s*:\s*(\d+)/);
  if (optionMatch) return Number(optionMatch[1]);

  return undefined;
}

describe('the signer-conformance tsc type-check test has a timeout with real headroom over its observed worst-case runtime', () => {
  const source = fs.readFileSync(TEST_FILE, 'utf8');
  const perTestTimeout = readPerTestTimeout(source);
  const globalTimeout = readGlobalTestTimeout();
  const effectiveTimeout = perTestTimeout ?? globalTimeout ?? VITEST_DEFAULT_TIMEOUT_MS;

  it("is not left on vitest's default 5000 ms timeout (the documented cause of the flake)", () => {
    expect(
      effectiveTimeout,
      `effective timeout for the tsc type-check test is ${effectiveTimeout} ms — still the unmodified ` +
        `vitest default that caused the ${OBSERVED_WORST_CASE_MS} ms run to fail`,
    ).toBeGreaterThan(VITEST_DEFAULT_TIMEOUT_MS);
  });

  it(`clears the observed ${OBSERVED_WORST_CASE_MS} ms worst-case run with real margin (>= ${SAFE_TIMEOUT_MS} ms)`, () => {
    expect(effectiveTimeout).toBeGreaterThanOrEqual(SAFE_TIMEOUT_MS);
  });
});
