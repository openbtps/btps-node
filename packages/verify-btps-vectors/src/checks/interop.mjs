/**
 * Cross-runtime checks: what one runtime produces, every other runtime must
 * accept. With two drivers that is node→web and web→node; adding a driver
 * (iOS, Android) adds its pairs without new vectors.
 */

import { bytesEqual, fromBase64, utf8 } from '../encoding.mjs';
import { ensure } from '../check.mjs';

/**
 * @param {import('../runtimes/types.mjs').RuntimeDriver[]} runtimes
 * @param {ReturnType<import('../vectors.mjs').loadVectorSet>} set
 * @returns {import('../check.mjs').Check[]}
 */
export function interopChecks(runtimes, set) {
  const checks = [];
  for (const producer of runtimes) {
    for (const consumer of runtimes) {
      if (producer === consumer) continue;
      const id = (name) => `interop/${producer.name}->${consumer.name}/${name}`;

      for (const vector of [set.managedSignature, set.selfHeldSignature]) {
        checks.push({
          id: id(`signature/${vector.custody}`),
          async run() {
            const canonical = utf8(vector.canonicalPayload);
            const signature = await producer.signPkcs1Sha256(vector.privateKeyPem, canonical);
            ensure(
              await consumer.verifyPkcs1Sha256(vector.publicKeyPem, canonical, signature),
              `${consumer.name} rejected a ${producer.name} signature`,
            );
            ensure(
              bytesEqual(signature, fromBase64(vector.signatureBase64)),
              `${producer.name} produced signature bytes that differ from the vector`,
            );
          },
        });
      }

      checks.push({
        id: id('wrap/rsaes-oaep-sha256'),
        async run() {
          const key = crypto.getRandomValues(new Uint8Array(32));
          const wrapped = await producer.oaepWrap(set.oaepWrap.publicKeyPem, key);
          const unwrapped = await consumer.oaepUnwrap(set.oaepWrap.privateKeyPem, wrapped);
          ensure(
            bytesEqual(unwrapped, key),
            `${consumer.name} unwrapped a different key from a ${producer.name} wrap`,
          );
        },
      });
    }
  }
  return checks;
}
