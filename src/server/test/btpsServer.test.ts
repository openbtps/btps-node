/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, beforeEach, vi, afterEach, type Mock } from 'vitest';
import { BtpsServer } from '../btpsServer.js';
import { AbstractTrustStore } from '../../core/trust/storage/AbstractTrustStore.js';
import { BTPTrustRecord } from '../../core/trust/types.js';
import { EventEmitter } from 'events';
import tls, { TlsOptions, TLSSocket } from 'tls';

// Mock TrustStore
class DummyTrustStore extends AbstractTrustStore<BTPTrustRecord> {
  constructor() {
    super({ connection: null, entityName: 'dummy' });
  }
  async getBySender() {
    return undefined;
  }
  async create(
    receiverId: string,
    senderId: string,
    record: BTPTrustRecord,
  ): Promise<BTPTrustRecord> {
    throw new Error('not implemented');
  }
  async update(
    receiverId: string,
    senderId: string,
    patch: Partial<BTPTrustRecord>,
  ): Promise<BTPTrustRecord> {
    throw new Error('not implemented');
  }
  async delete(receiverId: string, senderId: string): Promise<void> {
    throw new Error('not implemented');
  }
  async getAll(): Promise<BTPTrustRecord[]> {
    return [];
  }
}

describe('BtpsServer', () => {
  let server: BtpsServer;
  let trustStore: DummyTrustStore;
  let listenSpy: Mock;
  let closeSpy: Mock;

  beforeEach(() => {
    trustStore = new DummyTrustStore();
    listenSpy = vi.fn((port, cb) => cb && cb());
    closeSpy = vi.fn();
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('constructs with minimal options', () => {
    server = new BtpsServer({ trustStore });
    expect(server).toBeInstanceOf(BtpsServer);
  });

  it('calls initialize and loads default middleware on start', async () => {
    server = new BtpsServer({ trustStore });
    const initializeSpy = vi.spyOn(server, 'initialize');
    await server.start();
    expect(initializeSpy).toHaveBeenCalled();
    expect(listenSpy).toHaveBeenCalled();
  });

  it('calls stop and closes the server', async () => {
    server = new BtpsServer({ trustStore });
    await server.start();
    server.stop();
    expect(closeSpy).toHaveBeenCalled();
  });

  it('emits message event on processMessage', async () => {
    server = new BtpsServer({ trustStore });
    const handler = vi.fn();
    server.onMessage(handler);
    // @ts-expect-error - direct call for test
    await server.processMessage({
      id: '1',
      from: 'a',
      to: 'b',
      type: 'btp_invoice',
      version: '1',
      signature: 'sig',
      issuedAt: new Date().toISOString(),
    });
    expect(handler).toHaveBeenCalled();
  });

  it('handles errors in handleConnection', async () => {
    server = new BtpsServer({ trustStore });
    const onError = vi.fn();
    // @ts-expect-error - test override
    server.onError = onError;
    // @ts-expect-error - fake socket for test
    server.handleOnSocketError(new Error('fail'), { destroyed: false, destroy: vi.fn() });
    expect(onError).toHaveBeenCalled();
  });
});
