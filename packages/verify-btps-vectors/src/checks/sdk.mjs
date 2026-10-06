/**
 * SDK conformance checks: the vectors run against @btps/sdk itself, loaded
 * from a source tree (see sdk-loader.mjs).
 *
 * The item-tagged checks are the regression proof the ticket asks for
 * (EBA-110): on the 367cd09 baseline they fail, and the fix tickets turn
 * them green — item 5 → EBA-115, item 6 → EBA-116/EBA-117, item 10 →
 * EBA-122. The untagged ones (KMS interop) already pass on the baseline and
 * must stay passing.
 *
 * Only the SDK's *public* exports are called, and every call that depends on
 * an API shape a fix ticket may change sits in one adapter below, marked.
 */

import crypto from 'node:crypto';
import { oaepDecrypt } from '../oaep-reference.mjs';
import { createWebRuntime } from '../runtimes/web.mjs';
import { ensure, ensureRejects } from '../check.mjs';

const pemToTxtBase64 = (pem) =>
  pem.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '').replace(/\s+/g, '');

/**
 * ADAPTER — item 6 call shape. On 367cd09 the caller passes one `selector`
 * (the receiver's) in the payload, and `sender` has no selector at all.
 * The sender's selector is offered two ways a 1.1 SDK might read it — on
 * the sender object and in the sender domain's _btps.host record — so the
 * check does not dictate EBA-116's API. If EBA-116 changes how a caller
 * asks for encryption, update this function and say so on EBA-116.
 */
async function produceItem6Artifact(sdk, vector) {
  const [senderAccount, senderDomain] = vector.sender.identity.split('$');
  const sender = {
    accountName: senderAccount,
    domainName: senderDomain,
    selector: vector.sender.hostSelector,
    pemFiles: {
      publicKey: vector.sender.keys[vector.sender.hostSelector].publicKeyPem,
      privateKey: vector.sender.keys[vector.sender.hostSelector].privateKeyPem,
    },
  };
  return sdk.crypto.signEncrypt(
    vector.receiver.identity,
    sender,
    { ...vector.artifact, selector: vector.receiver.hostSelector },
    {
      signature: { algorithmHash: 'sha256' },
      encryption: { algorithm: 'aes-256-gcm', mode: 'standardEncrypt' },
    },
  );
}

/** The DNS zone the item 6 vector describes, in the TXT format 367cd09 reads. */
function item6Zone(vector, receiverPublicKeyPem) {
  const zone = {};
  for (const party of [vector.sender, vector.receiver]) {
    const [account, domain] = party.identity.split('$');
    zone[`_btps.host.${domain}`] = [`v=1.1;u=btps.${domain}:3443;s=${party.hostSelector}`];
    for (const [selector, key] of Object.entries(party.keys)) {
      const pem = key.publicKeyPem ?? receiverPublicKeyPem;
      zone[`${selector}._btps.identity.${account}.${domain}`] = [
        `v=1.0.0;k=rsa;p=${pemToTxtBase64(pem)}`,
      ];
    }
  }
  return zone;
}

/**
 * @param {import('../sdk-loader.mjs').LoadedSdk} sdk
 * @param {ReturnType<import('../vectors.mjs').loadVectorSet>} set
 * @returns {import('../check.mjs').Check[]}
 */
