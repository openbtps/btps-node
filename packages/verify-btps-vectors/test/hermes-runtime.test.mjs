// EBA-150 (Hermes stage). Outcome wanted: the shared signing core
// (src/jcs.mjs, and the BTPS 1.1 crypto profile) runs for real inside
// Hermes — the engine the ebill-sass React Native app ships with — not a
// Node or WebCrypto stand-in wearing Hermes's name. That exact
// stand-in-wearing-a-platform's-name failure is this ticket's own history:
// ios.mjs/android.mjs re-export the WebCrypto driver and are deliberately
// NOT wired into buildChecks() because of it (see mobile-runtimes.test.mjs
// and the package README's Limitations section). Hermes is different from
// that scaffold in one load-bearing way: a real `hermes` binary can
// actually execute JS, so — unlike ios/android — wiring it into
// buildChecks() here is a true claim, not a repeat of that mistake,
// PROVIDED it really executes there. The "actually executes inside Hermes"
// test below (not a Node stand-in) is this file's answer to that bar.
//
// None of src/runtimes/hermes.mjs exists yet, so every test in this file
// fails at import. That is correct for a ticket with no implementation.
//
// Assumed contract (src/runtimes/hermes.mjs), chosen to be the smallest
// surface that lets this file prove the acceptance criteria rather than
// trust a description of them:
//   locateHermes(options?) -> Promise<LocateResult>            (see hermes-locate.test.mjs)
//   runInHermes(location, source: string) -> Promise<{ stdout, stderr, code }>
//     spawns the located Hermes binary on `source` and returns what it
//     printed. `source` is a plain script (no import/export, no bundler) —
//     the same constraint jcs.mjs's "no Node built-in" portability rule
//     already keeps it under, so stripping `export` is enough to run it
//     as-is. `print(...)` is Hermes's own CLI print builtin.
//   createHermesRuntime(location) -> RuntimeDriver (src/runtimes/types.mjs),
//     name: 'hermes', backed by the real engine runInHermes spawns.
// And one assumed, additive, backward-compatible extension of the existing
// buildChecks() (src/runner.mjs) signature:
//   buildChecks({ vectorsDir, sdkRoot, hermes? })
//     when `hermes?.available`, createHermesRuntime(hermes) joins the
//     `runtimes` array alongside node and web, so vectorChecks/interopChecks
//     — already generic over the runtime list — produce vectors/hermes/*
//     and interop/hermes<->{node,web}/* without new vectors, exactly as the
//     README's "Adding a runtime" section describes. Omitting `hermes`
//     must keep today's behaviour (every existing runner.test.mjs call is
//     unchanged by this).
//
// What this file does not (and cannot, from this sandbox) check: that the
// pinned "expectedVersion" actually equals the ebill-sass app's real
// shipping Hermes version. That app's repository is not checked out here,
// so there is no independent source of truth this harness can read to
// verify the pin is current — only that the pinning *mechanism* reports a
// reason when it fails (hermes-locate.test.mjs). Keeping the pin in sync
// with the app is this ticket's responsibility to establish, not something
// a test in this repository can confirm on its own.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createHermesRuntime, locateHermes, runInHermes } from '../src/runtimes/hermes.mjs';
import { buildChecks, runChecks } from '../src/runner.mjs';
import { loadVectorSet } from '../src/vectors.mjs';
import { canonicalize } from '../src/jcs.mjs';
import { PACKAGE_DIR, VECTORS_DIR } from './helpers.mjs';

const location = await locateHermes();
const set = loadVectorSet(VECTORS_DIR);

function stripExports(source) {
  return source.replace(/^export\s+(class|function)\s/gm, '$1 ');
}

async function canonicalizeInHermes(jsonText) {
  const jcsSource = stripExports(fs.readFileSync(path.join(PACKAGE_DIR, 'src/jcs.mjs'), 'utf8'));
  const script = `${jcsSource}\ntry {\n  print(canonicalize(${JSON.stringify(jsonText)}));\n} catch (e) {\n  print('ERROR: ' + e.message);\n}\n`;
  const { stdout } = await runInHermes(location, script);
  return stdout.trim();
}

