/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, beforeEach, vi, afterEach, type Mock } from 'vitest';
import { BtpsServerRegistry, BtpsServerSingletonFactory } from '../libs/btpsFactory.js';
import { BtpsServer } from '../btpsServer.js';
import { AbstractTrustStore } from '../../core/trust/storage/AbstractTrustStore.js';
import { BTPTrustRecord } from '../../core/trust/types.js';
import { EventEmitter } from 'events';
import tls, { TlsOptions, TLSSocket } from 'tls';

// Dummy TrustStore for server construction
class DummyTrustStore extends AbstractTrustStore<BTPTrustRecord> {
  constructor() {
    super({ connection: null, entityName: 'dummy' });
  }
  async getById(computedId: string): Promise<BTPTrustRecord | undefined> {
    return undefined;
  }
  async getBySender() {
    return undefined;
  }
  async create(record: Omit<BTPTrustRecord, 'id'>, computedId?: string): Promise<BTPTrustRecord> {
    throw new Error('not implemented');
  }
  async update(computedId: string, patch: Partial<BTPTrustRecord>): Promise<BTPTrustRecord> {
    throw new Error('not implemented');
  }
  async delete(computedId: string): Promise<void> {
    throw new Error('not implemented');
  }
  async getAll(): Promise<BTPTrustRecord[]> {
    return [];
  }
}

describe('BtpsServerRegistry', () => {
  let serverA: BtpsServer;
  let serverB: BtpsServer;
  let trustStore: DummyTrustStore;
  let listenSpy: Mock;
  let closeSpy: Mock;

  beforeEach(() => {
    trustStore = new DummyTrustStore();
    listenSpy = vi.fn((port, cb) => cb && cb());
    closeSpy = vi.fn();

    // Mock the TLS server creation
    vi.spyOn(tls, 'createServer').mockImplementation(
      (opts: TlsOptions, handler?: (socket: TLSSocket) => void) => {
        // Minimal mock of a TLS server
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- needed for test mock
        const fakeServer: any = new EventEmitter();
        fakeServer.listen = listenSpy;
        fakeServer.close = closeSpy;
        return fakeServer;
      },
    );

    serverA = new BtpsServer({ trustStore });
    serverB = new BtpsServer({ trustStore });
    BtpsServerRegistry.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    BtpsServerRegistry.clear();
  });

  it('registers and gets servers by id', () => {
    BtpsServerRegistry.register('a', serverA);
    BtpsServerRegistry.register('b', serverB);
    expect(BtpsServerRegistry.get('a')).toBe(serverA);
    expect(BtpsServerRegistry.get('b')).toBe(serverB);
  });

  it('starts and stops a specific server', async () => {
    BtpsServerRegistry.register('a', serverA);
    await BtpsServerRegistry.start('a');
    expect(listenSpy).toHaveBeenCalled();
    BtpsServerRegistry.stop('a');
    expect(closeSpy).toHaveBeenCalled();
  });

  it('starts and stops all servers', async () => {
    BtpsServerRegistry.register('a', serverA);
    BtpsServerRegistry.register('b', serverB);
    await BtpsServerRegistry.startAll();
    expect(listenSpy).toHaveBeenCalledTimes(2);
    BtpsServerRegistry.stopAll();
    expect(closeSpy).toHaveBeenCalledTimes(2);
  });

  it('clear removes all servers', () => {
    BtpsServerRegistry.register('a', serverA);
    BtpsServerRegistry.register('b', serverB);
    BtpsServerRegistry.clear();
    expect(BtpsServerRegistry.get('a')).toBeUndefined();
    expect(BtpsServerRegistry.get('b')).toBeUndefined();
  });
});

describe('BtpsServerSingletonFactory', () => {
  let trustStore: DummyTrustStore;
  beforeEach(() => {
    trustStore = new DummyTrustStore();
    BtpsServerSingletonFactory.reset();
  });
  afterEach(() => {
    BtpsServerSingletonFactory.reset();
  });

  it('returns the same instance for multiple create calls', () => {
    const s1 = BtpsServerSingletonFactory.create({ trustStore });
    const s2 = BtpsServerSingletonFactory.create({ trustStore });
    expect(s1).toBe(s2);
  });

  it('reset allows a new instance to be created', () => {
    const s1 = BtpsServerSingletonFactory.create({ trustStore });
    BtpsServerSingletonFactory.reset();
    const s2 = BtpsServerSingletonFactory.create({ trustStore });
    expect(s1).not.toBe(s2);
  });
});
