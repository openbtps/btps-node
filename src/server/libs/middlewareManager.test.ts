/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { MiddlewareManager } from './middlewareManager.js';
import type { BTPServerResponse } from '@core/server/types.js';

const dir = mkdtempSync(path.join(os.tmpdir(), 'btps-mw-'));
let count = 0;

/** A middleware file with this body as its default export's return value. */
const middlewareFile = (body: string) => {
  const file = path.join(dir, `mw-${count++}.mjs`);
  writeFileSync(file, body, 'utf8');
  return file;
};

const loaded = async (body: string) => {
  const manager = new MiddlewareManager(middlewareFile(body));
  await manager.loadMiddleware({} as never);
  return manager;
};

const handler = 'async (req, res, next) => { await next(); }';

afterEach(() => vi.restoreAllMocks());
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

describe('MiddlewareManager', () => {
  it('loads a module with lifecycle hooks, and runs each hook', async () => {
    const manager = await loaded(`
      export default () => ({
        middleware: [{ phase: 'after', step: 'onArtifact', handler: ${handler} }],
        onServerStart: () => { globalThis.mwCalls = ['start']; },
        onServerStop: () => { globalThis.mwCalls.push('stop'); },
        onResponseSent: (r) => { globalThis.mwCalls.push(r.id); },
      });
    `);

    await manager.onServerStart();
    await manager.onResponseSent({ id: 'res-1' } as BTPServerResponse);
    await manager.onServerStop();

    expect(manager.getMiddleware('after', 'onArtifact')).toHaveLength(1);
    expect(Object.keys(manager.getLifecycleHooks())).toEqual([
      'onServerStart',
      'onServerStop',
      'onResponseSent',
    ]);
    expect((globalThis as { mwCalls?: string[] }).mwCalls).toEqual(['start', 'res-1', 'stop']);
  });

  it('keeps the server running when a lifecycle hook throws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const manager = await loaded(`
      export default () => ({
        middleware: [],
        onServerStart: () => { throw new Error('start'); },
        onServerStop: () => { throw new Error('stop'); },
        onResponseSent: () => { throw new Error('sent'); },
      });
    `);

    await expect(manager.onServerStart()).resolves.toBeUndefined();
    await expect(manager.onServerStop()).resolves.toBeUndefined();
    await expect(manager.onResponseSent({} as BTPServerResponse)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(3);
  });

  it('runs no hooks when there are none', async () => {
    const manager = await loaded(`export default () => [];`);

    await expect(manager.onServerStart()).resolves.toBeUndefined();
    await expect(manager.onServerStop()).resolves.toBeUndefined();
    await expect(manager.onResponseSent({} as BTPServerResponse)).resolves.toBeUndefined();
  });

  it.each([
    ['a default export that is not a function', `export default [];`],
    ['a function that returns neither an array nor a module', `export default () => 42;`],
  ])('refuses %s', async (_name, body) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const manager = new MiddlewareManager(middlewareFile(body));

    await expect(manager.loadMiddleware({} as never)).rejects.toThrow(/Failed to load middleware/);
  });

  it('skips each invalid definition and a disabled one, keeping the rest', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const manager = await loaded(`
      export default () => [
        null,
        { phase: 'before', step: 'not-a-step', handler: ${handler} },
        { phase: 'before', step: 'parsing', priority: -1, handler: ${handler} },
        { phase: 'before', step: 'parsing', priority: 1.5, handler: ${handler} },
        { phase: 'before', step: 'parsing', config: { enabled: false }, handler: ${handler} },
        { phase: 'before', step: 'parsing', handler: ${handler} },
      ];
    `);

    expect(manager.getAllMiddleware()).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(4);
  });
});
