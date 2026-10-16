---
title: Wire Errors
sidebar_label: Wire Errors
---

# Wire Errors

Every error a BTPS 1.1 server sends carries three things: a stable string
`code`, a status class in `status.code`, and the fixed `status.message` of
that code. A sender decides whether to retry from the `code`, never from the
message text. BTPS 1.1, fix list 6 (EBA-188).

```json
{
  "version": "1.1.0",
  "status": { "ok": false, "code": 403, "message": "BTPS trust record has expired" },
  "id": "8b0c…",
  "issuedAt": "2026-10-16T00:00:00.000Z",
  "type": "btps_error",
  "code": "BTP_ERROR_TRUST_EXPIRED",
  "reqId": "the-request-id"
}
```

The table lives in one place in the SDK, `BTP_WIRE_ERRORS` in
`@btps/sdk/error`, and `sendBtpsError` sends nothing that is not in it.

## Rules

- **The code is the contract.** `code` and `status.code` are stable; a
  message may be reworded.
- **500 is unexpected only.** An application error is never sent as 500.
  A thrown error whose code is not in the table goes out as
  `BTP_ERROR_UNKNOWN`, 500, with the message `Unknown error`.
- **Nothing internal reaches the wire.** A server sends the code's fixed
  message, never an error's own message: a resolver failure such as
  `queryTxt ESERVFAIL <name>` stays in the server's logs.
- **Retry:** 429, 500 and 503 are retryable; no 4xx is. Each 4xx needs
  something other than time to change: a new artifact (a new `id` and
  `issuedAt`), a new trust, a published key. `BTP_ERROR_ALREADY_RECEIVED` means
  the artifact was delivered before: do not send it again.
