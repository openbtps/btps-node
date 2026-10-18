/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BtpsServerOptions } from '../types.js';

vi.mock('../btpsServer.js', () => ({
  BtpsServer: vi.fn(function (this: { config: unknown }, config: unknown) {
    this.config = config;
  }),
}));

const { BtpsServer } = await import('../btpsServer.js');
const { BtpsServerFactory } = await import('../libs/btpsRegistry.js');
const { BtpsServerLightweightFactory, BtpsServerSyncFactory } = await import(
  '../libs/btpsLightweightFactory.js'
);
const { RateLimiter } = await import('../libs/abstractRateLimiter.js');

const config = { port: 3443 } as unknown as BtpsServerOptions;

describe('BtpsServerFactory', () => {
  it('creates a new server from each configuration', () => {
    const first = BtpsServerFactory.create(config);
    const second = BtpsServerFactory.create(config);

    expect(first).not.toBe(second);
    expect(BtpsServer).toHaveBeenCalledWith(config);
  });
});

describe.each([
  ['BtpsServerLightweightFactory', BtpsServerLightweightFactory],
  ['BtpsServerSyncFactory', BtpsServerSyncFactory],
])('%s', (_name, Factory) => {
  beforeEach(() => Factory.reset());

  it('creates one server and returns it again', async () => {
    const first = await Factory.create(config);
    const second = await Factory.create(config);

    expect(second).toBe(first);
  });

  it('creates a new one after a reset', async () => {
    const first = await Factory.create(config);
    Factory.reset();

    expect(await Factory.create(config)).not.toBe(first);
  });
});

describe('RateLimiter', () => {
  it('has a cleanup that does nothing unless a limiter needs one', async () => {
    class AllowAll extends RateLimiter {
      async isAllowed() {
        return true;
      }
    }
    const limiter = new AllowAll();

    expect(() => limiter.cleanup()).not.toThrow();
    expect(await limiter.isAllowed()).toBe(true);
  });
});
