# Security policy

BTPS carries invoices and other documents people pay against, so we take
reports seriously and thank everyone who makes one.

## Reporting a vulnerability

**Please do not open a public issue, discussion or pull request for a
vulnerability.**

Report it privately through GitHub:
[**Report a vulnerability**](https://github.com/openbtps/btps-node/security/advisories/new)
(the repository's Security tab). Only the maintainers see it.

Please include:

- what an attacker can do, and what they need first (an account, a trust,
  network position);
- the steps or a proof of concept that shows it;
- the SDK version or commit, and your Node.js version.

We aim to acknowledge a report within three working days, and to agree with
you how and when it is disclosed. Once a fix is released, we publish an
advisory and credit you, unless you would rather not be named.

## In scope

- this SDK (`@btps/sdk`): the server, client, transporter, agent,
  cryptography, trust, authentication and delegation code;
- the BTPS protocol as specified in the
  [documentation](https://www.openbtps.org/docs/protocol/overview), where a
  flaw affects every implementation;
- the golden vectors in `test/vectors`.

The test keys in `test/vectors` and in the test suites are published on
purpose and protect nothing; finding them is not a vulnerability.

## Out of scope

- a provider's own deployment, configuration or infrastructure, which its
  operator secures;
- rate limiting, spam filtering and similar policy, which BTPS leaves to each
  provider by design (see
  [Defending your provider](https://www.openbtps.org/docs/protocol/security/best-practices));
- vulnerabilities in dependencies with no path to exploit them through this
  SDK. Report those to the dependency.

## Supported versions

| Version | Supported                            |
| ------- | ------------------------------------ |
| 1.1.x   | Yes: the current release (alpha)     |
| 1.0.x   | No: 1.1 servers refuse 1.0 artifacts |
