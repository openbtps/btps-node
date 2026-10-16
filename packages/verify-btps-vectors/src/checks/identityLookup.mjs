/**
 * Item J, host identity lookup repaired (EBA-442), and fix-list item 9,
 * padded keys in DNS (EBA-186): identity-lookup.vectors.json against the
 * SDK's parts, loaded from the tree under test.
 *
 * - parse: `parseBtpsTxtRecord` (@btps/sdk) reads each TXT record into the
 *   vector's tags.
 * - dns: `getDnsIdentityParts` (@btps/sdk) over the vector's zone, where any
 *   other name has no record (ENOTFOUND): the key, absent, or the error code.
 * - lookup: `verifyIdentityLookupResponse` (@btps/sdk/crypto) accepts each
 *   host answer with its key record, or refuses it with the error code.
 *
 * The server's side runs over real TLS in
 * src/server/test/identityLookup.integration.test.ts.
 */

import { ensure } from '../check.mjs';

const ITEM = 'J';

const base64 = (pem) =>
  String(pem ?? '')
    .replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '')
    .replace(/\s+/g, '');

/**
 * @param {import('../sdk-loader.mjs').LoadedSdk} sdk
 * @param {ReturnType<import('../vectors.mjs').loadVectorSet>} set
 * @returns {import('../check.mjs').Check[]}
 */
export function identityLookupSdkChecks(sdk, set) {
  const model = set.identityLookup;
  const check = (name, needs, run) => ({
    id: `sdk/item-J/${name}`,
    item: ITEM,
    tickets: model.tickets,
    run() {
      for (const [where, fn] of needs) {
        ensure(typeof fn === 'function', `the SDK has no ${where}`);
      }
      return run();
    },
  });
  const parser = [
    'TXT tag parser (parseBtpsTxtRecord in @btps/sdk)',
    sdk.utils?.parseBtpsTxtRecord,
  ];
  const dnsLookup = [
    'identity record lookup (getDnsIdentityParts in @btps/sdk)',
    sdk.utils?.getDnsIdentityParts,
  ];
  const verifier = [
    'lookup answer check (verifyIdentityLookupResponse in @btps/sdk/crypto)',
    sdk.crypto?.verifyIdentityLookupResponse,
  ];
  const checks = [];

  for (const c of model.parse) {
    checks.push(
      check(`parse/${c.name}`, [parser], () => {
        const tags = sdk.utils.parseBtpsTxtRecord(c.record.join(''));
        for (const [tag, value] of Object.entries(c.expect)) {
          ensure(
            tags[tag] === value,
            `tag ${tag}: ${JSON.stringify(tags[tag])}; expected ${value}`,
          );
        }
        ensure(
          Object.keys(tags).length === Object.keys(c.expect).length,
          `tags ${Object.keys(tags).join(', ')}; expected ${Object.keys(c.expect).join(', ')}`,
        );
      }),
    );
  }

  for (const c of model.dns) {
    checks.push(
      check(`dns/${c.name}`, [dnsLookup], async () => {
        sdk.setTxtRecords(c.zone);
        let result;
        let error;
        try {
          result = await sdk.utils.getDnsIdentityParts(c.identity, c.selector);
        } catch (err) {
          error = err;
        }
        if (c.expect === 'error') {
          ensure(error, `answered ${JSON.stringify(result)}; expected error ${c.error}`);
          ensure(error.code === c.error, `failed with ${error.code}; expected ${c.error}`);
          return;
        }
        ensure(!error, `failed with ${error?.code ?? error?.message}; expected ${c.expect}`);
        if (c.expect === 'absent') {
          ensure(result === undefined, `found ${JSON.stringify(result)}; expected no record`);
          return;
        }
        ensure(
          base64(result?.pem) === base64(model.keys[c.key].publicKeyPem),
          `resolved another key than ${c.key}`,
        );
      }),
    );
  }

  for (const c of model.lookup.cases) {
    checks.push(
      check(`lookup/${c.name}`, [verifier], async () => {
        sdk.setTxtRecords(model.lookup.zone);
        const { record, error } = await sdk.crypto.verifyIdentityLookupResponse(
          c.response,
          model.lookup.request,
        );
        if (c.expect === 'accept') {
          ensure(!error, `refused with ${error?.code}: ${error?.cause ?? error?.message}`);
          ensure(
            base64(record?.publicKey) === base64(model.keys[c.key].publicKeyPem),
            `accepted with another key than ${c.key}`,
          );
          return;
        }
        ensure(error, 'accepted; expected refusal');
        ensure(error.code === c.error, `refused with ${error.code}; expected ${c.error}`);
      }),
    );
  }

  return checks;
}
