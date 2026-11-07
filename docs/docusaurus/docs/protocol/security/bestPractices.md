---
title: BTPS Protocol Best Practices
sidebar_label: Best practices
slug: best-practices
---

# BTPS Best Practices

Following security best practices is critical for maintaining the integrity and trust of the BTPS protocol. This section outlines recommendations and compliance considerations for encryption and verification.

## Best Practices & Compliance in BTPS

- **Key Rotation:** Rotate cryptographic keys regularly and update DNS records promptly.
- **Private Key Protection:** Never share private keys; store them securely (e.g., HSM, encrypted disk).
- **Strong Algorithms:** Use only strong, industry-standard algorithms (e.g., AES-256-GCM, RSA-2048+, SHA-256).
- **Signature Verification:** Always verify digital signatures before processing any message.
- **Audit Logging:** Log all cryptographic operations and key management events for audit and compliance.
- **Access Control:** Restrict access to cryptographic material and key management interfaces.
- **Automate Where Possible:** Automate key rotation, revocation, and monitoring to reduce human error.

## Defending Your Provider

BTPS is a protocol with rules and options: it refuses what breaks the rules, and gives your server hooks for everything that is your decision.

### What BTPS refuses for you

Before an artifact reaches your handler, `BtpsServer` refuses:

- a signature that does not match the content, or a key that is not the one the sender publishes, so altered, redirected and spoofed artifacts never arrive;
- an artifact signed outside the time window (5 minutes by default, `maxArtifactAgeSeconds`);
- an artifact without an active trust, and one sent in the clear over a trust that requires encryption;
- an address with a second separator or a `:`;
- a line larger than the server's limit, and one that is not strict JSON;
- a document with a field over its limit.

Every limit is listed on [Limits](../specifications/limits.md).

A refusal never tells a stranger what only the receiver knows. A trust that was never made, is pending, rejected, revoked or blocked all read `BTP_ERROR_TRUST_NOT_ALLOWED`. An unknown device and a registered device's id signed with the wrong key read the same, and no refusal carries internal detail.

### What your provider decides

Some defences depend on what your platform stores, so BTPS leaves them to you. Add them as middleware: a handler can refuse with `res.sendError(...)` or pass the artifact on with `next()`. See [Middlewares](../../server/middlewares.md).

**Replay.** Within the time window, someone who captured an artifact can deliver it again. Your store already records what it received, which is what `isKnownArtifact` answers, so refuse a second delivery after the signature is verified:

```js
{
  phase: 'after',
  step: 'signatureVerification',
  handler: async (req, res, next, context) => {
    const { data } = req;
    if (data.type === 'transporter') {
      const { id, from, to } = data.artifact;
      const seen = await context.dependencies.trustStore.isKnownArtifact({
        artifactId: id,
        from,
        to,
      });
      if (seen) {
        return res.sendError({
          code: 'PROVIDER_ALREADY_RECEIVED',
          message: 'This artifact was already received',
          status: 409,
        });
      }
    }
    await next();
  },
}
```

Telling the sender it was already received is safe: it is the sender's own artifact, and a sender resending after a timeout learns its first send arrived. Check after `signatureVerification`, so only the real sender's artifacts are looked up. With several server instances, answer `isKnownArtifact` from shared storage, never from one instance's memory.

**What a sender is told of an error.** Your own answers go as plain objects through `res.sendError`, as above: a `{ code, message, status }` of your own, or a BTPS constant with something added to its message, goes out as you wrote it. Anything thrown, or an error you caught and pass on, is told only as a BTPS constant (its status, and its message or that message followed by `: ` and a detail); any other error, a database's or an SDK's with a code and status of its own, goes out as a generic `500`, and its detail stays with your server. So never pass a caught error to `res.sendError` to explain a refusal: send your own answer.

**Repeated trust requests.** A sender can ask again while its first request is pending. To refuse that, answer exactly as BTPS answers every other trust refusal, so a stranger cannot learn that a request is pending:

