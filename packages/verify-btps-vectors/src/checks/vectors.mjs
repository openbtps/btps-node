/**
 * Vector checks, run once per runtime driver. They prove the vectors are
 * self-consistent and that the runtime implements the BTPS 1.1 crypto
 * profile: JCS, RSASSA-PKCS1-v1_5/SHA-256 signatures for both
 * custody modes, RSA-OAEP/SHA-256 with MGF1-SHA-256 wrapping, and separate
 * signing and encryption keys, and the separate signature and encryption
 * selectors.
 *
 * Canonical forms come from the runtime when it canonicalises itself
 * (`runtime.canonicalize`, e.g. Hermes running the SDK's jcs.ts), and from
 * the jcs.mjs oracle otherwise. Nothing else here touches the SDK; see
 * sdk.mjs for that.
 */

import { canonicalize } from '../jcs.mjs';
import { bytesEqual, fromBase64, utf8 } from '../encoding.mjs';
import { ensure, ensureRejects } from '../check.mjs';

/**
 * @param {import('../runtimes/types.mjs').RuntimeDriver} runtime
 * @param {ReturnType<import('../vectors.mjs').loadVectorSet>} set
 * @returns {import('../check.mjs').Check[]}
 */
export function vectorChecks(runtime, set) {
  const id = (name) => `vectors/${runtime.name}/${name}`;
  const canon = async (text) =>
    runtime.canonicalize ? runtime.canonicalize(text) : canonicalize(text);
  const checks = [];

  for (const vector of set.jcs) {
    checks.push({
      id: id(`jcs/${vector.name}`),
      async run() {
        for (const input of vector.inputs) {
          if (vector.expectError) {
            let accepted = false;
            try {
              await canon(input);
              accepted = true;
            } catch {
              // rejected, as expected
            }
            ensure(!accepted, `accepted ${JSON.stringify(input)}; expected rejection`);
            continue;
          }
          const output = await canon(input);
          ensure(
            output === vector.expectedCanonical,
            `${JSON.stringify(input)} canonicalised to ${JSON.stringify(output)}, expected ${JSON.stringify(vector.expectedCanonical)}`,
          );
        }
      },
    });
  }

  const jcsKey = set.managedSignature;
  for (const c of set.jcsSignature.cases) {
    const signature = fromBase64(c.signatureBase64);
    if (c.expect === 'reject') {
      checks.push({
        id: id(`jcs-signature/${c.name}`),
        async run() {
          for (const input of c.inputs) {
            ensure(
              await runtime.verifyPkcs1Sha256(jcsKey.publicKeyPem, utf8(input), signature),
              'the signature does not cover the raw input, so this vector cannot show a refusal means anything',
            );
            let accepted = false;
            try {
              await canon(input);
              accepted = true;
            } catch {
              // refused, as expected
            }
            ensure(
              !accepted,
              `canonicalised ${JSON.stringify(input)}; duplicate names must be refused`,
            );
          }
        },
      });
      continue;
    }
    checks.push({
      id: id(`jcs-signature/${c.name}`),
      async run() {
        ensure(
          await runtime.verifyPkcs1Sha256(jcsKey.publicKeyPem, utf8(c.canonicalPayload), signature),
          'signature did not verify over canonicalPayload',
        );
        for (const input of c.inputs) {
          ensure(
            (await canon(input)) === c.canonicalPayload,
            `${JSON.stringify(input)} does not canonicalise to canonicalPayload`,
          );
          ensure(input !== c.canonicalPayload, 'an input is already canonical');
        }
      },
    });
  }

  for (const vector of [set.managedSignature, set.selfHeldSignature]) {
    const name = (check) => id(`signature/${vector.custody}/${check}`);
    const canonical = utf8(vector.canonicalPayload);
    const signature = fromBase64(vector.signatureBase64);

    checks.push(
      {
        id: name('fingerprint-is-sha256-of-spki'),
        async run() {
          const fp = await runtime.spkiFingerprint(vector.publicKeyPem);
          ensure(fp === vector.fingerprint, `fingerprint ${fp}, vector says ${vector.fingerprint}`);
        },
      },
      {
        id: name('canonical-payload-is-jcs-of-raw-payload'),
        async run() {
          ensure(
            (await canon(vector.payloadRaw)) === vector.canonicalPayload,
            'canonicalPayload is not JCS(payloadRaw)',
          );
          ensure(
            vector.payloadRaw !== vector.canonicalPayload,
            'payloadRaw is already canonical, so this vector cannot tell key order apart',
          );
        },
      },
      {
        id: name('signature-verifies-over-canonical-bytes'),
        async run() {
          ensure(
            await runtime.verifyPkcs1Sha256(vector.publicKeyPem, canonical, signature),
            'signature did not verify',
          );
        },
      },
      {
        id: name('signature-does-not-verify-over-raw-key-order'),
        async run() {
          ensure(
            !(await runtime.verifyPkcs1Sha256(
              vector.publicKeyPem,
              utf8(vector.payloadRaw),
              signature,
            )),
            'signature verified over the non-canonical bytes; the vector does not pin canonical signing',
          );
        },
      },
      {
        id: name('resigning-reproduces-the-vector-bytes'),
        async run() {
          // RSASSA-PKCS1-v1_5 is deterministic, so any conforming signer
          // produces exactly these bytes from this key and payload.
          const again = await runtime.signPkcs1Sha256(vector.privateKeyPem, canonical);
          ensure(
            bytesEqual(again, signature),
            'signing the canonical payload produced different bytes',
          );
        },
      },
      {
        id: name('tampered-payload-is-rejected'),
        async run() {
          const tampered = utf8(
            vector.canonicalPayload.replace(/\d(?=\D*$)/, (d) => String((Number(d) + 1) % 10)),
          );
          ensure(
            !(await runtime.verifyPkcs1Sha256(vector.publicKeyPem, tampered, signature)),
            'signature verified over a tampered payload',
          );
        },
      },
    );
  }

  checks.push(
    {
      id: id('wrap/kms-rsaes-oaep-sha256-vector-unwraps'),
      async run() {
        const unwrapped = await runtime.oaepUnwrap(
          set.oaepWrap.privateKeyPem,
          fromBase64(set.oaepWrap.wrappedKeyBase64),
        );
        ensure(
          bytesEqual(unwrapped, fromBase64(set.oaepWrap.plaintextKeyBase64)),
          'unwrapped key differs from the vector',
        );
      },
    },
    {
      id: id('wrap/mgf1-sha1-wrap-is-refused'),
      async run() {
        await ensureRejects(
          () =>
            runtime.oaepUnwrap(
              set.oaepWrap.privateKeyPem,
              fromBase64(set.oaepMgf1Sha1.wrappedKeyBase64),
            ),
          'a wrap made with MGF1-SHA-1 unwrapped; the MGF1 digest is not pinned to SHA-256',
        );
      },
    },
    {
      id: id('wrap/round-trip'),
      async run() {
        const key = crypto.getRandomValues(new Uint8Array(32));
        const wrapped = await runtime.oaepWrap(set.oaepWrap.publicKeyPem, key);
        ensure(
          bytesEqual(await runtime.oaepUnwrap(set.oaepWrap.privateKeyPem, wrapped), key),
          'round trip lost the key',
        );
      },
    },
    {
      id: id('keys/signing-and-encryption-keys-are-distinct'),
      async run() {
        const fingerprints = await Promise.all(
          [set.managedSignature, set.selfHeldSignature, set.oaepWrap].map((v) =>
            runtime.spkiFingerprint(v.publicKeyPem),
          ),
        );
        ensure(
          new Set(fingerprints).size === fingerprints.length,
          'a signing key is also the encryption key',
        );
      },
    },
    {
      id: id('keys/encryption-key-does-not-verify-a-signature'),
      async run() {
        const v = set.managedSignature;
        ensure(
          !(await runtime.verifyPkcs1Sha256(
            set.oaepWrap.publicKeyPem,
            utf8(v.canonicalPayload),
            fromBase64(v.signatureBase64),
          )),
          'the encryption key verified a signing-key signature',
        );
      },
    },
    {
      id: id('keys/signing-key-does-not-unwrap'),
      async run() {
        await ensureRejects(
          () =>
            runtime.oaepUnwrap(
              set.managedSignature.privateKeyPem,
              fromBase64(set.oaepWrap.wrappedKeyBase64),
            ),
          'the signing key unwrapped a key wrapped to the encryption key',
        );
      },
    },
  );

  checks.push(...selectorChecks(runtime, set, canon));
  return checks;
}

