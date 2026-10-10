// EBA-150: React Native + Expo vector harness (iOS, Android).
//
// Outcome wanted: EBA-110's test/vectors/ run unchanged on React Native
// with Expo, exercising managed and self-held custody. NOT YET MET — see
// principal-architect's round-1 review of PR #4
// (https://github.com/openbtps/btps-node/pull/4) and the README's
// Limitations section.
//
// createIosRuntime()/createAndroidRuntime() (src/runtimes/ios.mjs,
// android.mjs) are web.mjs's WebCrypto driver re-exported under a
// platform name. There is no Xcode, Android SDK, simulator or Expo runtime
// in this sandbox, so the tests below exercise them under plain Node, the
// same way createWebRuntime() already is elsewhere in this suite. That
// proves only that the driver object satisfies the RuntimeDriver contract
// (src/runtimes/types.mjs) — it is not a signature made or verified on
// iOS or Android, no KMS signer is called, and no Keychain or Keystore is
// touched.
//
// Because of that, these two drivers are deliberately NOT registered in
// buildChecks() (see src/runner.mjs): wiring them in would make
// vectors/ios/*, vectors/android/* and interop/*-><->ios|android pass on
// Node while naming a platform that never ran, which is what round 1
// found wrong. The second describe block below is a regression guard for
// that, not a claim that the acceptance criteria are met.
import { describe, expect, it } from 'vitest';
import { createIosRuntime } from '../src/runtimes/ios.mjs';
import { createAndroidRuntime } from '../src/runtimes/android.mjs';
import { buildChecks } from '../src/runner.mjs';
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

describe('buildChecks does not wire ios/android into the check gate yet', () => {
  // Regression guard for EBA-150 round 1: a check id that names "ios" or
  // "android" is a claim that something ran on that platform. Until
  // createIosRuntime()/createAndroidRuntime() run against a real Expo/RN
  // target, no such id may exist in the set verify:btps-vectors reports —
  // see src/runner.mjs and the README's Limitations section.
  it('has no vectors/ios, vectors/android, or ios/android interop check ids', async () => {
    const checks = await buildChecks({ vectorsDir: VECTORS_DIR, sdkRoot: null });
    const ids = checks.map((c) => c.id);
    const mobileNamed = ids.filter(
      (id) =>
        id.startsWith('vectors/ios/') ||
        id.startsWith('vectors/android/') ||
        id.startsWith('interop/ios->') ||
        id.startsWith('interop/android->') ||
        id.includes('->ios/') ||
        id.includes('->android/'),
    );
    expect(
      mobileNamed,
      'a check id naming ios or android must not appear in buildChecks() until that driver runs on a real Expo/RN target',
    ).toEqual([]);
  });
});
