## What

<!-- What this pull request changes, in a sentence or two. -->

## Why

<!-- The problem it solves, or the issue it closes. -->

## How it was tested

<!-- The tests you added or ran, and what they show. A test that fails without the change. -->

## Docs, in this pull request

Every addition, change, rename or removal updates the docs in `docs/docusaurus/docs` fully. Tick each one, or write why it does not apply.

- [ ] Prose on every page the change touches
- [ ] Mermaid diagrams (steps, artifact and event names, who refuses what)
- [ ] Code blocks (imports, names, signatures, options, return shapes)
- [ ] JSON examples (`json btps=<kind>` fences validate: `npx vitest run test/guideExamples.test.ts`)
- [ ] SDK reference: `sdk/apiReference.md`, `sdk/classApiReference.md`, `sdk/typesAndInterfaces.md`
- [ ] Server and middleware pages
- [ ] `protocol/specifications/`
- [ ] What's new, and the migration guide for a breaking change
- [ ] `CHANGELOG.md`
- [ ] Golden vectors in `test/vectors` for a wire change
- [ ] `versioned_docs` untouched: it holds released snapshots
