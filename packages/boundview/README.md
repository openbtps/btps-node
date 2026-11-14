# @btps/boundview

BoundView for BTPS: what you see is what was signed.

This package captures a document's HTML preview as its BoundView, a signed
canvas bound to the document's data, and draws a received BoundView in a
closed WebAssembly engine. A platform builds nothing else: it keeps
designing its preview in HTML.

## Install

```bash
npm install @btps/boundview
```

It needs `@btps/sdk` 1.2.0-rc.3 or later beside it.

## Use

```ts
import { initBoundViewEngine, snapshotBoundView, renderBoundView } from '@btps/boundview';

// In a browser or app, load the engine once. In Node it loads by itself.
await initBoundViewEngine(new URL('@btps/boundview/engine.wasm', import.meta.url));

// Sending, in the browser where the preview is shown
const boundView = await snapshotBoundView(previewElement, document);
await agent.command('artifact.send', to, { ...document, boundView });

// Receiving: PNG bytes, or null when there is no BoundView or it failed a check
const png = await renderBoundView(openedDocument);
```

`snapshotBoundView` throws a `BoundViewSnapshotError`, whose `problems` say
why, when the preview cannot make a BoundView a receiver would accept and
show.

## Documentation

- [BoundView](https://www.openbtps.org/docs/next/protocol/specifications/boundview): what it is and what it guarantees
- [Using BoundView](https://www.openbtps.org/docs/next/protocol/specifications/boundview/using): the calls, options and what the snapshot reads
- [Why BoundView was created](https://www.openbtps.org/docs/next/protocol/specifications/boundview/why)

## Licence

Apache-2.0. The package bundles glyph outlines of Arimo, Tinos, Cousine,
Carlito, Caladea and Caveat (SIL Open Font License 1.1) and the WebAssembly
build of resvg (Mozilla Public License 2.0). See [NOTICE](./NOTICE).
