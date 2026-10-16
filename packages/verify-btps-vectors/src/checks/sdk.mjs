/**
 * SDK conformance checks: the vectors run against @btps/sdk itself, loaded
 * from a source tree (see sdk-loader.mjs).
 *
 * The canonical-signing (sdk/jcs), selector (sdk/selectors) and defect
 * (sdk/defects) checks are regression proof: on the 367cd09 baseline they
 * fail, and the BTPS 1.1 fixes turn them green. The KMS interop checks
 * already pass on the baseline and must stay passing.
 *
 * Only the SDK's *public* exports are called, and every call that depends on
 * an API shape a fix may change sits in one adapter below, marked.
 */

import crypto from 'node:crypto';
import { oaepDecrypt } from '../oaep-reference.mjs';
import { createWebRuntime } from '../runtimes/web.mjs';
import { ensure, ensureRejects } from '../check.mjs';

const pemToTxtBase64 = (pem) =>
  pem.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '').replace(/\s+/g, '');

/**
 * ADAPTER — the separate-selectors call shape. On 367cd09 the caller passes
 * one `selector` (the receiver's) in the payload, and `sender` has no
 * selector at all. The sender's selector is offered two ways a 1.1 SDK might
 * read it — on the sender object and in the sender domain's _btps.host
 * record — so the check does not dictate the 1.1 API. If the separate
 * selectors change how a caller asks for encryption, update this function in
 * the same change.
 */
async function produceSelectorsArtifact(sdk, vector) {
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

/** The DNS zone the selectors vector describes, in the TXT format 367cd09 reads. */
function selectorsZone(vector, receiverPublicKeyPem) {
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

  // --- Canonical signing -------------------------------------------------
  for (const v of [set.managedSignature, set.selfHeldSignature]) {
    const signature = {
      algorithmHash: 'sha256',
      value: v.signatureBase64,
      fingerprint: v.fingerprint,
    };
    checks.push(
      {
        id: `sdk/jcs/${v.custody}/verifySignature-accepts-reordered-payload`,
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
        id: `sdk/jcs/${v.custody}/signBtpPayload-signs-canonical-bytes`,
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
    id: 'sdk/jcs/verifySignature-rejects-duplicate-member-names',
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

  const jcsKey = set.managedSignature;
  for (const c of set.jcsSignature.cases) {
    const signature = {
      algorithmHash: 'sha256',
      value: c.signatureBase64,
      fingerprint: jcsKey.fingerprint,
    };
    const verify = (payload) => {
      try {
        return sdkCrypto.verifySignature(payload, signature, jcsKey.publicKeyPem);
      } catch (error) {
        return { isValid: false, error }; // throwing is a rejection
      }
    };
    if (c.expect === 'reject') {
      checks.push({
        id: `sdk/jcs/jcs-signature/${c.name}`,
        run() {
          for (const input of c.inputs) {
            ensure(
              verify(input).isValid !== true,
              `a payload with duplicate member names verified as signed: ${input}`,
            );
          }
        },
      });
      continue;
    }
    checks.push({
      id: `sdk/jcs/jcs-signature/${c.name}`,
      run() {
        c.inputs.forEach((input, i) => {
          for (const [form, payload] of [
            ['JSON text', input],
            ['object', JSON.parse(input)],
          ]) {
            const { isValid, error } = verify(payload);
            ensure(
              isValid === true,
              `input ${i} as ${form} did not verify (${error?.message ?? 'no error'})`,
            );
          }
          const signed = sdkCrypto.signBtpPayload(JSON.parse(input), {
            publicKey: jcsKey.publicKeyPem,
            privateKey: jcsKey.privateKeyPem,
          });
          ensure(
            signed.value === c.signatureBase64,
            `signing input ${i} did not reproduce the signature over the JCS form`,
          );
        });
      },
    });
  }

  // --- Separate signature and encryption selectors ------------------------
  const selectors = set.selectors;
  let artifactPromise;
  const selectorsArtifact = () => {
    artifactPromise ??= (async () => {
      sdk.setTxtRecords(selectorsZone(selectors, set.oaepWrap.publicKeyPem));
      const { payload, error } = await produceSelectorsArtifact(sdk, selectors);
      if (error || !payload)
        throw new Error(`signEncrypt failed: ${error?.message ?? 'no payload'}`);
      return payload;
    })();
    return artifactPromise;
  };
  const selectorsCheck = (name, run) => ({
    id: `sdk/selectors/${name}`,
    run,
  });

  checks.push(
    selectorsCheck('artifact-names-signature-selector', async () => {
      const artifact = await selectorsArtifact();
      ensure(
        artifact.signatureSelector === selectors.expect.signatureSelector,
        `signatureSelector is ${JSON.stringify(artifact.signatureSelector)}, expected "${selectors.expect.signatureSelector}" (selector=${JSON.stringify(artifact.selector)})`,
      );
    }),
    selectorsCheck('artifact-names-encryption-selector', async () => {
      const artifact = await selectorsArtifact();
      ensure(
        artifact.encryptionSelector === selectors.expect.encryptionSelector,
        `encryptionSelector is ${JSON.stringify(artifact.encryptionSelector)}, expected "${selectors.expect.encryptionSelector}"`,
      );
    }),
    selectorsCheck('signature-verifies-with-sender-key-at-signature-selector', async () => {
      const artifact = await selectorsArtifact();
      const selector = artifact.signatureSelector;
      ensure(
        typeof selector === 'string',
        `the artifact does not name the sender's signing key; its one selector (${JSON.stringify(artifact.selector)}) is the receiver's, and the sender key there is the rotated-out one`,
      );
      const senderKey = await utils.resolvePublicKey(selectors.sender.identity, selector);
      ensure(senderKey, `no sender key published at ${selector}`);
      const { signature, ...signed } = artifact;
      const { isValid } = sdkCrypto.verifySignature(signed, signature, senderKey);
      ensure(isValid === true, `signature does not verify with the sender key at ${selector}`);
    }),
    selectorsCheck('document-decrypts-with-receiver-key-at-encryption-selector', async () => {
      const artifact = await selectorsArtifact();
      ensure(artifact.encryption, 'the document was not encrypted');
      const { data, error } = sdkCrypto.decryptBtpPayload(
        artifact.document,
        artifact.encryption,
        set.oaepWrap.privateKeyPem,
      );
      ensure(!error, `decryption failed: ${error?.message}`);
      ensure(
        JSON.stringify(data) === JSON.stringify(selectors.artifact.document),
        'decrypted a different document',
      );
    }),
  );

  // --- SDK defects expressible as data ------------------------------------
  const defects = set.sdkDefects;
  for (const c of defects.gcmTag.cases) {
    checks.push({
      id: `sdk/defects/gcm-tag/${c.name}`,
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
      id: `sdk/defects/identity/${c.expect}/${c.input}`,
      run() {
        const parsed = utils.parseIdentity(c.input);
        if (c.expect === 'accept') ensure(parsed, `${c.input} was rejected`);
        else ensure(parsed === null, `${c.input} was accepted as ${JSON.stringify(parsed)}`);
      },
    });
  }

  return checks;
}
