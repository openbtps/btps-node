# verify-btps-vectors

Runs the BTPS golden vectors in [`test/vectors/`](../../test/vectors/) on every
runtime driver, across runtimes, and against the `@btps/sdk` source tree.
This is the `verify:btps-vectors` verb from EBA-110 (BTPS 1.1 epic EBA-109).

```sh
# From the repository root (same as the CI form below)
yarn verify:btps-vectors

# CI form: passes while the failing checks are exactly the known-failing list
node packages/verify-btps-vectors/bin/verify-btps-vectors.mjs \
  --known-failing test/vectors/known-failing.json

# Strict form: every check must pass. Red until EBA-115, EBA-116 and EBA-122 land.
node packages/verify-btps-vectors/bin/verify-btps-vectors.mjs
```

Options: `--vectors <dir>`, `--sdk-root <dir>`, `--no-sdk`,
`--known-failing <file>`, `--json`. Exit codes: `0` OK, `1` checks failed,
`2` the run could not start.

Requirements: Node 20 or later, with `esbuild` resolvable (it is a
devDependency of the repository root). It has been run on Node 24.21.0 only.

## What it checks

| Suite                 | Runs on            | What it shows                                                                                                                                                                                                                                                                                                        |
| --------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vectors/<runtime>/…` | node, web | JCS (RFC 8785) vectors; managed and self-held signatures verify over the canonical bytes and **not** over the raw key order; re-signing reproduces the vector bytes; the KMS-style OAEP wrap unwraps; an MGF1-SHA-1 wrap is refused; the signing and encryption keys are distinct and cannot stand in for each other |
| `interop/<a>-><b>/…`  | every ordered pair of node, web | a signature or wrap made by one runtime is accepted by the other, and signatures are byte-identical to the vector                                                                                                                                                                                                    |
| `oracle/oaep/…`       | node               | the reference OAEP (raw RSA) confirms the positive wrap decodes only under MGF1-SHA-256, and that the negative vector really is an MGF1-SHA-1 wrap                                                                                                                                                                   |
| `sdk/kms/…`           | node, SDK          | the SDK's fingerprint, `encryptRSA` and `decryptRSA` match the KMS profile. Passes on 367cd09                                                                                                                                                                                                                        |
| `sdk/item-5/…`        | node, SDK          | BTPS 1.1 item 5, JCS signing (EBA-115). **Fails on 367cd09**                                                                                                                                                                                                                                                         |
| `sdk/item-6/…`        | node, SDK          | item 6, separate `signatureSelector` and `encryptionSelector` (EBA-116). **Fails on 367cd09**                                                                                                                                                                                                                        |
| `sdk/item-10/…`       | node, SDK          | item 10, the defects that can be expressed as data: short GCM tags, identities with more than one `$` (EBA-122). **Fails on 367cd09**                                                                                                                                                                                |

### The known-failing list

[`test/vectors/known-failing.json`](../../test/vectors/known-failing.json)
lists the item checks that fail on baseline 367cd09, each with the ticket
that owns its fix. Under `--known-failing`, the run passes only if the
failing set is **exactly** that list:

- a failure not on the list fails the run;
- a listed check that now passes fails the run too, so **a fix ticket must
  remove its own entries in the same change** that fixes them;
- a listed id that no longer exists fails the run.

So the list can only shrink, and it can never hide a check that started
passing or stopped running. Delete the file when it is empty, and switch CI
to the strict form.

### The same ratchet in `yarn test`

EBA-110's acceptance tests in `src/core/crypto/{index,jcs,identityKeys}.test.ts`
reproduce the same defects as vitest tests. Each one that fails on 367cd09 is
written as `it.fails`, and its name says which ticket's fix makes it pass:
"(expected failure until EBA-115 lands)". So `yarn test` stays green on
master. When the fix lands, those tests turn red, and the fix ticket must
change `it.fails` to `it` in the same change, just as it removes its
known-failing entries.

### Running against another SDK tree

`--sdk-root` points the SDK checks at any btps-node checkout. To reproduce
the baseline failures from a later commit:

```sh
git worktree add /tmp/btps-367cd09 367cd09
node packages/verify-btps-vectors/bin/verify-btps-vectors.mjs --sdk-root /tmp/btps-367cd09
```

The SDK is bundled from `src/` with esbuild, so it does not need building.
`dns/promises` is replaced with an in-memory zone, so no check touches the
network.

## Adding a runtime

A runtime is a driver implementing the five functions in
[`src/runtimes/types.mjs`](src/runtimes/types.mjs). Once a driver is
registered in `buildChecks()` (`src/runner.mjs`), the vector checks and
interop pairs pick it up without new vectors. The web driver, the vector
checks and the interop checks import nothing from Node — a test enforces
that — so a browser or React Native harness can import
`checks/vectors.mjs` and `runtimes/web.mjs` as they are.

[`src/runtimes/ios.mjs`](src/runtimes/ios.mjs) and
[`src/runtimes/android.mjs`](src/runtimes/android.mjs) (EBA-150) are a
driver written against that contract for Expo: each re-exports the web
driver under its own platform name, because the WebCrypto surface is what
an Expo app calls through on either platform. They carry the same
portability rule as `web.mjs` — no Node built-in, no third-party import —
enforced by the same test. **They are deliberately not registered in
`buildChecks()`.** Wiring an unrun driver in would make `vectors/ios/*`,
`vectors/android/*` and `interop/*-><->ios|android` pass on plain Node
while naming a platform nothing ran on — principal-architect's review of
EBA-150's PR #4 round 1 caught exactly this, and
`mobile-runtimes.test.mjs` now guards against it recurring. A driver may
join `buildChecks()` only once it actually runs in a real Expo/RN target
(iOS Simulator, Android emulator, or EAS) or an equivalent on-device
signal — see Limitations below.

## Limitations — read before relying on a green run

- **iOS and Android are not part of this package's check gate.**
  `ios.mjs` and `android.mjs` (EBA-150) exist as a driver written against
  the `RuntimeDriver` contract, and `test/mobile-runtimes.test.mjs`
  exercises them directly to prove the driver object itself is correct —
  but neither is registered in `buildChecks()`, so no `verify:btps-vectors`
  run reports a `vectors/ios/*`, `vectors/android/*` or
  `interop/*-><->ios|android` check, and ARCH-05's "green on Node, web,
  iOS and Android" line is **not** satisfied by this package today. There
  is no Xcode, Android SDK, simulator or Expo runtime in this sandbox, so
  both drivers can currently only be exercised under plain Node — the same
  WebCrypto implementation "web" already runs on, sharing OpenSSL with
  `node:crypto`, which would be weak evidence of platform independence
  even if it were wired in. Binding these operations to the real Keychain
  or Keystore (BTPS 1.1 item 8's Signer/Decrypter interfaces, ARCH-05
  DEC-012) is separate work this ticket does not do. Running the Expo app
  on an actual iOS/Android target (or an EAS/simulator/emulator run) is a
  prerequisite this sandbox cannot provide, and re-scoping or providing
  that runner is a decision for Bhupendra Tamang / infra, not this
  package.
- **No managed-custody (KMS) or self-held (device keystore) signing has
  been exercised.** The managed vector is signed by node:crypto with the
  algorithm KMS uses (RSASSA_PKCS1_V1_5_SHA_256), and the self-held one by
  WebCrypto — neither calls a KMS signer, a Keychain, or a Keystore. A
  vector produced by a real KMS key or a real device keystore is still
  owed.
- **Item 6 call shape is a guess at the 1.1 API.** The adapter
  `produceItem6Artifact` in [`src/checks/sdk.mjs`](src/checks/sdk.mjs) uses
  the 367cd09 call shape. EBA-116 may change it, and then the adapter must
  change in the same PR.
- **Item 10 covers two of its seven defects.** Schema failures, crossed
  responses, the line-length limit and error codes are server behaviour, and
  EBA-122 tests them itself.
- **Item 5 duplicate-name rejection is tested through `verifySignature`
  with a string payload**, because the SDK's wire parsing (JSON.parse) has
  already dropped duplicates by the time an object reaches it.
- The reference JCS in [`src/jcs.mjs`](src/jcs.mjs) is the harness's oracle.
  It is not the SDK implementation, which belongs to EBA-115.
