/**
 * Sign-then-verify checks over the document-model v2 fixtures
 * (test/fixtures/documents/, EBA-119), run on every runtime driver.
 *
 * These are not golden vectors with one pinned signature: there is no "the"
 * signature for an arbitrary invoice or payslip, so there is nothing to pin.
 * What they prove is narrower and still real — each fixture's JCS canonical
 * form signs and verifies on every runtime this package drives, so a
 * document the schema (src/schema/) accepts is never quietly unsignable or
 * unverifiable on Node or on WebCrypto. That includes the fixture with an
 * unknown payslip category and an unknown extensions block
 * (payslip.unknown-extensions.v2.json): EBA-119's acceptance criterion says
 * it is "carried byte-for-byte and still verifying", and this is what shows
 * "verifying" with an actual signature check rather than only a schema
 * parse.
 *
 * The signing key is the existing managed-signature golden vector's key
 * pair (test/vectors/kms-signature.vector.json). It is not any fixture's
 * real sender key — none exists, because these are schema vectors, not
 * delivered artifacts.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalizeValue } from '../jcs.mjs';
import { utf8 } from '../encoding.mjs';
import { ensure } from '../check.mjs';

/**
 * Loads every fixture in EBA-119's own test/fixtures/documents/ as parsed
 * JSON. This is read from that directory directly, not duplicated into
 * test/vectors/: the fixtures are the ticket's declared vectors already.
 *
 * @param {string} dir
 * @returns {{ name: string, raw: unknown }[]}
 */
export function loadDocumentModelFixtures(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => ({ name, raw: JSON.parse(readFileSync(path.join(dir, name), 'utf8')) }));
}

/**
 * @param {import('../runtimes/types.mjs').RuntimeDriver} runtime
 * @param {ReturnType<import('../vectors.mjs').loadVectorSet>} set
 * @param {{ name: string, raw: unknown }[]} fixtures
 * @returns {import('../check.mjs').Check[]}
 */
export function documentModelChecks(runtime, set, fixtures) {
  const id = (name) => `documentModel/${runtime.name}/${name}`;
  const key = set.managedSignature;

  return fixtures.map((fixture) => ({
    id: id(`${fixture.name}/sign-then-verify`),
    item: 7,
    async run() {
      const canonical = utf8(canonicalizeValue(fixture.raw));
      const signature = await runtime.signPkcs1Sha256(key.privateKeyPem, canonical);
      const verified = await runtime.verifyPkcs1Sha256(key.publicKeyPem, canonical, signature);
      ensure(verified, `${fixture.name} signed on ${runtime.name} but did not verify`);
    },
  }));
}