- **An unknown code** (a newer peer's) is decided by its status class the
  same way: 429 and 5xx retryable, 4xx not.
- **Trust refusals (EBA-124, option B, 2026-10-06).** Only an expired trust is
  told apart. Never trusted, revoked, blocked, pending, rejected and already
  active all go out as `BTP_ERROR_TRUST_NOT_ALLOWED`, so a sender cannot learn
  that it was blocked. The precise reason stays on the server, in the request
  context's `error`. The table enforces this for middleware too: a middleware
  that answers with `BTP_ERROR_TRUST_REVOKED` sends `BTP_ERROR_TRUST_NOT_ALLOWED`.
- **Middleware written for 1.0** that answers with a bare status, such as
  `sendError({ code: 400, message })`, is sent as that class's constant:
  400 `BTP_ERROR_VALIDATION`, 401 `BTP_ERROR_AUTHENTICATION_INVALID`, 403
  `BTP_ERROR_TRUST_NOT_ALLOWED`, 429 `BTP_ERROR_RATE_LIMITER`. Any other number
  is sent as `BTP_ERROR_UNKNOWN`. Its own message is not sent: answer with a
  constant from `@btps/sdk/error`.

## The SDK client

`BtpsClient.send()` returns a `btps_error` answer as the `response` and also as
the `error`: a `BTPErrorException` whose `code` is the wire code, whose
`meta.status` is `status.code`, and whose `retryable` says whether the same
artifact may be sent again. The client never resends an artifact on an error
answer by itself; the sender decides. Its own connection retry uses the same
table, by code.

Every `BTPErrorException` has `retryable`, from this table by its code.

## Versions

A 1.0 server sent every string-coded error as status 500 with no `code`. 1.0
interop is not a concern: a 1.1 server refuses 1.0 artifacts (release plan,
section 6).

## The table

Every error constant has a row, including those only a client raises; a
test fails when a constant is added without one.

| Code | Status | Retryable | Meaning |
| --- | --- | --- | --- |
| `BTP_ERROR_INVALID_JSON` | 400 | no | The line is not JSON |
| `BTP_ERROR_VALIDATION` | 400 | no | The artifact does not match its schema |
| `BTP_ERROR_DOC_SCHEMA` | 400 | no | The document does not match the document model |
| `BTP_ERROR_CANONICAL_JSON` | 400 | no | The payload cannot be canonicalized (RFC 8785) |
| `BTP_ERROR_IDENTITY` | 400 | no | An identity is not `username$domain` |
| `BTPS_ERROR_ACTION_TYPE` | 400 | no | The action type is not valid |
| `BTP_ERROR_INVALID_ACTION` | 400 | no | An action the server does not answer |
| `BTP_ERROR_UNSUPPORTED_ENCRYPT` | 400 | no | Unsupported encryption algorithm |
| `BTP_ERROR_DECRYPTION_UNINTENDED` | 400 | no | The content was not encrypted for this receiver |
| `BTP_ERROR_MONEY_NOT_INTEGER` | 400 | no | A money amount is not whole minor units |
| `BTP_ERROR_MONEY_CURRENCY_MISMATCH` | 400 | no | Money amounts are in different currencies |
| `BTP_ERROR_MONEY_OUT_OF_RANGE` | 400 | no | A money amount is outside the safe integer range |
| `BTP_ERROR_CLIENT_DESTROYED` | 400 | no | Client only: used after `destroy()` |
| `BTP_ERROR_SIG_VERIFICATION` | 401 | no | The signature does not verify, or the sender has no published key |
| `BTP_ERROR_SIG_MISMATCH` | 401 | no | The key fingerprint does not match |
| `BTP_ERROR_DELEGATION_SIG_VERIFICATION` | 401 | no | The delegation signature does not verify |
| `BTP_ERROR_DELEGATION_INVALID` | 401 | no | The delegation is not valid |
| `BTP_ERROR_ATTESTATION_VERIFICATION` | 401 | no | The attestation does not verify |
| `BTP_ERROR_AUTHENTICATION_INVALID` | 401 | no | Authentication failed |
| `BTP_ERROR_REFRESH_NOT_CURRENT_KEY` | 401 | no | A refresh not signed by the agent's current key |
| `BTP_ERROR_KEY_ROTATION_PROOF` | 401 | no | A key rotation without a valid proof of the new key |
| `BTP_ERROR_IDENTITY_NOT_FOUND` | 401 | no | The host has no key for the address |
| `BTP_ERROR_RESOLVE_DNS` | 401 | no | No BTPS DNS record for the address |
| `BTP_ERROR_RESOLVE_PUBKEY` | 401 | no | No key published; the server's pipeline answers it as `BTP_ERROR_SIG_VERIFICATION` |
| `BTP_ERROR_TRUST_NOT_ALLOWED` | 403 | no | No trust allows this sender (never trusted, revoked, blocked, pending, rejected, already active) |
| `BTP_ERROR_TRUST_EXPIRED` | 403 | no | The trust was accepted and has expired; a new trust request may restore it |
| `BTP_ERROR_TRUST_NON_EXISTENT` | 403 | no | Server side only: sent as `BTP_ERROR_TRUST_NOT_ALLOWED` |
| `BTP_ERROR_TRUST_REVOKED` | 403 | no | Server side only: sent as `BTP_ERROR_TRUST_NOT_ALLOWED` |
| `BTP_ERROR_TRUST_BLOCKED` | 403 | no | Server side only: sent as `BTP_ERROR_TRUST_NOT_ALLOWED` |
| `BTP_ERROR_TRUST_ALREADY_ACTIVE` | 403 | no | Server side only: sent as `BTP_ERROR_TRUST_NOT_ALLOWED` |
| `BTP_ERROR_ISSUED_AT_WINDOW` | 403 | no | `issuedAt` is outside the accepted window |
| `BTP_ERROR_ALREADY_RECEIVED` | 403 | no | The `(from, id)` was already accepted: it was delivered |
| `BTP_ERROR_REGISTRATION_UNAVAILABLE` | 403 | no | The server does not register devices |
| `BTP_ERROR_REGISTRATION_TOKEN_MISSING` | 403 | no | Device registration without a token |
| `BTP_ERROR_REGISTRATION_TOKEN_INVALID` | 403 | no | The registration token is invalid or expired |
| `BTP_ERROR_REGISTRATION_TOKEN_USED` | 403 | no | The registration token was already used |
| `BTP_ERROR_REGISTRATION_IDENTITY_MISMATCH` | 403 | no | The registration token is for another identity |
| `BTP_ERROR_LINE_TOO_LONG` | 403 | no | The line is longer than the server reads; the connection is closed |
| `BTP_ERROR_RATE_LIMITER` | 429 | yes | Too many requests: slow down and retry |
| `BTP_ERROR_UNKNOWN` | 500 | yes | Unexpected failure on the server |
| `BTP_ERROR_SERVER_SELECTOR` | 500 | yes | Server configuration: no `serverIdentity.selector` (raised at start-up) |
| `BTP_ERROR_SOCKET_TIMEOUT` | 503 | yes | The connection timed out |
| `BTP_ERROR_SOCKET_CLOSED` | 503 | yes | The socket was already closed |
| `BTP_ERROR_TIMEOUT` | 503 | yes | Client only: no answer within the send timeout |
| `BTP_ERROR_CONNECTION_CLOSED` | 503 | yes | Client only: the connection closed |
| `BTP_ERROR_CONNECTION_ENDED` | 503 | yes | Client only: the connection ended |
| `BTP_ERROR_ALREADY_CONNECTING` | 503 | yes | Client only: a connection is already being made |
