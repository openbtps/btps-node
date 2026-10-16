# AGENTS.md

Read this before writing anything in this repository, whether you are a
person or an agent. It says where things go and what they are called. The
rules below describe the code as it is; `test/conventions.test.ts` checks
the ones a machine can check, and fails the build when one is broken.

BTPS is a protocol: a set of rules. This SDK gives the basic tools for it
(security, verification, the wire shapes) and a server and client as a
convenience. Keep additions small and general. Something only one platform
needs belongs in that platform, not here.

## Where things go

All source is under one of three folders. Nothing new goes at the top of
`src/`, and no new folder is added beside these three.

| Folder | What belongs there |
|---|---|
| `src/core/` | Everything both sides share. Split by area, below. |
| `src/client/` | The client and agent: connecting, sending, reading answers. |
| `src/server/` | The server: accepting connections, middleware, answering. |

`src/core/` is split by area. Put new code in the area it belongs to; add
a new area only when none fits, and say why in the pull request.

| Area | What belongs there |
|---|---|
| `core/utils/` | Functions with no state that more than one place can use. |
| `core/error/` | `BTPErrorException` and every error constant (`constant.ts`). |
| `core/crypto/` | Signing, verifying, encrypting, decrypting, key handling. |
| `core/trust/` | Trust records and the trust store. |
| `core/authentication/` | Device and agent authentication. |
| `core/delegation/` | Delegated signing. |
| `core/storage/` | Abstract and JSON stores. |
| `core/server/schemas/` | Every zod schema for what travels on the wire: artifacts, documents, responses. A group of related schemas gets a sub-folder, as `artifacts/` is. |
| `client/libs/schema.ts` | The only other place a zod schema lives: the client's own options and commands. |
| `core/server/constants/` | Protocol constants: action names, versions, currency codes. |
| `core/server/types.ts` | Wire types shared by client and server. |

Which schema validates a document is decided in one place:
`core/server/schemas/helpers.ts` (`processBtpDocSchema`,
`processBtpDocSchemaForAgent`). A new document type is not part of the
protocol until it is wired in there and added to `BTPDocType`.

## What things are called

| Thing | Rule | Example |
|---|---|---|
| A zod schema | `Btp` (or `Btps` for the agent's own) + what it is + `Schema` | `BtpAttachmentSchema`, `BtpsAgentCommandSchema` |
| A document's schema | `Btp` + name + `DocSchema` | `BtpInvoiceDocSchema`, `BtpTrustReqDocSchema` |
| A type or interface | `BTP` in capitals + name | `BTPInvoiceDoc`, `BTPTransporterArtifact` |
| A class | `Btps` + name | `BtpsServer`, `BtpsClient`, `BtpsDelegator` |
| An error constant | `BTP_ERROR_` + name, in `core/error/constant.ts` | `BTP_ERROR_IDENTITY` |
| Another constant | upper snake case | `CURRENCY_CODES`, `TRANSPORTER_ACTIONS` |
| A source file | camelCase, or the class's name for a file holding one class | `btpsServer.ts`, `BtpsDelegator.ts`, `transporterSchema.ts` |
| A schema file | what it groups + `Schema.ts` | `responseSchema.ts` |
| Types for an area | `types.ts` in that area | `core/crypto/types.ts` |

## Errors

Throw `BTPErrorException` with a constant from `core/error/constant.ts`.
Add a new constant there when none fits. Never throw a plain `Error`,
`TypeError` or `RangeError` from `src/`, and never hand raw zod issues to
a caller: a sender decides whether to retry from the error it is given.

## Exports

Something a user of the SDK needs must be reachable from `src/index.ts` or
from one of the package's export paths in `package.json` (`.`, `./server`,
`./server/core`, `./client`, `./crypto`, `./trust`, `./authentication`,
`./delegation`, `./error`, `./storage`). Code that is built and cannot be
imported is unfinished. Prefer an existing path to a new one.

## Tests

A test sits beside the file it tests, as `<name>.test.ts`. The top-level
`test/` folder is for conformance tests and vectors that apply to the
whole SDK, and for `conventions.test.ts`. A test-only helper lives in a
test file, not in shipped source.

## Changes

- No partial changes to the protocol. Read the code a change touches, plan
  the whole set, and release it together.
- A change to a wire shape, a default or an error code is a protocol
  change: it needs the specification page under
  `docs/docusaurus/docs/protocol/specifications/` changed with it.
- Nobody but the maintainer merges into `master`.
- Every source file starts with the licence header (`scripts/add-license-header.sh`).
- Imports end in `.js`; shared code is imported through the `@core/` alias.

## Checking your work

```sh
yarn typecheck
yarn test                 # includes test/conventions.test.ts
yarn verify:btps-vectors
```

## Known exceptions

These exist today and are listed in `test/conventions.test.ts` so the
check passes. Do not add to the list to make a new file pass; move the
file.

- `identitySchema` in `core/server/schemas/shared.ts`, which has no `Btp` prefix.