export function sdkChecks(sdk, set) {
  const { crypto: sdkCrypto, utils } = sdk;
  const checks = [];

  // --- KMS interop: passes on 367cd09 and must keep passing --------------
  checks.push(
    {
      id: 'sdk/kms/fingerprint-matches-vector',
      run() {
        for (const v of [set.managedSignature, set.selfHeldSignature]) {
          const fp = sdkCrypto.getFingerprintFromPem(v.publicKeyPem, 'sha256');
          ensure(
            fp === v.fingerprint,
            `${v.custody}: SDK fingerprint ${fp}, vector ${v.fingerprint}`,
          );
        }
      },
    },
    {
      id: 'sdk/kms/decryptRSA-unwraps-rsaes-oaep-sha256-vector',
      run() {
        const out = sdkCrypto.decryptRSA(
          set.oaepWrap.privateKeyPem,
          Buffer.from(set.oaepWrap.wrappedKeyBase64, 'base64'),
        );
        ensure(
          out.toString('base64') === set.oaepWrap.plaintextKeyBase64,
          'SDK unwrapped a different key',
        );
      },
    },
    {
      id: 'sdk/kms/decryptRSA-refuses-mgf1-sha1-wrap',
      async run() {
        await ensureRejects(
          () =>
            sdkCrypto.decryptRSA(
              set.oaepWrap.privateKeyPem,
              Buffer.from(set.oaepMgf1Sha1.wrappedKeyBase64, 'base64'),
            ),
          'SDK unwrapped an MGF1-SHA-1 wrap; its MGF1 digest is not pinned to SHA-256',
        );
      },
    },
    {
      id: 'sdk/kms/encryptRSA-output-is-oaep-sha256-mgf1-sha256',
      async run() {
        const key = crypto.randomBytes(32);
        const wrapped = sdkCrypto.encryptRSA(set.oaepWrap.publicKeyPem, key);
        const viaOracle = oaepDecrypt(set.oaepWrap.privateKeyPem, wrapped, {
          oaepHash: 'sha256',
          mgf1Hash: 'sha256',
        });
        ensure(
          viaOracle.equals(key),
          'reference OAEP (SHA-256/MGF1-SHA-256) did not recover the key',
        );
        const viaWeb = await createWebRuntime().oaepUnwrap(
          set.oaepWrap.privateKeyPem,
          new Uint8Array(wrapped),
        );
        ensure(
          Buffer.from(viaWeb).equals(key),
          'WebCrypto RSA-OAEP/SHA-256 did not recover the key',
        );
      },
    },
  );

  // --- Item 5: canonical signing (EBA-115) --------------------------------
  for (const v of [set.managedSignature, set.selfHeldSignature]) {
    const signature = {
      algorithmHash: 'sha256',
      value: v.signatureBase64,
      fingerprint: v.fingerprint,
    };
    checks.push(
      {
        id: `sdk/item-5/${v.custody}/verifySignature-accepts-reordered-payload`,
        item: 5,
        tickets: ['EBA-115'],
        run() {
          const { isValid, error } = sdkCrypto.verifySignature(
            JSON.parse(v.payloadRaw),
            signature,
            v.publicKeyPem,
          );
          ensure(
            isValid === true,
            `a signature over the canonical form did not verify against the same document in another key order (${error?.message ?? 'no error'})`,
          );
        },
      },
      {
        id: `sdk/item-5/${v.custody}/signBtpPayload-signs-canonical-bytes`,
        item: 5,
        tickets: ['EBA-115'],
        run() {
          const signed = sdkCrypto.signBtpPayload(JSON.parse(v.payloadRaw), {
            publicKey: v.publicKeyPem,
            privateKey: v.privateKeyPem,
          });
          ensure(
            signed.value === v.signatureBase64,
            'SDK signature differs from the signature over the JCS form',
          );
        },
      },
    );
  }
  checks.push({
    id: 'sdk/item-5/verifySignature-rejects-duplicate-member-names',
    item: 5,
    tickets: ['EBA-115'],
    run() {
      const v = set.managedSignature;
      const duplicated = '{"amountCents":100,"amountCents":100000,"id":"dup-1"}';
      const value = crypto
        .sign('sha256', Buffer.from(duplicated, 'utf8'), v.privateKeyPem)
        .toString('base64');
      let result;
      try {
        result = sdkCrypto.verifySignature(
          duplicated,
          { algorithmHash: 'sha256', value, fingerprint: v.fingerprint },
          v.publicKeyPem,
        );
      } catch {
        return; // throwing is a rejection
      }
      ensure(
        result.isValid !== true,
        'a document with two values for "amountCents" verified as signed',
      );
    },
  });

  // --- Item 6: separate signature and encryption selectors (EBA-116/117) --
  const item6 = set.selectors;
  let artifactPromise;
  const item6Artifact = () => {
    artifactPromise ??= (async () => {
      sdk.setTxtRecords(item6Zone(item6, set.oaepWrap.publicKeyPem));
      const { payload, error } = await produceItem6Artifact(sdk, item6);
      if (error || !payload)
        throw new Error(`signEncrypt failed: ${error?.message ?? 'no payload'}`);
      return payload;
    })();
    return artifactPromise;
  };
  const item6Check = (name, run) => ({
    id: `sdk/item-6/${name}`,
    item: 6,
    tickets: item6.tickets,
    run,
  });

  checks.push(
    item6Check('artifact-names-signature-selector', async () => {
      const artifact = await item6Artifact();
      ensure(
        artifact.signatureSelector === item6.expect.signatureSelector,
        `signatureSelector is ${JSON.stringify(artifact.signatureSelector)}, expected "${item6.expect.signatureSelector}" (selector=${JSON.stringify(artifact.selector)})`,
      );
    }),
    item6Check('artifact-names-encryption-selector', async () => {
      const artifact = await item6Artifact();
      ensure(
        artifact.encryptionSelector === item6.expect.encryptionSelector,
        `encryptionSelector is ${JSON.stringify(artifact.encryptionSelector)}, expected "${item6.expect.encryptionSelector}"`,
      );
    }),
    item6Check('signature-verifies-with-sender-key-at-signature-selector', async () => {
      const artifact = await item6Artifact();
      const selector = artifact.signatureSelector;
      ensure(
        typeof selector === 'string',
        `the artifact does not name the sender's signing key; its one selector (${JSON.stringify(artifact.selector)}) is the receiver's, and the sender key there is the rotated-out one`,
      );
      const senderKey = await utils.resolvePublicKey(item6.sender.identity, selector);
      ensure(senderKey, `no sender key published at ${selector}`);
      const { signature, ...signed } = artifact;
      const { isValid } = sdkCrypto.verifySignature(signed, signature, senderKey);
      ensure(isValid === true, `signature does not verify with the sender key at ${selector}`);
    }),
    item6Check('document-decrypts-with-receiver-key-at-encryption-selector', async () => {
      const artifact = await item6Artifact();
      ensure(artifact.encryption, 'the document was not encrypted');
      const { data, error } = sdkCrypto.decryptBtpPayload(
        artifact.document,
        artifact.encryption,
        set.oaepWrap.privateKeyPem,
      );
      ensure(!error, `decryption failed: ${error?.message}`);
      ensure(
        JSON.stringify(data) === JSON.stringify(item6.artifact.document),
        'decrypted a different document',
      );
    }),
  );

  // --- Item 10: SDK defects expressible as data (EBA-122) -----------------
  const defects = set.sdkDefects;
  for (const c of defects.gcmTag.cases) {
    checks.push({
      id: `sdk/item-10/gcm-tag/${c.name}`,
      item: 10,
      tickets: defects.tickets,
      run() {
        let result;
        try {
          result = sdkCrypto.decryptBtpPayload(
            defects.gcmTag.data,
            c.encryption,
            set.oaepWrap.privateKeyPem,
          );
        } catch (error) {
          result = { error };
        }
        if (c.expect === 'accept') {
          ensure(!result.error, `a full-length tag was refused: ${result.error?.message}`);
          ensure(
            JSON.stringify(result.data) === defects.gcmTag.plaintext,
            'decrypted a different plaintext',
          );
        } else {
          const bytes = Buffer.from(c.encryption.authTag, 'base64').length;
          ensure(
            result.error && result.data === undefined,
            `a ${bytes}-byte GCM tag was accepted; 16 bytes are required`,
          );
        }
      },
    });
  }
  for (const c of defects.identities) {
    checks.push({
      id: `sdk/item-10/identity/${c.expect}/${c.input}`,
      item: 10,
      tickets: defects.tickets,
      run() {
        const parsed = utils.parseIdentity(c.input);
        if (c.expect === 'accept') ensure(parsed, `${c.input} was rejected`);
        else ensure(parsed === null, `${c.input} was accepted as ${JSON.stringify(parsed)}`);
      },
    });
  }

  return checks;
}