/**
 * Separate selectors: the key a signature selector names is the only sender key that
 * verifies the artifact, and the key an encryption selector names is the
 * only receiver key that unwraps it. The SDK checks prove the SDK writes the
 * selectors; these prove each runtime keeps the two keys apart.
 */
function selectorChecks(runtime, set, canon) {
  const checks = [];
  const keyPair = (key) =>
    key.keyVector
      ? set.oaepWrap
      : { publicKeyPem: key.publicKeyPem, privateKeyPem: key.privateKeyPem };

  for (const [name, vector] of [
    ['selectors', set.selectors],
    ['selectors-receiver-rotation', set.selectorsReceiverRotation],
  ]) {
    const id = (check) => `vectors/${runtime.name}/${name}/${check}`;
    const { sender, receiver, expect } = vector;

    checks.push(
      {
        id: id('every-key-has-its-fingerprint'),
        async run() {
          for (const party of [sender, receiver]) {
            for (const [selector, key] of Object.entries(party.keys)) {
              const fp = await runtime.spkiFingerprint(keyPair(key).publicKeyPem);
              ensure(
                fp === key.fingerprint,
                `${party.identity} ${selector}: fingerprint ${fp}, vector says ${key.fingerprint}`,
              );
            }
          }
        },
      },
      {
        id: id('only-the-signature-selector-key-verifies'),
        async run() {
          const canonical = utf8(await canon(JSON.stringify(vector.artifact)));
          const signer = sender.keys[expect.signatureSelector];
          ensure(signer?.privateKeyPem, `no sender key at ${expect.signatureSelector}`);
          const signature = await runtime.signPkcs1Sha256(signer.privateKeyPem, canonical);
          for (const [selector, key] of Object.entries(sender.keys)) {
            const verified = await runtime.verifyPkcs1Sha256(
              key.publicKeyPem,
              canonical,
              signature,
            );
            ensure(
              verified === (selector === expect.signatureSelector),
              `the sender key at ${selector} ${verified ? 'verified' : 'did not verify'} a signature made at ${expect.signatureSelector}`,
            );
          }
        },
      },
      {
        id: id('only-the-encryption-selector-key-unwraps'),
        async run() {
          const target = receiver.keys[expect.encryptionSelector];
          ensure(target, `no receiver key at ${expect.encryptionSelector}`);
          const key = crypto.getRandomValues(new Uint8Array(32));
          const wrapped = await runtime.oaepWrap(keyPair(target).publicKeyPem, key);
          for (const [selector, other] of Object.entries(receiver.keys)) {
            const { privateKeyPem } = keyPair(other);
            if (selector === expect.encryptionSelector) {
              ensure(
                bytesEqual(await runtime.oaepUnwrap(privateKeyPem, wrapped), key),
                `the receiver key at ${selector} unwrapped a different key`,
              );
            } else {
              await ensureRejects(
                () => runtime.oaepUnwrap(privateKeyPem, wrapped),
                `the receiver key at ${selector} unwrapped a key wrapped at ${expect.encryptionSelector}`,
              );
            }
          }
        },
      },
    );
  }
  return checks;
}
