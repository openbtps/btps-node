# Contributing to the BTPS SDK

Thank you for helping. Issues and pull requests are welcome, from a typo in
the docs to a new feature.

Before you start on something large, open an issue to discuss it. BTPS is a
protocol, so a change to what goes over the wire has to work for every
implementation, not only this one.

**Security issues are the exception:** never report one in a public issue.
See [SECURITY.md](SECURITY.md).

## Set up

You need **Node.js 24 or later** (see `.nvmrc`) and Corepack, which brings the
pinned Yarn.

```sh
git clone https://github.com/openbtps/btps-node
cd btps-node
corepack enable
yarn install
yarn build
```

## The checks

Each pull request runs these in CI, and must pass all of them. Run them
locally first:

```sh
yarn build                     # compiles and type-checks the published code
yarn test                      # unit suite, with the coverage gate (90% of lines)
yarn test:e2e                  # end-to-end journeys between real servers over TLS
yarn test:security             # attacks, spoofing, flooding and probing
yarn verify:btps-vectors       # the golden vectors
yarn vitest run tests/packaging
```

The docs site builds on its own, and the build fails on any broken link:

```sh
cd docs/docusaurus && npm ci && npm run build
```

CI also packs the SDK and installs it, builds the example NestJS app and its
Docker image. Before opening a pull request, also make sure
`npx eslint src --ext .ts` is clean and that the files you changed pass
`npx prettier --check`.

One more test, the example app's Docker build context, needs a fresh clone
to pass, so it can fail on a working copy that CI's clean checkout passes.

## Code conventions

Where code goes, what things are called and how they are tested are set out
in [AGENTS.md](AGENTS.md), and checked by `test/conventions.test.ts`. In
short:

- **TypeScript, strict, ESM only.**
- **No `any`, `@ts-ignore` or `eslint-disable`.** Fix the type, not the check.
- **Tests sit beside the code** (`name.test.ts`). Journeys go in `tests/e2e`
  and attacks in `tests/security`.
- **Errors are `BTPErrorException`** with a code from `src/core/error`.
- **A change to the wire** (a document, an artifact, a limit, an error code)
  comes with its golden vectors (`test/vectors`), its documentation, and a
  `CHANGELOG.md` entry.

## Branches and pull requests

- `master` holds released code. Each release is prepared on its own branch,
  such as `release/1.1`, and work goes into that branch by pull request.
- **Keep a pull request to one change**, and say in its description what it
  changes, why, and how you tested it.
- **Add a test that fails without your change** and passes with it.
- **Update the docs** in `docs/docusaurus/docs` when behaviour changes.

## Versioning

The SDK's version is the protocol version it speaks: `1.1.x` speaks BTPS 1.1.
A patch release fixes the SDK without changing the wire. A new protocol
version (1.2) is a new minor version, and a server refuses artifacts of
another major.minor, so a wire change is never released as a patch. Every
release is listed in [CHANGELOG.md](CHANGELOG.md).

## License

By contributing, you agree that your contributions are licensed under the
[Apache License 2.0](LICENSE), the license of this project.
