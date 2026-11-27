---
title: Migrating from 1.1 to 1.2
sidebar_label: Migrating from 1.1
slug: /whats-new/1-2/migration
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Migrating from 1.1 to 1.2

A 1.1 provider upgrades to 1.2 without changing what it sends. A 1.2 server and client take 1.1 artifacts and talk to 1.1 providers. A 1.2 sender stamps an artifact `1.1.0` unless it uses something only 1.2 has. A trust record without `permissions` is checked exactly as 1.1 checks it. So the upgrade itself is small; adopting what 1.2 adds is a series of separate, later steps, each one switched on when you are ready for it.

This page is our recommendation for doing it safely: what changes for you, the order to upgrade in, and the order to adopt the new features in. Every 1.2 TypeScript sample here is typechecked against the 1.2 SDK by its own tests; a 1.1 sample, shown for comparison, is marked `// 1.1`.

Already on a 1.2 release candidate and using agreements? rc.4 changes how their answers travel: see [From an earlier 1.2 release candidate](#from-an-earlier-12-release-candidate).

## Before you start

### What 1.2 changes for you

**If you run a BTPS server (a platform):**

- [ ] `send` (and `transport`) return an `error` beside the `response` when a receiver refuses the artifact's version.
- [ ] `decryptVerify` refuses every signature that does not verify.
- [ ] With `onError`, failed artifacts are no longer also written to `console.error`.
- [ ] An error you throw, or pass on as caught, reaches the sender only as a BTPS constant, else as the generic 500.
- [ ] A connection that sends 10 unreadable lines in a row is answered and ended (`maxConsecutiveInvalidLines`).
- [ ] `isKnownArtifact` is also asked about the `DETAILS_REQ` a `DETAILS_RES` answers.
- [ ] An answer you build in a shape no answer allows goes to its sender as a generic `btps_error`, and the connection stays open.
- [ ] A refresh never makes a revoked or blocked device accepted again, and `keyHistory[].firstSeen` is when a retired key came into use.
- [ ] Your `TokenStore` can add `isConsumed` and `markSuccessor`, and record `consumedAt`, to detect stolen refresh tokens.
- [ ] The refusals for what 1.2 adds (event chains, details responses, agreement order, details request limits) are middleware you register.
- [ ] Each arriving key is checked against its identity's key chain, from its host: a key rotated away is refused past `retiredKeyGraceSeconds` (`BTP_ERROR_KEY_RETIRED`), an expired one at once (`BTP_ERROR_KEY_REVOKED`). A key whose identity never rotated is checked by DNS, as in 1.1.
- [ ] Rotating a key is a signed record in its chain, with rules for your DNS records and old private keys ([Rotating keys](#rotating-keys)).
- [ ] Three exports are removed: `BtpsServerSyncFactory` (`@btps/sdk/server/core`), and `InMemoryQueue` and `BTPSMessageQueue` (`@btps/sdk/server`).

**If you build a client or a device app:**

- [ ] `send`'s `error` beside the `response`, as above.
- [ ] `getConnectionStates().isDraining` is always `false`.
- [ ] An artifact stamped lower than what it uses is refused before it is sent.
- [ ] An identity lookup's answer is refused unless it answers this lookup, is fresh, and names the identity asked about.
- [ ] You can pin your provider's answers with `requireSignedBy`, once your provider signs them.

**If you only use the SDK's functions** (`signEncrypt`, `decryptVerify`, the trust helpers):

- [ ] `decryptVerify` refuses every bad signature, as above.
- [ ] `signEncrypt` signs the `version` it is given: stamp it with `artifactVersion` (`@btps/sdk/server`). It sends a trust request with permissions as 1.1 allows to a 1.1 server unless you set `versionFallback: false`.

### What stays the same

- Every 1.1 artifact you send or receive. A 1.2 provider takes `1.1.x` artifacts, and sends `1.1.0` whenever nothing 1.2 is in it.
- Every 1.1 peer. A 1.1.3 provider and a 1.2 provider talk both ways; the versions journey proves it against the published 1.1.3 SDK.
- Every existing trust. A trust record without `permissions` is all or nothing, as in 1.1: nothing to migrate.
- Your trust store's abstract methods: `AbstractTrustStore` has none new to implement.
- `encryptBtpPayload`, `decryptBtpPayload` and `decryptBtpPayloadWithDecrypter`, and the payloads they write and read. The stream functions 1.2 adds beside them ([Large payloads, a piece at a time](../protocol/security/decryption.md#large-payloads-a-piece-at-a-time)) are optional and need no migration: they read and write the same artifacts.
- `signBtpPayload`, `verifySignature`, `decryptBtpPayload`, `signEncrypt` and `decryptVerify` keep their API, results and errors. They are lighter on a large document ([Lighter whole functions](../protocol/security/decryption.md#lighter-whole-functions)), with nothing to change. A signature made by `signBtpPayloadStream` verifies with `verifySignature`, and one made by `signBtpPayload` with `verifySignatureStream`.
- Your own `Signer`. `signDigest` is optional, and only `signBtpPayloadStreamWithSigner` needs it.

## Upgrade, step by step

Each step can be rolled back on its own until step 5. Up to there, everything 1.2 writes is either optional or ignored by your own 1.1 code.

### 1. Bump the SDK

<Tabs groupId="package-manager">
<TabItem value="npm" label="npm">

```bash
npm install @btps/sdk@next     # the release candidate
npm install @btps/sdk@^1.2.0   # once 1.2.0 is released
```

</TabItem>
<TabItem value="yarn" label="yarn">

```bash
yarn add @btps/sdk@next     # the release candidate
yarn add @btps/sdk@^1.2.0   # once 1.2.0 is released
```

</TabItem>
<TabItem value="pnpm" label="pnpm">

```bash
pnpm add @btps/sdk@next     # the release candidate
pnpm add @btps/sdk@^1.2.0   # once 1.2.0 is released
```

</TabItem>
</Tabs>

**Rollback:** pin `@btps/sdk@1.1.3` again. Nothing you send has changed: with no 1.2 feature in use, every artifact is still stamped `1.1.0`.

### 2. Build, and run your tests

The new store methods and options are optional, so a 1.1 build compiles, unless it imports one of the three exports 1.2 removes (the first row below). Then run your own tests, and look for these, the only 1.2 changes that reach code written for 1.1:

| Change                                                                         | What to check                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BtpsServerSyncFactory`, `InMemoryQueue` and `BTPSMessageQueue` are removed    | An import of one fails to build. `BtpsServerSyncFactory` was a copy of `BtpsServerLightweightFactory`: use that, with the same `create` and `reset`. The queues were unused by the SDK, and the server keeps no queue: keep artifacts in your own queue or outbox                                                                                               |
| `send` returns `error` beside `response` when the receiver refuses its version | 1.1 returned the response alone. Code that checks `error` first now takes that path: handle `BTP_ERROR_VERSION_UNSUPPORTED`, whose `meta.receiverVersion` is the version the receiver speaks                                                                                                                                                                    |
| `decryptVerify` refuses every signature that does not verify                   | Before, one that failed without an error object went on to be decrypted. A test fixture with a broken signature that used to pass now fails, rightly                                                                                                                                                                                                            |
| `onError` replaces `console.error`                                             | With `onError` (the option or `onError` middleware), a failed artifact is no longer also written to `console.error`. If your logs came from there, log in `onError`                                                                                                                                                                                             |
| `getConnectionStates().isDraining` is always `false`                           | The client no longer queues what the socket buffers. Remove any back-off that waited on it                                                                                                                                                                                                                                                                      |
| What `res.sendError` sends                                                     | A plain `{ code, message, status }` of your own goes as given. An error thrown, or caught and passed on, goes only as a BTPS constant, else as the generic 500. A caught database error passed to it goes out as a 500: send your own answer instead                                                                                                            |
| `maxConsecutiveInvalidLines`, default 10                                       | A connection that sends 10 unreadable lines in a row is answered, with `status.closing`, and ended. Raise it only if you have a client that legitimately does that                                                                                                                                                                                              |
| `isKnownArtifact` is asked about a `DETAILS_RES`'s request                     | It is asked whether the `DETAILS_REQ` named in `relatesTo` passed between the two. If you will send details requests, record them, or every answer to them is refused                                                                                                                                                                                           |
| A client refuses an artifact stamped lower than it needs                       | An artifact you build yourself, stamped `1.1.0` but using something 1.2 adds, is refused before it is sent, with `BTP_ERROR_VALIDATION` ("stamped 1.1.0, but it uses what 1.2.0 adds"); so is an agent artifact stamped lower than the artifact it carries. Stamp with `artifactVersion` (`@btps/sdk/server`): the agent stamps for you, `signEncrypt` does not |
| Identity lookup answers are checked                                            | A lookup goes out as `1.2.0`, and again as `1.1.0` when a 1.1 host refuses the version. A 1.2 host's answer is refused (`BTP_ERROR_VALIDATION`) unless it answers this lookup (`reqId`), is fresh (`issuedAt` within 300 seconds) and names the identity asked about. A host whose clock is more than 300 seconds out is refused                                |
| `keyHistory[].firstSeen`                                                       | It is when the retired key came into use: when the key before it was retired, or when the device registered. It was the time of the key's last refresh. Code that read it as the last refresh reads the start of the key's use                                                                                                                                  |
| A refresh never reactivates a device                                           | A revoked or blocked device stays revoked or blocked after a refresh. A test that relied on a refresh to let one back in now fails                                                                                                                                                                                                                              |
| An answer in a shape no answer allows                                          | An answer your platform builds that no answer schema allows reaches its sender as a generic `btps_error` against its request's `reqId`, and the connection stays open. It was closed without an answer. `onError` still receives it                                                                                                                             |

Handling a version refusal. Before, in 1.1, a refusal came back as a `response` with `status.ok: false` and no `error`:

```ts
// 1.1
const { response, error } = await transporter.transport(to, artifact);
if (error) throw error;
return response?.status.ok ? 'delivered' : 'refused';
```

In 1.2 the same refusal is an `error`, beside the `response`, so check it first:

```ts check
import { BtpsTransporter } from '@btps/sdk/client';
import { BTP_ERROR_VERSION_UNSUPPORTED } from '@btps/sdk/error';
import type { BTPTransporterArtifact } from '@btps/sdk/server';

export async function deliver(
  transporter: BtpsTransporter,
  to: string,
  artifact: BTPTransporterArtifact,
): Promise<'delivered' | 'refused' | 'older receiver'> {
  const { response, error } = await transporter.transport(to, artifact);
  if (error?.code === BTP_ERROR_VERSION_UNSUPPORTED.code) {
    // Not delivered: the receiver speaks an older version (error.meta.receiverVersion).
    // Send it again without what only the newer version has, or tell your user.
    return 'older receiver';
  }
  if (error) throw error;
  return response?.status.ok ? 'delivered' : 'refused';
}
```

**Rollback:** as step 1.

### 3. Give your token store the new methods

A device keeps its session with a refresh token, rotated on every refresh. With the new methods, a token used twice (which only a copy of it can do) revokes the device and fires `refreshTokenReused`, and a device that lost the answer to its refresh can ask again inside `refreshGraceMs` (default 30 s).

| Your store has                                       | You get                                                                                                              |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| neither method                                       | as 1.1: a second use is refused as an unknown token; no revocation, no grace window; `BtpsAuthentication` warns once |
| `isConsumed`, with `consumedAt` on the consumed mark | a second use revokes the device; a refresh racing the first is told to try again                                     |
| `isConsumed` **without** `consumedAt`                | a refresh racing the first is taken for theft, and the device is revoked. **Don't ship this**                        |
| `isConsumed` and `markSuccessor`                     | all of the above, and the grace window                                                                               |

`consume` keeps the token as a consumed mark, with when it was taken; `isConsumed` returns that mark until the token would have expired; `markSuccessor` keeps the sealed answer on it. Storing the same token again clears the mark. Over your own table:

```ts check
import type { BTPSealedSuccessor, BTPsTokenDocument, TokenStore } from '@btps/sdk/authentication';

// Your table of refresh tokens, where a consumed token stays as its mark until it would have expired.
export interface RefreshTokenRows {
  // One atomic statement: take an unconsumed, unexpired token and set its consumed_at, e.g.
  // UPDATE ... SET consumed_at = $3 WHERE agent_id = $1 AND token = $2 AND consumed_at IS NULL
  //   AND expires_at > now() RETURNING *
  takeOnce(
    agentId: string,
    token: string,
    consumedAt: string,
  ): Promise<BTPsTokenDocument | undefined>;
  // A consumed, unexpired token, with its consumedAt and successor
  findConsumed(agentId: string, token: string): Promise<BTPsTokenDocument | undefined>;
  setSuccessor(agentId: string, token: string, successor: BTPSealedSuccessor): Promise<void>;
}

export const consumedMarks = (
  rows: RefreshTokenRows,
): Pick<TokenStore, 'consume' | 'isConsumed' | 'markSuccessor'> => ({
  consume: (agentId, token) => rows.takeOnce(agentId, token, new Date().toISOString()),
  isConsumed: (agentId, token) => rows.findConsumed(agentId, token),
  markSuccessor: (agentId, token, successor) => rows.setSuccessor(agentId, token, successor),
});
```

The successor is sealed under a key derived from the old token, never the new token in plain text. `InMemoryTokenStore` has all of this, and is the reference.

**Rollback:** remove the two methods: the store works as in 1.1. The kept marks are extra rows; delete them or let them expire.

### 4. Register the checks 1.2 leaves to you

A 1.2 server checks structure, signatures, the trust and its permissions, and `isKnownArtifact`, and reads no other record of yours. The refusals for what 1.2 adds need records only your platform keeps, so each is middleware you register with your own lookup. **Without it, the artifact is taken**, and checking it is yours.

| Register                                | When you need it                                           | Refuses                                                                     |
| --------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| `eventChainCheck({ getEvent })`         | you take lifecycle events about invoices: **every biller** | `BTP_ERROR_EVENT_CHAIN`: a `withdrawn` or `follows` that breaks the chain   |
| `detailsResponseCheck({ getArtifact })` | you send details requests                                  | `BTP_ERROR_PERMISSION`: a `DETAILS_RES` naming what its request did not ask |
| `agreementOrderCheck({ answers })`      | you send agreements signed in turn                         | `BTP_ERROR_AGREEMENT_ORDER`: an answer out of turn                          |
| `detailsRequestLimit(allow)`            | you answer details requests                                | `BTP_ERROR_DETAILS_RATE_LIMITED`: a `DETAILS_REQ` over your own limit       |

Register all four now, even before you use the features: a 1.2 peer can send you a `withdrawn` or a `DETAILS_REQ` from the day you upgrade. Each lookup reads your own records:

```ts check
import {
  agreementOrderCheck,
  detailsRequestLimit,
  detailsResponseCheck,
  eventChainCheck,
  type BTPAgreementAnswersLookup,
  type BTPArtifactLookup,
  type BTPDetailsRequestAllowance,
  type BTPEventLookup,
} from '@btps/sdk/server/core';

export type PlatformLookups = {
  // An earlier event between the two parties: { eventType, from, state, document: { from, id } }
  getEvent: BTPEventLookup;
  // The envelope of a DETAILS_REQ you sent
  getArtifact: BTPArtifactLookup;
  // An agreement's signers, its order, and the answers taken so far
  answers: BTPAgreementAnswersLookup;
  // Your own limit on details requests: true, or { retryAfter } in whole seconds
  allow: BTPDetailsRequestAllowance;
};

export const platformChecks = ({ getEvent, getArtifact, answers, allow }: PlatformLookups) => [
  eventChainCheck({ getEvent }),
  detailsResponseCheck({ getArtifact }),
  agreementOrderCheck({ answers }),
  // Last, so it counts only what every other check took.
  detailsRequestLimit(allow),
];
```

Return them from your middleware file's default export (`middlewarePath`), beside your own middleware. Each runs after the server's trust check and refuses from the envelope, without opening anything. For an encrypted event, run the same rules once you open it, with `lifecycleEventChainProblem` from `@btps/sdk/server`. [Your platform's checks](../features/platformChecks.md) has the details.

**Rollback:** unregister them. Nothing is stored.

### 5. Store the new trust record fields

From here on, your platform writes data only 1.2 reads, so roll back by restoring a backup, not by pinning the SDK. Take this step when you adopt [trust permissions](../features/trustPermissions.md), not before.

A trust record may carry `permissions`: what the request asked for, what was granted, which details each side holds, and `pendingChange` while a change to an active trust waits for its user. Your platform writes it, from `trustPermissionsFromRequest` and `trustPermissionsFromResponse` (`@btps/sdk/trust`); the server only reads it. Persist it as one JSON value on the record:

```json btps=permissions
{
  "requested": [
    { "name": "send:invoice", "required": true },
    { "name": "detail:legalName", "required": true }
  ],
  "granted": ["send:invoice", "detail:legalName"],
  "detailsHeld": ["detail:legalName"],
  "detailsShared": [],
  "pendingChange": {
    "requested": [
      { "name": "send:invoice", "required": true },
      { "name": "send:receipt", "required": false },
      { "name": "detail:legalName", "required": true }
    ],
    "requestedAt": "2026-11-08T00:00:00.000Z"
  }
}
```

**Existing trusts need no migration.** A record without `permissions` stays an all-or-nothing trust. To give one permissions, either side sends a change once both run 1.2 ([Changing a trust later](../features/trustPermissions.md#changing-a-trust-later)).

## Adopting the new features

Turn them on one at a time, in this order. Each is safe to turn on when its condition holds, and none needs the next.

| #   | Feature                                                                                                         | Safe to turn on when                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `keyResolver` with a cache ([Your platform's checks](../features/platformChecks.md#caching-key-lookups))        | any time: nothing on the wire changes. Cache only keys found, so a newly published key is found at once                                                                                                                                                                                                                                                                                                                   |
| 2   | `signAnswers` on your server ([Devices](../features/devices.md#signed-answers-and-a-device-that-requires-them)) | `serverIdentity` is your domain's operator and has its `selector`. A 1.1 client reads a signed answer as any other                                                                                                                                                                                                                                                                                                        |
| 3   | `requireSignedBy` in your apps                                                                                  | every server those apps talk to signs its answers (step 2), in every environment they connect to                                                                                                                                                                                                                                                                                                                          |
| 4   | The token store methods (above), then `maxKeyAgeMs`                                                             | the methods: at once. A maximum key age: only once your apps rotate keys ([Refresh tokens](../features/refreshTokens.md))                                                                                                                                                                                                                                                                                                 |
| 5   | [Withdrawing proposals](../features/withdrawingProposals.md)                                                    | `eventChainCheck` is registered with `getEvent`, and your invoice views show a withdrawn proposal as closed                                                                                                                                                                                                                                                                                                               |
| 6   | [Trust permissions](../features/trustPermissions.md) for new trusts                                             | step 5 of the upgrade is done, and your app shows the receiver what it grants. To a 1.1 server, a request goes as 1.1 allows. If you host organisations, give your server `entityTypeOf`, so people asking them are not held to give their own details                                                                                                                                                                    |
| 7   | [Document types on sends](../features/documentTypes.md)                                                         | comes with 6: every send under a trust with permissions names its `documentType`                                                                                                                                                                                                                                                                                                                                          |
| 8   | [Details refresh](../features/detailsRefresh.md)                                                                | trusts with permissions exist, `isKnownArtifact` knows your `DETAILS_REQ`s, and `detailsResponseCheck` and `detailsRequestLimit` are registered                                                                                                                                                                                                                                                                           |
| 9   | [Verification](../features/verification.md)                                                                     | you have a process for checking who your senders are, and a list of verifiers you trust                                                                                                                                                                                                                                                                                                                                   |
| 10  | [Notes, discounts and BoundView](../features/notesDiscountsTemplates.md)                                        | the receivers you send them to run 1.2; to a 1.1 server they are refused, never shaped. Drop `template` from any document you add them to ([below](#dropping-template))                                                                                                                                                                                                                                                   |
| 11  | [Agreements](../features/agreements.md) and [evidence bundles](../features/evidenceBundles.md)                  | last: trusts grant `send:agreement`, `agreementOrderCheck` is registered, and you keep every answer's cosignature and opened statement to build a bundle from                                                                                                                                                                                                                                                             |
| 12  | [Key rotation](../features/keyRotation.md)                                                                      | your identity store keeps each identity's `keyChain` (`getKeyChain`), and you follow the [rules for rotating keys](#rotating-keys)                                                                                                                                                                                                                                                                                        |
| 13  | [Large payloads, a piece at a time](../protocol/security/decryption.md#large-payloads-a-piece-at-a-time)        | any time, on Node.js: nothing on the wire changes. Use a decrypted piece only once the whole payload has been read without an error, and read an encrypted `payload` to its end before you `await encryption`. Run every check `decryptVerify` and `signEncrypt` run, as in [start to finish](../protocol/security/decryption.md#opening-a-large-artifact-start-to-finish). Signing through a `Signer` needs `signDigest` |

### Dropping `template`

`template` is `1.1.0` only. Nothing changes for a document you leave as it is.

- A document that carries a `template` and nothing from 1.2 is still stamped and sent as `1.1.0`, and works exactly as before.
- Once you add anything from 1.2 to that document (a BoundView, a discount, a note with a format, totals, line roles, a recipient, a signatory, …), it is stamped `1.2.0`, and your own SDK refuses it before sending until `template` is removed.

So drop `template` when you adopt 1.2 features. To keep the document's look, send a [BoundView](../protocol/specifications/boundview/using.md) instead. A BoundView is optional: without one, the receiver shows its own view of the data.

## Rotating keys

Since 1.2, a rotation is a signed record in the identity's key chain, and every 1.2 server checks each arriving key against it ([Key rotation](../features/keyRotation.md)). Four rules keep that safe. Each is yours to follow: the SDK cannot see your DNS records or your stored documents.

**Remove an expired key's DNS record at once.** A server that cannot reach your host for the chain (it is down, or slower than the lookup's 5 seconds to connect and 5 to answer) checks the key by DNS alone, as 1.1 does. Only a removed record refuses a compromised or lost key then. A key rotated away as planned keeps its record for the grace (`retiredKeyGraceSeconds`, a day), and should while you talk to 1.1 peers, which read DNS only.

**Re-publish unchanged keys under a new `s=`.** `s=` is domain-wide: senders look up the key to encrypt to under it, for every address on the domain, and a 1.2 server takes a chain only when its last key is in DNS at its last selector or at `s=`. Before you move it, publish a key under the new selector for every identity on the domain, and for the operator. An identity that is not rotating re-publishes its unchanged key, which needs no rotation record.

**Delete an old private key only once its side-cars open.** Stored documents encrypted to the old key open only with it. Before deleting it, give each one a side-car (`wrapContentKeyFor`) and confirm that every side-car opens its document with the new key (`contentKeyOpens`). [Delete an old private key](../features/keyRotation.md#delete-an-old-private-key) has the code.

**A custom `keyResolver` honours `keyChainMaxCacheSeconds`.** A server keeps a chain for at most `keyChainMaxCacheSeconds` (default 300): the longest a revoked key can still be taken. A `keyResolver` that gives chains (`resolveKeyChain`) keeps its own cache, and must keep each chain no longer. The simplest is to take chains from `createDefaultKeyResolver`, given the same number, and cache only keys yourself:

```ts check
import { createDefaultKeyResolver, type BtpsKeyResolver } from '@btps/sdk/crypto';

// The same number you give BtpsServer as keyChainMaxCacheSeconds.
const KEY_CHAIN_MAX_CACHE_SECONDS = 300;
// Keys are kept for a while too, so a removed record stops counting.
const KEY_CACHE_MS = 5 * 60_000;

const lookup = createDefaultKeyResolver({
  from: 'admin$yourdomain.example', // your server's own identity: it asks hosts for chains as this
  keyChainMaxCacheSeconds: KEY_CHAIN_MAX_CACHE_SECONDS,
});
const keys = new Map<string, { key: string; until: number }>();

export const keyResolver: BtpsKeyResolver = {
  async resolvePublicKey(identity, selector, use) {
    const id = `${identity} ${selector} ${use}`;
    const kept = keys.get(id);
    if (kept && kept.until > Date.now()) return kept.key;
    const key = await lookup.resolvePublicKey(identity, selector, use);
    if (key) keys.set(id, { key, until: Date.now() + KEY_CACHE_MS }); // only keys found
    return key;
  },
  // Chains from the SDK's lookup, each kept for KEY_CHAIN_MAX_CACHE_SECONDS at most.
  resolveKeyChain: lookup.resolveKeyChain,
};
```

A resolver without `resolveKeyChain` leaves chains to the server, which asks for them as its own identity, for no longer than its `keyChainMaxCacheSeconds`.

## Mixed fleets: talking to 1.1 during the transition

You will talk to 1.1 providers for a while. The SDK does most of the work ([Protocol versions](../features/versions.md)):

- **Stamping.** Each artifact goes as `1.1.0` unless it uses something only 1.2 has. An invoice with nothing new in it reaches a 1.1 receiver unchanged.
- **Shaping.** A trust request with permissions asks the receiver's server its version first. To a 1.1 server it goes as 1.1 allows, without the permission fields, and the result's `shaped` says what was left out. Set `versionFallback: false` to be refused instead.
- **Refused.** Anything else stamped `1.2.0` (a discount, an agreement, a `withdrawn`) is refused by a 1.1 server with `BTP_ERROR_VERSION_UNSUPPORTED` and `receiverVersion`, and is not delivered. A details artifact is a type a 1.1 server does not know, refused with `BTP_ERROR_VALIDATION`. Decide per feature what your user sees; don't retry it.

**Check your own implementation against the golden vectors.** The repository's [`test/vectors/`](https://github.com/openbtps/btps-node/tree/release/1.2/test/vectors) are what any 1.1 or 1.2 implementation, in any language, must accept, refuse and reproduce: versions, trust permissions, details, event chains, agreements, documents, signed artifacts. They are written from the specification, not computed by the SDK. From a checkout of the repository, `verify-btps-vectors` runs them against an SDK tree:

```sh
node packages/verify-btps-vectors/bin/verify-btps-vectors.mjs --sdk-root /path/to/your/btps-node
```

An implementation in another language reads the vector files directly; each says in its `description` how to read its cases.

## From an earlier 1.2 release candidate

Since 1.2 (rc.4), an agreement's answers travel as [cosignatures](../protocol/specifications/transporter-artifact.md#cosignatures). 1.2 is not released, so the earlier format is gone, not kept beside the new one. The two do not mix: rc.4 refuses an earlier release candidate's agreements (no `salt`) and answers (a `statement` in the event), and an earlier release candidate refuses rc.4's answers (no `statement`). Upgrade every party to an agreement together, and finish or resend any agreement that is waiting for answers.

**What changes on the wire:**

- An agreement carries `salt`, 32 random bytes, base64, inside its content. One without it is refused, so its `contentSha256` changes.
- An `agreement_event` carries no `statement` or `statements`. The signed statements travel on the artifact's envelope as `cosignatures`: an answer carries exactly its signer's, and a forward the ones it forwards, unchanged.
- A statement carries `artifactId`, the id of the artifact that first delivers it. Its `previous` is the `cosignatureSha256` of the cosignature before it.
- Every server checks each cosignature's signature on receipt and refuses one that does not hold (`BTP_ERROR_SIG_VERIFICATION`). A forwarded cosignature's key is taken by its history: rotated away as planned still holds, compromised never does ([Checking keys on arrival](../protocol/specifications/key-rotation.md#checking-keys-on-arrival)).
- A query result's `agentKey` may carry `cosignatureKeys`, each cosignature's content key wrapped to the device, and its `key` is optional: an unencrypted artifact with cosignatures has `cosignatureKeys` alone.
- An evidence bundle holds `cosignatures` and each one's statement as text in `statements`. Its `timestamps` and `arrivals` name `cosignatureSha256`, not `statementSha256`.

**What changes in code** (`@btps/sdk/trust`):

| Removed in rc.4              | Use instead                                                                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `signStatement`              | `cosign`, with the signer's `selector` and key, and the recipients' public keys                                                        |
| `signStatementOnDevice`      | `cosign`, with the device's key and no `selector`                                                                                      |
| `deviceStatementRecord`      | nothing: the originator adds `delegatedArtifact` to a device's cosignature when it forwards it                                         |
| `statementRecordSha256`      | `cosignatureSha256`                                                                                                                    |
| `statementSignatureFacts`    | nothing to call on receipt: the server checks every cosignature (`cosignaturesProblem`); a bundle's facts are `verifyEvidenceBundle`'s |
| `BTPStatementRecord`         | `BTPCosignature`, with its statement from `decryptVerify`'s `cosigned`                                                                 |
| `BTPStatementSignatureFacts` | the fields of each entry of `BTPEvidenceFacts.statements`                                                                              |

| Changed in rc.4                 | Now                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `agreementStatementProblem`     | takes `answer: { eventType, agreement, cosignature, statement }` and `earlier: { cosignature, statement }[]` |
| `timestampRequest`              | takes the cosignature                                                                                        |
| `signArrival`                   | takes `cosignatureSha256` in place of `statementSha256`                                                      |
| `buildEvidenceBundle`           | takes `cosignatures` and `statements` (the statements `decryptVerify` opened) in place of statement records  |
| `BTPEvidenceFacts.statements[]` | gains `statementMatches`; `decision` is absent when a statement's text is not the one its cosignature signed |

New in rc.4: `cosign`, `cosignatureSha256`, `cosignatureSignedPart`, `cosignaturesProblem` and its key lookup type `BTPCosignatureKeyOf`, `openCosignature`, `statementOfText`, `cosignedStatementText`, `cosignedStatementProblem`, and the types `BTPCosignature` and `BTPCosignatureRecipient`. `decryptVerify` returns `cosigned`, refuses an artifact with a cosignature for the receiver when no `receiverKey` is given, and takes `cosignatureKeys` as a fifth argument. For devices: `BtpsAgent`'s `event.send` takes `options.cosignatures`, `wrapForAgent` wraps each cosignature's key (`agentKey.cosignatureKeys`, its fourth argument naming whose), `openResult` opens them, and `openCosignature` takes a `wrappedKey`. `BTPCosignatureKeyOf` has a fourth parameter, `forwarded`. See the [API reference](../sdk/apiReference.md#cosign-cosignaturesha256-cosignaturesignedpart-cosignedstatementtext) and [Agreements](../features/agreements.md#the-code) for the flow in code.

## Verify your upgrade

- [ ] Your tests pass, and each row of [step 2](#2-build-and-run-your-tests) is handled.
- [ ] `onError` logs every failed artifact, and you see them.
- [ ] A refresh token used twice revokes the device and fires `refreshTokenReused`; two refreshes at once do not.
- [ ] The four middleware are registered: a `withdrawn` sent by the invoice's issuer is refused with `BTP_ERROR_EVENT_CHAIN`.
- [ ] Your `res.sendError` calls send your own `{ code, message, status }`, never a caught error.
- [ ] An invoice to a 1.1 provider is still delivered, stamped `1.1.0`.
- [ ] Your `keyResolver`, if it gives chains, keeps each no longer than your `keyChainMaxCacheSeconds`.

### Common mistakes

- **Registering no middleware.** The server takes a `withdrawn` from the invoice's own issuer, a `DETAILS_RES` naming details you never asked for, and an agreement answer out of turn. Nothing says so: register the four checks in step 4.
- **A custom `TokenStore` with `isConsumed` but no `consumedAt`.** Two refreshes at once from a device on a bad connection revoke it. Set `consumedAt` in the same statement that consumes the token.
- **Passing a caught error to `res.sendError`.** A database's duplicate-key error goes out as the generic 500, its detail kept on your server. Send your own answer, such as `{ code: 'PROVIDER_ALREADY_RECEIVED', message, status: 409 }`.
- **Not recording the details requests you send.** `isKnownArtifact` is asked about each one a `DETAILS_RES` answers; without the record, every answer is refused.
- **Turning on `requireSignedBy` before every server signs.** The app refuses every unsigned answer, from a server you have not upgraded yet.
- **Moving `s=` before every key is published under it.** An identity that did not rotate is no longer found under the new selector, and its chain no longer anchors. Re-publish its unchanged key first.
- **Keeping an expired key's DNS record.** A receiver that cannot reach your host takes the compromised key by DNS. Remove the record when you expire the key.
- **Keeping `template` on a document with 1.2 fields.** Your own SDK refuses it before sending: `template is 1.1.0 only; in 1.2.0 a document's look is its boundView`. Remove `template`, and send a BoundView to keep the look ([Dropping `template`](#dropping-template)).
- **Deleting an old private key before its side-cars open.** Every stored document encrypted to it is lost for good.

Every change is in the [changelog](https://github.com/openbtps/btps-node/blob/release/1.2/CHANGELOG.md).
