---
title: Migrating from 1.1 to 1.2
sidebar_label: Migrating from 1.1
slug: /whats-new/1-2/migration
---

# Migrating from 1.1 to 1.2

A 1.1 provider upgrades to 1.2 without changing what it sends. A 1.2 server and client take 1.1 artifacts and talk to 1.1 providers. A 1.2 sender stamps an artifact `1.1.0` unless it uses something only 1.2 has. A trust record without `permissions` is checked exactly as 1.1 checks it. So the upgrade itself is small; adopting what 1.2 adds is a series of separate, later steps, each one switched on when you are ready for it.

This page is our recommendation for doing it safely: what changes for you, the order to upgrade in, and the order to adopt the new features in. Every TypeScript sample here is typechecked against the 1.2 SDK by its own tests.

## Before you start

### What 1.2 changes for you

**If you run a BTPS server (a platform):**

- [ ] `send` (and `transport`) return an `error` beside the `response` when a receiver refuses the artifact's version.
- [ ] `decryptVerify` refuses every signature that does not verify.
- [ ] With `onError`, failed artifacts are no longer also written to `console.error`.
- [ ] An error you throw, or pass on as caught, reaches the sender only as a BTPS constant, else as the generic 500.
- [ ] A connection that sends 10 unreadable lines in a row is answered and ended (`maxConsecutiveInvalidLines`).
- [ ] `isKnownArtifact` is also asked about the `DETAILS_REQ` a `DETAILS_RES` answers.
- [ ] Your `TokenStore` can add `isConsumed` and `markSuccessor`, and record `consumedAt`, to detect stolen refresh tokens.
- [ ] The refusals for what 1.2 adds (event chains, details responses, agreement order, details request limits) are middleware you register.

**If you build a client or a device app:**

- [ ] `send`'s `error` beside the `response`, as above.
- [ ] `getConnectionStates().isDraining` is always `false`.
- [ ] You can pin your provider's answers with `requireSignedBy`, once your provider signs them.

**If you only use the SDK's functions** (`signEncrypt`, `decryptVerify`, the trust helpers):

- [ ] `decryptVerify` refuses every bad signature, as above.
- [ ] `signEncrypt` stamps the version for you, and sends a trust request with permissions as 1.1 allows to a 1.1 server unless you set `versionFallback: false`.

### What stays the same

- Every 1.1 artifact you send or receive. A 1.2 provider takes `1.1.x` artifacts, and sends `1.1.0` whenever nothing 1.2 is in it.
- Every 1.1 peer. A 1.1.3 provider and a 1.2 provider talk both ways; the versions journey proves it against the published 1.1.3 SDK.
- Every existing trust. A trust record without `permissions` is all or nothing, as in 1.1: nothing to migrate.
- Your trust store's abstract methods: `AbstractTrustStore` has none new to implement.

## Upgrade, step by step

Each step can be rolled back on its own until step 5. Up to there, everything 1.2 writes is either optional or ignored by your own 1.1 code.

### 1. Bump the SDK

```sh
yarn add @btps/sdk@next     # the release candidate
yarn add @btps/sdk@^1.2.0   # once 1.2.0 is released
```

**Rollback:** pin `@btps/sdk@1.1.3` again. Nothing you send has changed: with no 1.2 feature in use, every artifact is still stamped `1.1.0`.

### 2. Build, and run your tests

The new store methods and options are optional, so a 1.1 build compiles. Then run your own tests, and look for these, the only 1.2 changes that reach code written for 1.1:

| Change                                                                         | What to check                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `send` returns `error` beside `response` when the receiver refuses its version | 1.1 returned the response alone. Code that checks `error` first now takes that path: handle `BTP_ERROR_VERSION_UNSUPPORTED`, whose `meta.receiverVersion` is the version the receiver speaks                                                         |
| `decryptVerify` refuses every signature that does not verify                   | Before, one that failed without an error object went on to be decrypted. A test fixture with a broken signature that used to pass now fails, rightly                                                                                                 |
| `onError` replaces `console.error`                                             | With `onError` (the option or `onError` middleware), a failed artifact is no longer also written to `console.error`. If your logs came from there, log in `onError`                                                                                  |
| `getConnectionStates().isDraining` is always `false`                           | The client no longer queues what the socket buffers. Remove any back-off that waited on it                                                                                                                                                           |
| What `res.sendError` sends                                                     | A plain `{ code, message, status }` of your own goes as given. An error thrown, or caught and passed on, goes only as a BTPS constant, else as the generic 500. A caught database error passed to it goes out as a 500: send your own answer instead |
| `maxConsecutiveInvalidLines`, default 10                                       | A connection that sends 10 unreadable lines in a row is answered, with `status.closing`, and ended. Raise it only if you have a client that legitimately does that                                                                                   |
| `isKnownArtifact` is asked about a `DETAILS_RES`'s request                     | It is asked whether the `DETAILS_REQ` named in `relatesTo` passed between the two. If you will send details requests, record them, or every answer to them is refused                                                                                |

