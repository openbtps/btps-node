// EBA-150: React Native + Expo vector harness (iOS, Android).
//
// Outcome: EBA-110's test/vectors/ run unchanged on React Native with Expo,
// exercising managed and self-held custody. The README's own "Adding a
// runtime" section says what that takes: a driver implementing the five
// RuntimeDriver functions in src/runtimes/types.mjs. Once that driver is
// registered in buildChecks(), the existing generic vectorChecks and
// interopChecks already produce everything this ticket's acceptance
// criteria ask for — they are not new mechanics, just new participants in
// mechanics EBA-110 already built:
//
//   - vectorChecks(iosRuntime, set) checks both set.managedSignature
//     (signed by node:crypto — "Node's signature") and
//     set.selfHeldSignature (signed by WebCrypto — "web's signature")
//     against the iOS driver, so "iOS verifies Node's and web's
//     signatures" and "managed/self-held custody is exercised" fall out
//     of the same loop that already runs for node and web.
//   - interopChecks([..., ios, android], set) crosses every pair, so
//     interop/ios->node and interop/ios->web (and the android equivalents)
//     are exactly "Node verifies iOS[...] signatures" / "web verifies
//     iOS[...] signatures".
//
// What this file cannot check: whether a real iOS or Android device (or
// simulator) actually produces/verifies these signatures. There is no
// Xcode, Android SDK, simulator or Expo runtime in this sandbox, so
// createIosRuntime()/createAndroidRuntime() are exercised here under plain
// Node, the same way createWebRuntime() already is in the rest of this
// package's suite. That proves the harness wiring; it does not replace
// actually running the Expo app on iOS and Android, which is the only way
// to confirm this ticket's outcome for real.
import { describe, expect, it } from 'vitest';
import { createIosRuntime } from '../src/runtimes/ios.mjs';
import { createAndroidRuntime } from '../src/runtimes/android.mjs';
import { buildChecks, runChecks } from '../src/runner.mjs';
import { loadVectorSet } from '../src/vectors.mjs';
import { fromBase64, utf8 } from '../src/encoding.mjs';
import { VECTORS_DIR } from './helpers.mjs';

const set = loadVectorSet(VECTORS_DIR);

const DRIVERS = [
  ['ios', createIosRuntime],
  ['android', createAndroidRuntime],
];

describe.each(DRIVERS)('%s runtime driver', (name, create) => {
  it('conforms to the RuntimeDriver contract (src/runtimes/types.mjs)', () => {
    const runtime = create();
    expect(runtime.name).toBe(name);
    for (const method of [
      'signPkcs1Sha256',
      'verifyPkcs1Sha256',
      'oaepWrap',
      'oaepUnwrap',
      'spkiFingerprint',
    ]) {
      expect(typeof runtime[method], `${name}.${method} is not a function`).toBe('function');
    }
  });

  it("verifies the managed vector (Node's signature) and the self-held vector (web's signature)", async () => {
    const runtime = create();
    for (const vector of [set.managedSignature, set.selfHeldSignature]) {
      const verified = await runtime.verifyPkcs1Sha256(
        vector.publicKeyPem,
        utf8(vector.canonicalPayload),
        fromBase64(vector.signatureBase64),
      );
      expect(verified, `${name} did not verify the ${vector.custody} vector's signature`).toBe(
        true,
      );
    }
  });

  it('fingerprints the vector keys as SHA-256 of the SPKI DER', async () => {
    const runtime = create();
    for (const vector of [set.managedSignature, set.selfHeldSignature]) {
      const fp = await runtime.spkiFingerprint(vector.publicKeyPem);
      expect(fp).toBe(vector.fingerprint);
    }
  });

  it('signs so that a verify of its own output succeeds, and unwraps the OAEP vector', async () => {
    const runtime = create();
    const canonical = utf8(set.managedSignature.canonicalPayload);
    const signature = await runtime.signPkcs1Sha256(set.managedSignature.privateKeyPem, canonical);
    expect(
      await runtime.verifyPkcs1Sha256(set.managedSignature.publicKeyPem, canonical, signature),
    ).toBe(true);

    const unwrapped = await runtime.oaepUnwrap(
      set.oaepWrap.privateKeyPem,
      fromBase64(set.oaepWrap.wrappedKeyBase64),
    );
    expect(Buffer.from(unwrapped).toString('base64')).toBe(set.oaepWrap.plaintextKeyBase64);
  });
});

describe('buildChecks wires ios and android into the existing generic checks', () => {
  it('runs both custody vectors against ios and android (managed + self-held exercised)', async () => {
    const checks = await buildChecks({ vectorsDir: VECTORS_DIR, sdkRoot: null });
    const ids = checks.map((c) => c.id);
    for (const runtime of ['ios', 'android']) {
      for (const custody of ['managed', 'self-held']) {
        expect(ids).toContain(
          `vectors/${runtime}/signature/${custody}/signature-verifies-over-canonical-bytes`,
        );
      }
    }
  });

  it('node and web verify ios/android signatures, and ios/android verify node/web signatures — all pass', async () => {
    const checks = await buildChecks({ vectorsDir: VECTORS_DIR, sdkRoot: null });
    const ids = checks.map((c) => c.id);

    const required = [];
    for (const mobile of ['ios', 'android']) {
      for (const other of ['node', 'web']) {
        for (const custody of ['managed', 'self-held']) {
          // "Node/web verifies iOS/Android signatures": mobile is the producer.
          required.push(`interop/${mobile}->${other}/signature/${custody}`);
          // "iOS/Android verifies Node's and web's signatures": mobile is the consumer.
          required.push(`interop/${other}->${mobile}/signature/${custody}`);
        }
      }
    }
    for (const id of required) expect(ids).toContain(id);

    const results = await runChecks(checks);
    const failed = results.filter((r) => !r.passed).map((r) => r.id);
    expect(failed).toEqual([]);
  });
});
