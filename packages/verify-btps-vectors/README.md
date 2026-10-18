# verify-btps-vectors

Runs the BTPS golden vectors in [`test/vectors/`](../../test/vectors/) on every
runtime driver, across runtimes, and against the `@btps/sdk` source tree.
It runs as `yarn verify:btps-vectors`, and in CI as the `ci/vectors` check.

```sh
# From the repository root (same as the CI form below)
yarn verify:btps-vectors

# CI form: passes while the failing checks are exactly the known-failing list
node packages/verify-btps-vectors/bin/verify-btps-vectors.mjs \
  --known-failing test/vectors/known-failing.json

# Strict form: every check must pass. In 1.1 the known-failing list is empty, so both forms agree.
node packages/verify-btps-vectors/bin/verify-btps-vectors.mjs
```

Options: `--vectors <dir>`, `--sdk-root <dir>`, `--no-sdk`,
`--known-failing <file>`, `--json`. Exit codes: `0` OK, `1` checks failed,
`2` the run could not start.

Requirements: Node 24 or later, with `esbuild` resolvable (it is a
devDependency of the repository root).

## What it checks

| Suite                                                      | Runs on            | What it shows                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vectors/<runtime>/…`                                      | node, web          | JCS (RFC 8785) vectors; managed and self-held signatures verify over the canonical bytes and **not** over the raw key order; re-signing reproduces the vector bytes; the KMS-style OAEP wrap unwraps; an MGF1-SHA-1 wrap is refused; the signing and encryption keys are distinct and cannot stand in for each other |
| `interop/<a>-><b>/…`                                       | node→web, web→node | a signature or wrap made by one runtime is accepted by the other, and signatures are byte-identical to the vector                                                                                                                                                                                                    |
| `oracle/oaep/…`                                            | node               | the reference OAEP (raw RSA) confirms the positive wrap decodes only under MGF1-SHA-256, and that the negative vector really is an MGF1-SHA-1 wrap                                                                                                                                                                   |
| `sdk/kms/…`                                                | node, SDK          | the SDK's fingerprint, `encryptRSA` and `decryptRSA` match the KMS profile. Passes on 367cd09                                                                                                                                                                                                                        |
| `sdk/item-5/…`                                             | node, SDK          | BTPS 1.1 item 5, JCS signing. Failed on 1.0 (367cd09), passes on 1.1                                                                                                                                                                                                                                                 |
| `sdk/item-6/…`                                             | node, SDK          | item 6, the artifact's `selector` names the sender's signing key. Failed on 1.0 (367cd09), passes on 1.1                                                                                                                                                                                                             |
| `sdk/item-10/…`                                            | node, SDK          | item 10, the defects that can be expressed as data: short GCM tags, identities with more than one `$`. Failed on 1.0 (367cd09), passes on 1.1                                                                                                                                                                        |
| `vectors/manifest/…`                                       | node               | every vector file is in `manifest.json`, and its bytes match their SHA-256 there                                                                                                                                                                                                                                     |
| `vectors/signed-artifacts/…`, `vectors/device-key-proof/…` | node, web          | the reference JCS reproduces each canonical form, and each signature verifies on every runtime driver                                                                                                                                                                                                                |
| `sdk/protocol/…`                                           | node, SDK          | the protocol vectors: the SDK accepts and refuses each address, document and time-window case as stated; verifies, re-signs byte for byte and decrypts the signed artifacts; builds the device key proof's payload and verifies it. A tree without the 1.1 protocol modules fails these, each saying why             |

### The known-failing list

[`test/vectors/known-failing.json`](../../test/vectors/known-failing.json)
lists the item checks still expected to fail, each with what fixes it. In
1.1 it is **empty**, so CI is strict: every check must pass. Under
`--known-failing`, the run passes only if the failing set is **exactly**
that list:

- a failure not on the list fails the run;
- a listed check that now passes fails the run too, so **a fix must remove
  its own entries in the same change** that fixes them;
- a listed id that no longer exists fails the run.

So the list can only shrink, and it can never hide a check that started
passing or stopped running. It stays, empty, so a new item can be added the
same way: its checks listed first, and removed by the change that fixes them.

The 1.1 fixes for items 5, 6 and 10 are also covered by the SDK's own unit
tests in `src/core/crypto/{index,jcs}.test.ts`.

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
[`src/runtimes/types.mjs`](src/runtimes/types.mjs). The vector checks and
interop pairs pick it up without new vectors. The web driver, the vector
checks and the interop checks import nothing from Node — a test enforces
that — so a browser or React Native harness can import
`checks/vectors.mjs` and `runtimes/web.mjs` as they are.

## Limitations — read before relying on a green run

- **"web" here is WebCrypto as implemented by Node**, not a browser. Node's
  WebCrypto and `node:crypto` share OpenSSL, so node↔web interop is weaker
  evidence of independence than a real browser would give. No browser,
  iOS or Android harness exists yet.
- **No vector was produced by AWS KMS or a device keystore.** The managed
  vector is signed by node:crypto with the algorithm KMS uses
  (RSASSA_PKCS1_V1_5_SHA_256), and the self-held one by WebCrypto. A vector
  signed by a real KMS key is still owed.
- **Item 6 calls the SDK through one adapter,** `produceItem6Artifact` in
  [`src/checks/sdk.mjs`](src/checks/sdk.mjs). If the SDK's `signEncrypt`
  call shape changes, the adapter must change in the same pull request.
- **Item 10 covers two of its seven defects.** Schema failures, crossed
  responses, the line-length limit and error codes are server behaviour,
  tested in the SDK and the e2e journeys.
- **Item 5 duplicate-name rejection is tested through `verifySignature`
  with a string payload**, because the SDK's wire parsing (JSON.parse) has
  already dropped duplicates by the time an object reaches it.
- The reference JCS in [`src/jcs.mjs`](src/jcs.mjs) is the harness's oracle.
  It is not the SDK implementation (`src/core/crypto/jcs.ts`).