Handling a version refusal:

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

| #   | Feature                                                                                                         | Safe to turn on when                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `keyResolver` with a cache ([Your platform's checks](../features/platformChecks.md#caching-key-lookups))        | any time: nothing on the wire changes. Cache only keys found, so a newly published key is found at once                                         |
| 2   | `signAnswers` on your server ([Devices](../features/devices.md#signed-answers-and-a-device-that-requires-them)) | `serverIdentity` is your domain's operator and has its `selector`. A 1.1 client reads a signed answer as any other                              |
| 3   | `requireSignedBy` in your apps                                                                                  | every server those apps talk to signs its answers (step 2), in every environment they connect to                                                |
| 4   | The token store methods (above), then `maxKeyAgeMs`                                                             | the methods: at once. A maximum key age: only once your apps rotate keys ([Refresh tokens](../features/refreshTokens.md))                       |
| 5   | [Withdrawing proposals](../features/withdrawingProposals.md)                                                    | `eventChainCheck` is registered with `getEvent`, and your invoice views show a withdrawn proposal as closed                                     |
| 6   | [Trust permissions](../features/trustPermissions.md) for new trusts                                             | step 5 of the upgrade is done, and your app shows the receiver what it grants. To a 1.1 server, a request goes as 1.1 allows                    |
| 7   | [Document types on sends](../features/documentTypes.md)                                                         | comes with 6: every send under a trust with permissions names its `documentType`                                                                |
| 8   | [Details refresh](../features/detailsRefresh.md)                                                                | trusts with permissions exist, `isKnownArtifact` knows your `DETAILS_REQ`s, and `detailsResponseCheck` and `detailsRequestLimit` are registered |
| 9   | [Verification](../features/verification.md)                                                                     | you have a process for checking who your senders are, and a list of verifiers you trust                                                         |
| 10  | [Notes, discounts and templates](../features/notesDiscountsTemplates.md)                                        | the receivers you send them to run 1.2; to a 1.1 server they are refused, never shaped                                                          |
| 11  | [Agreements](../features/agreements.md) and [evidence bundles](../features/evidenceBundles.md)                  | last: trusts grant `send:agreement`, `agreementOrderCheck` is registered, and you keep every answer to build a bundle from                      |

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

## Verify your upgrade

- [ ] Your tests pass, and each row of [step 2](#2-build-and-run-your-tests) is handled.
- [ ] `onError` logs every failed artifact, and you see them.
- [ ] A refresh token used twice revokes the device and fires `refreshTokenReused`; two refreshes at once do not.
- [ ] The four middleware are registered: a `withdrawn` sent by the invoice's issuer is refused with `BTP_ERROR_EVENT_CHAIN`.
- [ ] Your `res.sendError` calls send your own `{ code, message, status }`, never a caught error.
- [ ] An invoice to a 1.1 provider is still delivered, stamped `1.1.0`.

### Common mistakes

- **Registering no middleware.** The server takes a `withdrawn` from the invoice's own issuer, a `DETAILS_RES` naming details you never asked for, and an agreement answer out of turn. Nothing says so: register the four checks in step 4.
- **A custom `TokenStore` with `isConsumed` but no `consumedAt`.** Two refreshes at once from a device on a bad connection revoke it. Set `consumedAt` in the same statement that consumes the token.
- **Passing a caught error to `res.sendError`.** A database's duplicate-key error goes out as the generic 500, its detail kept on your server. Send your own answer, such as `{ code: 'PROVIDER_ALREADY_RECEIVED', message, status: 409 }`.
- **Not recording the details requests you send.** `isKnownArtifact` is asked about each one a `DETAILS_RES` answers; without the record, every answer is refused.
- **Turning on `requireSignedBy` before every server signs.** The app refuses every unsigned answer, from a server you have not upgraded yet.

Every change is in the [changelog](https://github.com/openbtps/btps-node/blob/release/1.2/CHANGELOG.md).