describe.skipIf(location.available)(
  'when Hermes is not available: the harness stops and reports why, and does not pretend',
  () => {
    it('locateHermes reported a reason', () => {
      expect(typeof location.reason).toBe('string');
      expect(location.reason.length).toBeGreaterThan(0);
    });

    it('buildChecks does not register any check naming hermes', async () => {
      const checks = await buildChecks({ vectorsDir: VECTORS_DIR, sdkRoot: null, hermes: location });
      const named = checks.map((c) => c.id).filter((id) => id.includes('hermes'));
      expect(named, 'a check id naming hermes is a claim that something ran there').toEqual([]);
    });
  },
);

describe.skipIf(!location.available)('when Hermes is available', () => {
  it('runInHermes really executes inside Hermes, not a Node stand-in', async () => {
    // HermesInternal is a Hermes-only global; it does not exist in plain
    // Node and is the same signal the mobile-runtimes.test.mjs regression
    // guard is standing in for on this engine.
    const { stdout } = await runInHermes(location, "print(typeof HermesInternal);");
    expect(stdout.trim()).toBe('object');
  });

  it('createHermesRuntime conforms to the RuntimeDriver contract (src/runtimes/types.mjs)', () => {
    const runtime = createHermesRuntime(location);
    expect(runtime.name).toBe('hermes');
    for (const method of [
      'signPkcs1Sha256',
      'verifyPkcs1Sha256',
      'oaepWrap',
      'oaepUnwrap',
      'spkiFingerprint',
    ]) {
      expect(typeof runtime[method], `hermes.${method} is not a function`).toBe('function');
    }
  });

  describe('canonical JSON bytes are identical to Node (AC: "Canonical JSON ... bytes are identical between Node, web, and Hermes")', () => {
    for (const vector of set.jcs) {
      it(`jcs/${vector.name}`, async () => {
        for (const input of vector.inputs) {
          const hermesOutput = await canonicalizeInHermes(input);
          if (vector.expectError) {
            expect(hermesOutput.startsWith('ERROR:'), `hermes accepted ${input}; expected rejection`).toBe(
              true,
            );
            continue;
          }
          expect(hermesOutput).toBe(vector.expectedCanonical);
          // Node's own oracle, so a drift in the vector itself (not just a
          // Hermes/Node difference) is also caught here.
          expect(hermesOutput).toBe(canonicalize(input));
        }
      });
    }
  });

  describe(
    'buildChecks wires hermes into the check gate, and cross-engine signatures verify ' +
      '(AC: "Hermes verifies signatures produced by Node and web; Node and web verify signatures produced by Hermes")',
    () => {
      it('registers vectors/hermes/* and both interop directions with node and web', async () => {
        const checks = await buildChecks({ vectorsDir: VECTORS_DIR, sdkRoot: null, hermes: location });
        const ids = checks.map((c) => c.id);
        expect(ids.some((id) => id.startsWith('vectors/hermes/'))).toBe(true);
        for (const prefix of [
          'interop/hermes->node/',
          'interop/node->hermes/',
          'interop/hermes->web/',
          'interop/web->hermes/',
        ]) {
          expect(ids.some((id) => id.startsWith(prefix)), `missing a check under ${prefix}`).toBe(
            true,
          );
        }
      });

      it('every vectors/hermes/* and interop/*hermes* check passes', async () => {
        const checks = await buildChecks({ vectorsDir: VECTORS_DIR, sdkRoot: null, hermes: location });
        const results = await runChecks(checks);
        const hermesResults = results.filter((r) => r.id.includes('hermes'));
        expect(hermesResults.length).toBeGreaterThan(0);
        const failed = hermesResults.filter((r) => !r.passed);
        expect(failed.map((r) => `${r.id}: ${r.message}`)).toEqual([]);
      });
    },
  );
});