```js
import { computeTrustId } from '@btps/sdk/trust';
import { BTP_ERROR_TRUST_NOT_ALLOWED } from '@btps/sdk/error';

{
  phase: 'before',
  step: 'trustVerification',
  handler: async (req, res, next, context) => {
    const { data } = req;
    if (data.type === 'transporter' && data.artifact.type === 'TRUST_REQ') {
      const { from, to } = data.artifact;
      const record = await context.dependencies.trustStore.getById(computeTrustId(from, to));
      if (record?.status === 'pending') return res.sendError(BTP_ERROR_TRUST_NOT_ALLOWED);
    }
    await next();
  },
}
```

A declined sender is held back by the trust record's `retryAfterDate`, and a blocked one is refused, without any middleware.

**Rate limits.** BTPS sets none by default. Add your own, or start from the SDK's `BtpsSimpleRateLimiter`, which is an example for a single instance, not for production. Count identities after `signatureVerification`, so a sender cannot spend another address's allowance.

**Your own refusals.** Use a BTPS error constant where one fits, or your own `{ code, message, status }`. Never put internal detail (stack traces, store errors, the reason a trust is refused) in what you send. Since 1.2, a 429 you send as a `BTPErrorException` with `meta: { retryAfter }`, in whole seconds, tells the sender how long to wait.

### Since 1.2

**What the server checks, and what is yours.** The server checks structure, signatures, the trust and its permissions, and reads only the trust record and `isKnownArtifact`: a send of a document type the trust does not grant (`send:<type>`) is refused, and so is a details refresh naming a detail the receiver does not hold. Checks that need more of your records are yours, as middleware with your own lookups: an event's chain (`eventChainCheck`), what a details response names (`detailsResponseCheck`), an agreement's turn (`agreementOrderCheck`) and your own limit on details requests (`detailsRequestLimit`). Without them those artifacts are taken. See [Your Platform's Checks](../../getting-started/server/middlewares.md#your-platforms-checks).

**Verification: facts, and your own list.** A trust request may carry a verification, a statement that a provider checked its sender. `verificationFacts` reports facts only: whether the signature holds, whether it has expired, whether the verifier serves the sender's domain, and whether it is that domain's operator. Only a domain's operator may verify (`verifierRefusal`). A valid signature makes no one verified: keep your own list of the verifiers you trust, and decide which facts you require, for example an operator you list, in date. Never show a sender as verified on a signature alone.

**One key pair, the operator's.** Run your server as your domain's operator (`admin$<domain>`), with the key published at its selector. The same key signs identity-lookup answers and, with `signAnswers`, every answer, and devices pin it with `requireSignedBy`. Never run a separate `server$<domain>` identity: clients take a lookup answer only from the operator.

**A device's key to an encrypted document.** `wrapForAgent` re-wraps a document's key to a device's own key. Wrap only to the device record of the identity whose key unwraps, the device that asked as your agent authentication identified it: given another identity's device, it would hand that device this identity's document.

**Refresh tokens and their grace window.** With a token store that has `isConsumed`, a refresh token used a second time is theft: the device is revoked and `refreshTokenReused` fires. A refresh retried inside `refreshGraceMs` (30 seconds by default, `0` off; it needs `markSuccessor`) gets the same new token instead, so a device that lost the answer on a dropped connection is not revoked. Inside the window, whoever holds the just-rotated old token gets that answer too: keep the window short. See [BtpsAuthentication](../authentication/btpsAuthentication.md).

**Trusted timestamps.** An evidence bundle's timestamp is trusted only when it is signed by a timestamp authority's certificate (its one extended key usage `timeStamping`, critical) that chains to a root you give. Give the roots of the authorities you choose, never a general certificate authority's root alone.

## Compliance Considerations

- **GDPR:** Ensure encryption of personal data in transit and at rest.
- **PCI DSS:** Use strong encryption for payment data and maintain audit trails.
- **SOX:** Maintain records of all key management and cryptographic operations.
- **ISO 27001:** Follow information security management best practices.

## Monitoring & Incident Response

- Monitor for unauthorized access or failed decryption/signature verification attempts.
- Have a clear incident response plan for key compromise or cryptographic failures.
- Notify affected parties promptly in the event of a breach.

> Adhering to these best practices ensures BTPS remains secure, trustworthy, and compliant with industry standards.
