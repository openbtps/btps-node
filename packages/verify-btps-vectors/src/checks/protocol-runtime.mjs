/**
 * The protocol vectors that need only a runtime driver: each signed
 * artifact's and the device key proof's canonical form, reproduced by the
 * reference JCS, and each signature verified on the driver. Imports nothing
 * from Node, so a browser or React Native harness can run it as it is.
 */

import { canonicalizeValue } from '../jcs.mjs';
import { fromBase64, utf8 } from '../encoding.mjs';
import { ensure } from '../check.mjs';

export const unsignedOf = ({ signature: _signature, ...rest }) => rest;

/** Runtime-independent: the vectors' canonical forms are the reference JCS's. */
export function protocolCanonicalChecks(set) {
  return [
    ...set.signedArtifacts.artifacts.map((a) => ({
      id: `vectors/signed-artifacts/${a.name}/canonical-form`,
      run() {
        ensure(
          canonicalizeValue(unsignedOf(a.artifact)) === a.canonical,
          'the reference JCS does not reproduce `canonical`',
        );
      },
    })),
    {
      id: 'vectors/device-key-proof/canonical-form',
      run() {
        ensure(
          canonicalizeValue(set.deviceKeyProof.payload) === set.deviceKeyProof.canonical,
          'the reference JCS does not reproduce `canonical`',
        );
      },
    },
  ];
}

/**
 * @param {import('../runtimes/types.mjs').RuntimeDriver} runtime
 * @returns {import('../check.mjs').Check[]}
 */
export function protocolRuntimeChecks(runtime, set) {
  const signer = set.signedArtifacts.sender.publicKeyPem;
  const proof = set.deviceKeyProof;
  return [
    ...set.signedArtifacts.artifacts.map((a) => ({
      id: `vectors/${runtime.name}/signed-artifacts/${a.name}/signature`,
      async run() {
        const ok = await runtime.verifyPkcs1Sha256(
          signer,
          utf8(a.canonical),
          fromBase64(a.artifact.signature.value),
        );
        ensure(ok, `the ${a.name} artifact's signature does not verify on ${runtime.name}`);
        ensure(
          (await runtime.spkiFingerprint(signer)) === a.artifact.signature.fingerprint,
          "the signature's fingerprint is not the sender key's",
        );
      },
    })),
    {
      id: `vectors/${runtime.name}/device-key-proof/signature`,
      async run() {
        const ok = await runtime.verifyPkcs1Sha256(
          proof.payload.publicKey,
          utf8(proof.canonical),
          fromBase64(proof.keyProof.value),
        );
        ensure(ok, `the key proof does not verify on ${runtime.name} with the new key`);
      },
    },
  ];
}
