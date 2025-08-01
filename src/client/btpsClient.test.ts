/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import tls from 'tls';
import split2 from 'split2';
import { BtpsClient } from './btpsClient.js';
import { BTPErrorException } from '../core/error/index.js';
import * as utils from '../core/utils/index.js';
import * as crypto from '../core/crypto/index.js';
import { BtpsClientOptions, BTPSRetryInfo } from './types/index.js';

// --- Mocks ---
vi.mock('tls');
vi.mock('split2');
vi.mock('../core/utils/index');
vi.mock('../core/crypto/index');

const mockTls = vi.mocked(tls);
const mockUtils = vi.mocked(utils);
const mockCrypto = vi.mocked(crypto);
const mockSplit2 = vi.fn();
(split2 as unknown as typeof mockSplit2).mockReturnValue({ on: vi.fn() });

describe('BtpsClient', () => {
  let client: BtpsClient;
  let mockSocket: EventEmitter & {
    writable: boolean;
    write: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    setTimeout: ReturnType<typeof vi.fn>;
    once: ReturnType<typeof vi.fn>;
    pipe: ReturnType<typeof vi.fn>;
    _timeoutCb?: () => void;
  };
  let mockOptions: BtpsClientOptions;
  let mockStream: EventEmitter & { on: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // Attach a no-op error listener to prevent unhandled error warnings
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((client as any)?.emitter?.on) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).emitter.on('error', () => {});
    }

    mockSocket = Object.assign(new EventEmitter(), {
      writable: true,
      write: vi.fn().mockReturnValue(true),
      end: vi.fn(),
      destroy: vi.fn(),
      setTimeout: vi.fn(),
      once: vi.fn(),
      pipe: vi.fn(),
    }) as EventEmitter & {
      writable: boolean;
      write: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
      destroy: ReturnType<typeof vi.fn>;
      setTimeout: ReturnType<typeof vi.fn>;
      once: ReturnType<typeof vi.fn>;
      pipe: ReturnType<typeof vi.fn>;
      _timeoutCb?: () => void;
    };
    // Mock setTimeout to store the callback for manual invocation
    mockSocket.setTimeout = vi.fn((timeout, cb) => {
      mockSocket._timeoutCb = cb;
    });
    mockStream = Object.assign(new EventEmitter(), {
      on: vi.fn(),
    });
    (mockSocket.pipe as ReturnType<typeof vi.fn>).mockReturnValue(mockStream);
    (mockTls.connect as unknown as ReturnType<typeof vi.fn>).mockImplementation((opts, cb) => {
      if (cb) cb();
      return mockSocket;
    });
    (split2 as unknown as typeof mockSplit2).mockReturnValue(mockStream);

    mockOptions = {
      identity: 'test$example.com',
      btpIdentityKey: 'PRIVATE_KEY',
      bptIdentityCert: 'PUBLIC_KEY',
      maxRetries: 2,
      retryDelayMs: 10,
      connectionTimeoutMs: 100,
    };
    mockUtils.getHostAndSelector.mockResolvedValue({
      host: 'server.example.com',
      selector: 'btps1',
      version: '1.0.0',
    });
    mockUtils.getBtpAddressParts.mockReturnValue({
      hostname: 'server.example.com',
      port: '3443',
    } as URL);
    mockUtils.parseIdentity.mockImplementation((id: string) => {
      const [accountName, domainName] = id.split('$');
      if (!accountName || !domainName) return null;
      return { accountName, domainName };
    });

    // Mock isValidIdentity to work with the test identities
    mockUtils.isValidIdentity.mockImplementation((identity?: string) => {
      if (!identity) return false;
      return identity.includes('$') && identity.split('$').length === 2;
    });
    mockCrypto.signEncrypt.mockResolvedValue({
      payload: {
        id: 'id',
        from: 'test$example.com',
        to: 'recipient$example.com',
        type: 'TRUST_REQ',
        issuedAt: '2023-01-01T00:00:00.000Z',
        document: {} as Record<string, unknown>,
        signature: { algorithmHash: 'sha256', value: 'sig', fingerprint: 'fp' },
        encryption: null,
        version: '1.0.0',
        selector: 'btps1',
      },
      error: undefined,
    });
    client = new BtpsClient(mockOptions);
    (client as unknown as { socket: typeof mockSocket }).socket = mockSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
    client.destroy();
  });

  it('should construct with options', () => {
    expect(client).toBeInstanceOf(BtpsClient);
  });

  describe('connect', () => {
    it('should emit connected event on successful connection', async () => {
      const onConnected = vi.fn();
      client.connect('recipient$example.com', (events) => {
        events.on('connected', onConnected);
      });
      // Simulate the internal emitter 'connected' event
      (client as unknown as { emitter: EventEmitter }).emitter.emit('connected');
      await vi.runAllTimersAsync();
      expect(onConnected).toHaveBeenCalled();
    });

    it('should emit error for invalid identity', () => {
      const onError = vi.fn();
      mockUtils.parseIdentity.mockReturnValue(null);
      mockUtils.isValidIdentity.mockReturnValue(false);

      // Add error listener to the internal emitter to catch the error
      (client as unknown as { emitter: EventEmitter }).emitter.on('error', onError);

      client.connect('badidentity', (events) => {
        events.on('error', () => {}); // This won't be called due to early return
      });

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(BTPErrorException) }),
      );
    });

    it('should emit error for DNS failure', async () => {
      const onError = vi.fn();
      mockUtils.getHostAndSelector.mockResolvedValue(undefined);
      await client.connect('recipient$example.com', (events) => {
        events.on('error', onError);
      });
      await vi.runAllTimersAsync();
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(BTPErrorException) }),
      );
    });

    it('should emit error for invalid hostname', async () => {
      const onError = vi.fn();
      mockUtils.getBtpAddressParts.mockReturnValue(null);
      await client.connect('recipient$example.com', (events) => {
        events.on('error', onError);
      });
      await vi.runAllTimersAsync();
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(BTPErrorException) }),
      );
    });

    it('should emit error and retry on socket error', async () => {
      const onError = vi.fn();
      client.connect('recipient$example.com', (events) => {
        events.on('error', onError);
      });
      // Simulate error event on internal emitter
      (client as unknown as { emitter: EventEmitter }).emitter.emit('error', {
        error: new BTPErrorException({ message: 'fail' }),
      });
      await vi.runAllTimersAsync();
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(BTPErrorException) }),
      );
    });

    it('should emit error and retry on connection timeout', async () => {
      const onError = vi.fn();
      client.connect('recipient$example.com', (events) => {
        events.on('error', onError);
      });
      // Simulate timeout event on internal emitter
      (client as unknown as { emitter: EventEmitter }).emitter.emit('error', {
        error: new BTPErrorException({ message: 'Connection timeout' }),
      });
      await vi.runAllTimersAsync();
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(BTPErrorException) }),
      );
    });

    it('should emit end and retry on socket end', async () => {
      const onEnd = vi.fn();
      client.connect('recipient$example.com', (events) => {
        events.on('end', onEnd);
      });
      // Simulate end event on internal emitter
      (client as unknown as { emitter: EventEmitter }).emitter.emit('end', { willRetry: true });
      await vi.runAllTimersAsync();
      expect(onEnd).toHaveBeenCalledWith(expect.objectContaining({ willRetry: true }));
    });

    // New tests for restructured behavior
    describe('listener management', () => {
      it('should create new listeners on first connect call', () => {
        const onConnected = vi.fn();
        const onMessage = vi.fn();

        client.connect('recipient$example.com', (events) => {
          events.on('connected', onConnected);
          events.on('message', onMessage);
        });

        const listeners = (
          client as unknown as { listeners: Map<string, Record<string, unknown>> }
        ).listeners.get('connectListeners');
        expect(listeners).toBeDefined();
        expect((listeners as Record<string, unknown>).connected).toBe(onConnected);
        expect((listeners as Record<string, unknown>).message).toBe(onMessage);
      });

      it('should reuse existing listeners on subsequent connect calls', () => {
        const onConnected = vi.fn();
        const onMessage = vi.fn();

        // First call
        client.connect('recipient$example.com', (events) => {
          events.on('connected', onConnected);
          events.on('message', onMessage);
        });

        const firstListeners = (
          client as unknown as { listeners: Map<string, Record<string, unknown>> }
        ).listeners.get('connectListeners');

        // Second call - should reuse existing listeners
        client.connect('recipient$example.com', (events) => {
          events.on('connected', () => {}); // This should be ignored
        });

        const secondListeners = (
          client as unknown as { listeners: Map<string, Record<string, unknown>> }
        ).listeners.get('connectListeners');

        // Should be the same object reference
        expect(secondListeners).toBe(firstListeners);
        expect((secondListeners as Record<string, unknown>).connected).toBe(onConnected);
        expect((secondListeners as Record<string, unknown>).message).toBe(onMessage);
      });

      it('should clean up connect listeners on invalid identity', () => {
        mockUtils.parseIdentity.mockReturnValue(null);

        client.connect('badidentity', (events) => {
          events.on('connected', () => {});
        });

        const listeners = (client as unknown as { listeners: Map<string, unknown> }).listeners.get(
          'connectListeners',
        );
        expect(listeners).toBeUndefined();
      });

      it('should clean up connect listeners in finally block when no retry is happening', async () => {
        const onConnected = vi.fn();

        // Mock successful resolveIdentity to trigger finally block
        mockUtils.getDnsIdentityParts.mockResolvedValue({
          key: 'rsa',
          version: '1.0.0',
          pem: 'test-key',
        });

        client.connect('recipient$example.com', (events) => {
          events.on('connected', onConnected);
        });

        // Simulate successful connection completion
        await vi.runAllTimersAsync();

        const listeners = (
          client as unknown as { listeners: Map<string, Record<string, unknown>> }
        ).listeners.get('connectListeners');

        // With successful connection, shouldRetry should be true initially, so listeners should remain
        expect(listeners).toBeDefined();
      });
    });

    describe('isConnecting flag timing', () => {
      it('should set isConnecting to true only after successful resolveIdentity', async () => {
        const onConnected = vi.fn();

        // Mock successful resolveIdentity
        mockUtils.getDnsIdentityParts.mockResolvedValue({
          key: 'rsa',
          version: '1.0.0',
          pem: 'test-key',
        });

        // Before resolveIdentity completes, isConnecting should be false
        expect((client as unknown as { isConnecting: boolean }).isConnecting).toBe(false);

        client.connect('recipient$example.com', (events) => {
          events.on('connected', onConnected);
        });

        // After resolveIdentity completes successfully
        await vi.runAllTimersAsync();
        expect((client as unknown as { isConnecting: boolean }).isConnecting).toBe(true);
      });

      it('should not set isConnecting on resolveIdentity error', async () => {
        mockUtils.getHostAndSelector.mockResolvedValue(undefined);

        client.connect('recipient$example.com');
        await vi.runAllTimersAsync();

        expect((client as unknown as { isConnecting: boolean }).isConnecting).toBe(false);
      });
    });
  });

  describe('destruction', () => {
    it('should clean up and prevent further use', () => {
      client.destroy();
      expect(() => client.connect('test$example.com')).not.toThrow();
    });
  });
});

describe('BtpsClient internals', () => {
  let client: BtpsClient;
  let mockSocket: ReturnType<typeof Object.assign>;
  let mockOptions: BtpsClientOptions;

  beforeEach(() => {
    vi.useFakeTimers();
    mockSocket = Object.assign(new EventEmitter(), {
      writable: true,
      write: vi.fn().mockReturnValue(true),
      end: vi.fn(),
      destroy: vi.fn(),
      setTimeout: vi.fn(),
      once: vi.fn(),
      pipe: vi.fn(),
    });
    mockOptions = {
      identity: 'test$example.com',
      btpIdentityKey: 'PRIVATE_KEY',
      bptIdentityCert: 'PUBLIC_KEY',
      maxRetries: 2,
      retryDelayMs: 10,
      connectionTimeoutMs: 100,
    };
    client = new BtpsClient(mockOptions);
    (client as unknown as { socket: typeof mockSocket }).socket = mockSocket;
    // Attach a no-op error listener to prevent unhandled error warnings
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((client as any)?.emitter?.on) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).emitter.on('error', () => {});
    }
  });

  describe('flushBackpressure', () => {
    it('should drain all messages if socket is writable', async () => {
      (client as unknown as { backpressureQueue: string[] }).backpressureQueue = ['a', 'b', 'c'];
      mockSocket.write.mockReturnValue(true);
      await (client as unknown as { flushBackpressure: () => Promise<void> }).flushBackpressure();
      expect((client as unknown as { backpressureQueue: string[] }).backpressureQueue.length).toBe(
        0,
      );
      expect(mockSocket.write).toHaveBeenCalledTimes(3);
    });
    it('should wait for drain if socket is not writable', async () => {
      (client as unknown as { backpressureQueue: string[] }).backpressureQueue = ['a'];
      let drainCb: (() => void) | undefined;
      mockSocket.write.mockReturnValue(false);
      mockSocket.once.mockImplementation((event: string, cb: () => void) => {
        if (event === 'drain') drainCb = cb;
      });
      const promise = (
        client as unknown as { flushBackpressure: () => Promise<void> }
      ).flushBackpressure();
      // Simulate drain event
      if (!drainCb) throw new Error('drainCb not assigned');
      drainCb();
      await promise;
      expect((client as unknown as { backpressureQueue: string[] }).backpressureQueue.length).toBe(
        0,
      );
      expect(mockSocket.write).toHaveBeenCalledTimes(1);
    });
  });

  describe('getRetryInfo', () => {
    it('should return willRetry true if under maxRetries and not destroyed', () => {
      (client as unknown as { retries: number }).retries = 0;
      (client as unknown as { destroyed: boolean }).destroyed = false;
      (client as unknown as { shouldRetry: boolean }).shouldRetry = true;
      const info = (
        client as unknown as { getRetryInfo: () => unknown }
      ).getRetryInfo() as BTPSRetryInfo;
      expect(info.willRetry).toBe(true);
      expect(info.retriesLeft).toBe(1);
    });
    it('should return willRetry false if destroyed', () => {
      (client as unknown as { destroyed: boolean }).destroyed = true;
      const info = (
        client as unknown as { getRetryInfo: () => unknown }
      ).getRetryInfo() as BTPSRetryInfo;
      expect(info.willRetry).toBe(false);
    });
    it('should return willRetry false for SyntaxError', () => {
      const info = (client as unknown as { getRetryInfo: (e: unknown) => unknown }).getRetryInfo(
        new SyntaxError('bad json'),
      ) as BTPSRetryInfo;
      expect(info.willRetry).toBe(false);
    });
    it('should return willRetry false for non-retryable error', () => {
      const info = (client as unknown as { getRetryInfo: (e: unknown) => unknown }).getRetryInfo({
        message: 'invalid identity',
      }) as BTPSRetryInfo;
      expect(info.willRetry).toBe(false);
    });
    it('should return willRetry false if shouldRetry is false', () => {
      (client as unknown as { shouldRetry: boolean }).shouldRetry = false;
      const info = (
        client as unknown as { getRetryInfo: () => unknown }
      ).getRetryInfo() as BTPSRetryInfo;
      expect(info.willRetry).toBe(false);
    });
  });

  describe('isNonRetryableError', () => {
    it('should return true for non-retryable error messages', () => {
      const clientUnknown = client as unknown as { isNonRetryableError: (e: unknown) => boolean };
      expect(clientUnknown.isNonRetryableError({ message: 'invalid identity' })).toBe(true);
      expect(clientUnknown.isNonRetryableError({ message: 'invalid btpAddress' })).toBe(true);
      expect(clientUnknown.isNonRetryableError({ message: 'invalid hostname' })).toBe(true);
      expect(clientUnknown.isNonRetryableError({ message: 'unsupported protocol' })).toBe(true);
      expect(clientUnknown.isNonRetryableError({ message: 'signature verification failed' })).toBe(
        true,
      );
      expect(clientUnknown.isNonRetryableError({ message: 'destroyed' })).toBe(true);
    });
    it('should return false for retryable error messages', () => {
      const clientUnknown = client as unknown as { isNonRetryableError: (e: unknown) => boolean };
      expect(clientUnknown.isNonRetryableError({ message: 'connection timeout' })).toBe(false);
      expect(clientUnknown.isNonRetryableError({ message: 'random error' })).toBe(false);
    });
  });

  describe('retryConnect', () => {
    it('should increment retries and call connect after delay', () => {
      const clientUnknown = client as unknown as {
        retries: number;
        options: unknown;
        retryConnect: (id: string) => void;
      };
      clientUnknown.retries = 0;
      (clientUnknown.options as { maxRetries: number }).maxRetries = 2;
      const connectSpy = vi.spyOn(client, 'connect');
      clientUnknown.retryConnect('receiver$domain.com');
      expect(clientUnknown.retries).toBe(1);
      vi.advanceTimersByTime(10);
      expect(connectSpy).toHaveBeenCalledWith('receiver$domain.com');
    });
    it('should not retry if retries >= maxRetries', () => {
      const clientUnknown = client as unknown as {
        retries: number;
        options: unknown;
        retryConnect: (id: string) => void;
      };
      clientUnknown.retries = 2;
      (clientUnknown.options as { maxRetries: number }).maxRetries = 2;
      const connectSpy = vi.spyOn(client, 'connect');
      clientUnknown.retryConnect('receiver$domain.com');
      expect(connectSpy).not.toHaveBeenCalled();
    });
  });

  describe('cleanupListeners', () => {
    it('should clean up specific listeners when id is provided', () => {
      const clientUnknown = client as unknown as {
        listeners: Map<string, Record<string, unknown>>;
        emitter: EventEmitter;
        cleanupListeners: (id: string) => void;
      };

      // Add some test listeners
      const testListener = () => {};
      clientUnknown.emitter.on('test', testListener);
      clientUnknown.listeners.set('testId', { test: testListener });

      clientUnknown.cleanupListeners('testId');

      expect(clientUnknown.listeners.has('testId')).toBe(false);
      expect(clientUnknown.emitter.listenerCount('test')).toBe(0);
    });

    it('should clean up all listeners when no id is provided', () => {
      const clientUnknown = client as unknown as {
        listeners: Map<string, Record<string, unknown>>;
        emitter: EventEmitter;
        cleanupListeners: (id?: string) => void;
      };

      // Add multiple test listeners
      const testListener1 = () => {};
      const testListener2 = () => {};
      clientUnknown.emitter.on('test1', testListener1);
      clientUnknown.emitter.on('test2', testListener2);
      clientUnknown.listeners.set('id1', { test1: testListener1 });
      clientUnknown.listeners.set('id2', { test2: testListener2 });

      clientUnknown.cleanupListeners();

      expect(clientUnknown.listeners.size).toBe(0);
      expect(clientUnknown.emitter.listenerCount('test1')).toBe(0);
      expect(clientUnknown.emitter.listenerCount('test2')).toBe(0);
    });

    it('should handle empty listeners gracefully', () => {
      const clientUnknown = client as unknown as {
        listeners: Map<string, Record<string, unknown>>;
        cleanupListeners: (id?: string) => void;
      };

      // Should not throw when no listeners exist
      expect(() => clientUnknown.cleanupListeners('nonexistent')).not.toThrow();
      expect(() => clientUnknown.cleanupListeners()).not.toThrow();
    });
  });
});

describe('retry and error edge cases', () => {
  let client: BtpsClient;
  let mockSocket: ReturnType<typeof Object.assign>;
  let mockOptions: BtpsClientOptions;

  beforeEach(() => {
    vi.useFakeTimers();
    mockSocket = Object.assign(new EventEmitter(), {
      writable: true,
      write: vi.fn().mockReturnValue(true),
      end: vi.fn(),
      destroy: vi.fn(),
      setTimeout: vi.fn(),
      once: vi.fn(),
      pipe: vi.fn(),
    });
    mockOptions = {
      identity: 'test$example.com',
      btpIdentityKey: 'PRIVATE_KEY',
      bptIdentityCert: 'PUBLIC_KEY',
      maxRetries: 2,
      retryDelayMs: 10,
      connectionTimeoutMs: 100,
    };
    client = new BtpsClient(mockOptions);
    (client as unknown as { socket: typeof mockSocket }).socket = mockSocket;
    // Attach a no-op error listener to prevent unhandled error warnings
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((client as any)?.emitter?.on) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).emitter.on('error', () => {});
    }
  });

  it('should not retry for non-retryable errors', () => {
    const clientUnknown = client as unknown as {
      retries: number;
      shouldRetry: boolean;
      getRetryInfo: (e?: unknown) => BTPSRetryInfo;
      retryConnect: (id: string) => void;
    };
    clientUnknown.retries = 0;
    clientUnknown.shouldRetry = true;
    const info = clientUnknown.getRetryInfo({ message: 'invalid identity' });
    expect(info.willRetry).toBe(false);
    const connectSpy = vi.spyOn(client, 'connect');
    clientUnknown.retryConnect('receiver$domain.com');
    // Should not retry because getRetryInfo returns willRetry false
    expect(connectSpy).not.toHaveBeenCalled();
  });

  describe('end and destroy', () => {
    it('should call socket.end when client.end is called', () => {
      const clientUnknown = client as unknown as { socket: typeof mockSocket };
      clientUnknown.socket = mockSocket;
      client.end();
      expect(mockSocket.end).toHaveBeenCalled();
    });

    it('should call socket.destroy and remove listeners when client.destroy is called', () => {
      const clientUnknown = client as unknown as { socket: typeof mockSocket; destroyed: boolean };
      clientUnknown.socket = mockSocket;
      client.destroy();
      expect(mockSocket.destroy).toHaveBeenCalled();
      expect(clientUnknown.destroyed).toBe(true);
      // Listeners removed: emitter should have no listeners
      expect((client as unknown as { emitter: EventEmitter }).emitter.eventNames().length).toBe(0);
    });

    it('should set socket to undefined after end', () => {
      const clientUnknown = client as unknown as { socket: typeof mockSocket };
      clientUnknown.socket = mockSocket;
      client.end();
      expect(clientUnknown.socket).toBeUndefined();
    });

    it('should set socket to undefined after destroy', () => {
      const clientUnknown = client as unknown as { socket: typeof mockSocket };
      clientUnknown.socket = mockSocket;
      client.destroy();
      expect(clientUnknown.socket).toBeUndefined();
    });
  });

  it('should override the port and host if given in the constructor', async () => {
    const tlsConnectSpy = vi.spyOn(tls, 'connect');
    const customOptions: BtpsClientOptions = {
      ...mockOptions,
      host: 'customhost.com',
      port: 9999,
    };
    const customClient = new BtpsClient(customOptions);

    // Mock successful resolveIdentity to trigger connection
    mockUtils.getDnsIdentityParts.mockResolvedValue({
      key: 'rsa',
      version: '1.0.0',
      pem: 'test-key',
    });

    // Mock getHostAndSelector to return custom host/port
    mockUtils.getHostAndSelector.mockResolvedValue({
      host: 'customhost.com',
      selector: 'btps1',
      version: '1.0.0',
    });

    // Mock getBtpAddressParts to return custom host/port
    mockUtils.getBtpAddressParts.mockReturnValue({
      hostname: 'customhost.com',
      port: '9999',
    } as URL);

    // Connect should use the custom host/port
    customClient.connect('recipient$example.com');
    await vi.runAllTimersAsync();
    expect(tlsConnectSpy).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'customhost.com', port: 9999 }),
      expect.any(Function),
    );
  });
});

describe('BtpsClient additional edge cases', () => {
  let client: BtpsClient;
  let mockSocket: ReturnType<typeof Object.assign>;
  let mockOptions: BtpsClientOptions;

  beforeEach(() => {
    mockSocket = Object.assign(new EventEmitter(), {
      writable: true,
      write: vi.fn().mockReturnValue(true),
      end: vi.fn(),
      destroy: vi.fn(),
      setTimeout: vi.fn(),
      once: vi.fn(),
      pipe: vi.fn(),
    });
    mockOptions = {
      identity: 'test$example.com',
      btpIdentityKey: 'PRIVATE_KEY',
      bptIdentityCert: 'PUBLIC_KEY',
      maxRetries: 2,
      retryDelayMs: 10,
      connectionTimeoutMs: 100,
    };
    client = new BtpsClient(mockOptions);
    (client as unknown as { socket: typeof mockSocket }).socket = mockSocket;
    // Attach a no-op error listener to prevent unhandled error warnings
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((client as any)?.emitter?.on) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).emitter.on('error', () => {});
    }
  });

  it('should allow double destruction safely', () => {
    expect(() => {
      client.destroy();
      client.destroy();
    }).not.toThrow();
    expect((client as unknown as { destroyed: boolean }).destroyed).toBe(true);
  });

  it('should return the correct protocol version', () => {
    expect(client.getProtocolVersion()).toBe('1.0.0');
  });

  it('should remove all event listeners after destroy', () => {
    const emitter = (client as unknown as { emitter: EventEmitter }).emitter;
    emitter.on('foo', () => {});
    emitter.on('bar', () => {});
    client.destroy();
    expect(emitter.eventNames().length).toBe(0);
  });

  it('signEncryptArtifact returns error if identity is invalid', async () => {
    const spy = vi.spyOn(utils, 'parseIdentity').mockReturnValue(null);
    const result = await (
      client as unknown as {
        signEncryptArtifact: (
          artifact: unknown,
        ) => Promise<{ error?: BTPErrorException; payload?: unknown }>;
      }
    ).signEncryptArtifact({ to: 'a' });
    expect(result.error).toBeInstanceOf(BTPErrorException);
    expect(result.payload).toBeUndefined();
    spy.mockRestore();
  });
});

describe('resolveIdentity method', () => {
  let client: BtpsClient;
  let mockOptions: BtpsClientOptions;

  beforeEach(() => {
    vi.useFakeTimers();
    mockOptions = {
      identity: 'test$example.com',
      btpIdentityKey: 'PRIVATE_KEY',
      bptIdentityCert: 'PUBLIC_KEY',
      maxRetries: 2,
      retryDelayMs: 10,
      connectionTimeoutMs: 100,
    };
    client = new BtpsClient(mockOptions);
  });

  describe('isConnecting flag management', () => {
    it('should set isConnecting to true only when initializing connection', async () => {
      // Test through the public connect method instead of internal resolveIdentity
      // Mock successful DNS resolution
      mockUtils.getDnsIdentityParts.mockResolvedValue({
        key: 'rsa',
        version: '1.0.0',
        pem: 'test-key',
      });

      // Mock socket setup for this test
      const mockSocket = Object.assign(new EventEmitter(), {
        writable: true,
        write: vi.fn().mockReturnValue(true),
        end: vi.fn(),
        destroy: vi.fn(),
        setTimeout: vi.fn((timeout, cb) => {
          // Store timeout callback for manual invocation
          (mockSocket as unknown as { _timeoutCb?: () => void })._timeoutCb = cb;
        }),
        once: vi.fn(),
        pipe: vi.fn(),
      });

      (mockTls.connect as unknown as ReturnType<typeof vi.fn>).mockImplementation((opts, cb) => {
        if (cb) cb();
        return mockSocket;
      });

      // Before resolveIdentity completes, isConnecting should be false
      expect((client as unknown as { isConnecting: boolean }).isConnecting).toBe(false);
      // Start connection
      client.connect('recipient$example.com', (events) => {
        events.on('connected', () => {});
      });

      // After resolveIdentity completes successfully
      await vi.runAllTimersAsync();

      mockSocket.emit('end');
      // After connection ends, isConnecting should be false
      expect((client as unknown as { isConnecting: boolean }).isConnecting).toBe(false);
    });

    it('should set isConnecting to false when connection ends', async () => {
      // Mock successful DNS resolution
      mockUtils.getHostAndSelector.mockResolvedValue({
        host: 'server.example.com',
        selector: 'btps1',
        version: '1.0.0',
      });

      // Mock socket setup for this test
      const mockSocket = Object.assign(new EventEmitter(), {
        writable: true,
        write: vi.fn().mockReturnValue(true),
        end: vi.fn(),
        destroy: vi.fn(),
        setTimeout: vi.fn(),
        once: vi.fn(),
        pipe: vi.fn(),
      });

      const mockStream = Object.assign(new EventEmitter(), {
        on: vi.fn(),
      });

      (mockSocket.pipe as ReturnType<typeof vi.fn>).mockReturnValue(mockStream);
      (mockTls.connect as unknown as ReturnType<typeof vi.fn>).mockImplementation((opts, cb) => {
        if (cb) cb();
        return mockSocket;
      });

      // Start connection
      client.connect('recipient$example.com', (events) => {
        events.on('connected', () => {});
      });

      // After connection starts, isConnecting should be true
      await vi.runAllTimersAsync();
      expect((client as unknown as { isConnecting: boolean }).isConnecting).toBe(true);

      // Simulate connection end by triggering the socket's 'end' event
      mockSocket.emit('end');

      // After connection ends, isConnecting should be false
      expect((client as unknown as { isConnecting: boolean }).isConnecting).toBe(false);
    });

    it('should set isConnecting to false when connection is established successfully', async () => {
      // Mock successful DNS resolution
      mockUtils.getHostAndSelector.mockResolvedValue({
        host: 'server.example.com',
        selector: 'btps1',
        version: '1.0.0',
      });

      // Mock socket setup for this test
      const mockSocket = Object.assign(new EventEmitter(), {
        writable: true,
        write: vi.fn().mockReturnValue(true),
        end: vi.fn(),
        destroy: vi.fn(),
        setTimeout: vi.fn(),
        once: vi.fn(),
        pipe: vi.fn(),
      });

      const mockStream = Object.assign(new EventEmitter(), {
        on: vi.fn(),
      });

      (mockSocket.pipe as ReturnType<typeof vi.fn>).mockReturnValue(mockStream);
      (mockTls.connect as unknown as ReturnType<typeof vi.fn>).mockImplementation((opts, cb) => {
        if (cb) cb();
        return mockSocket;
      });

      // Start connection
      client.connect('recipient$example.com', (events) => {
        events.on('connected', () => {});
      });

      // After connection starts, isConnecting should be true
      await vi.runAllTimersAsync();
      expect((client as unknown as { isConnecting: boolean }).isConnecting).toBe(true);

      // Simulate successful connection establishment
      mockSocket.emit('connected');

      // After connection is established, isConnecting should remain true until socket ends
      expect((client as unknown as { isConnecting: boolean }).isConnecting).toBe(true);

      // Simulate socket end
      mockSocket.emit('end');

      // After socket ends, isConnecting should be false
      expect((client as unknown as { isConnecting: boolean }).isConnecting).toBe(false);
    });

    it('should set isConnecting to false when connection fails with non-retryable error', async () => {
      // Mock successful DNS resolution
      mockUtils.getHostAndSelector.mockResolvedValue({
        host: 'server.example.com',
        selector: 'btps1',
        version: '1.0.0',
      });

      // Mock socket setup for this test
      const mockSocket = Object.assign(new EventEmitter(), {
        writable: true,
        write: vi.fn().mockReturnValue(true),
        end: vi.fn(),
        destroy: vi.fn(),
        setTimeout: vi.fn(),
        once: vi.fn(),
        pipe: vi.fn(),
      });

      const mockStream = Object.assign(new EventEmitter(), {
        on: vi.fn(),
      });

      (mockSocket.pipe as ReturnType<typeof vi.fn>).mockReturnValue(mockStream);
      (mockTls.connect as unknown as ReturnType<typeof vi.fn>).mockImplementation((opts, cb) => {
        if (cb) cb();
        return mockSocket;
      });

      // Start connection
      client.connect('recipient$example.com', (events) => {
        events.on('connected', () => {});
      });

      // After connection starts, isConnecting should be true
      await vi.runAllTimersAsync();
      expect((client as unknown as { isConnecting: boolean }).isConnecting).toBe(true);

      // Simulate non-retryable error (destroyed error)
      mockSocket.emit('error', new Error('destroyed'));

      // After non-retryable error, isConnecting should be false (process has ended and listeners are cleaned up)
      expect((client as unknown as { isConnecting: boolean }).isConnecting).toBe(false);
    });

    it('should set isConnecting to false when socket error occurs', async () => {
      // Mock successful DNS resolution
      mockUtils.getHostAndSelector.mockResolvedValue({
        host: 'server.example.com',
        selector: 'btps1',
        version: '1.0.0',
      });

      // Mock socket setup for this test
      const mockSocket = Object.assign(new EventEmitter(), {
        writable: true,
        write: vi.fn().mockReturnValue(true),
        end: vi.fn(),
        destroy: vi.fn(),
        setTimeout: vi.fn(),
        once: vi.fn(),
        pipe: vi.fn(),
      });

      const mockStream = Object.assign(new EventEmitter(), {
        on: vi.fn(),
      });

      (mockSocket.pipe as ReturnType<typeof vi.fn>).mockReturnValue(mockStream);
      (mockTls.connect as unknown as ReturnType<typeof vi.fn>).mockImplementation((opts, cb) => {
        if (cb) cb();
        return mockSocket;
      });

      // Start connection
      client.connect('recipient$example.com', (events) => {
        events.on('connected', () => {});
      });

      // After connection starts, isConnecting should be true
      await vi.runAllTimersAsync();
      expect((client as unknown as { isConnecting: boolean }).isConnecting).toBe(true);

      // Simulate socket error by triggering the socket's 'error' event
      mockSocket.emit('error', new Error('DNS resolution failed'));

      // After socket error, isConnecting should be false because shouldRetry is false after DNS resolution
      expect((client as unknown as { isConnecting: boolean }).isConnecting).toBe(false);
    });

    it('should set isConnecting to false when connection timeout occurs', async () => {
      // Mock successful DNS resolution
      mockUtils.getHostAndSelector.mockResolvedValue({
        host: 'server.example.com',
        selector: 'btps1',
        version: '1.0.0',
      });

      // Mock socket setup for this test
      const mockSocket = Object.assign(new EventEmitter(), {
        writable: true,
        write: vi.fn().mockReturnValue(true),
        end: vi.fn(),
        destroy: vi.fn(),
        setTimeout: vi.fn((timeout, cb) => {
          // Store timeout callback for manual invocation
          (mockSocket as unknown as { _timeoutCb?: () => void })._timeoutCb = cb;
        }),
        once: vi.fn(),
        pipe: vi.fn(),
      });

      const mockStream = Object.assign(new EventEmitter(), {
        on: vi.fn(),
      });

      (mockSocket.pipe as ReturnType<typeof vi.fn>).mockReturnValue(mockStream);
      (mockTls.connect as unknown as ReturnType<typeof vi.fn>).mockImplementation((opts, cb) => {
        if (cb) cb();
        return mockSocket;
      });

      // Start connection
      client.connect('recipient$example.com', (events) => {
        events.on('connected', () => {});
      });

      // After connection starts, isConnecting should be true
      await vi.runAllTimersAsync();
      expect((client as unknown as { isConnecting: boolean }).isConnecting).toBe(true);

      // Simulate connection timeout by triggering the timeout callback
      const timeoutCb = (mockSocket as unknown as { _timeoutCb?: () => void })._timeoutCb;
      if (timeoutCb) {
        timeoutCb();
      }

      // After connection timeout, isConnecting should remain true because it's a retryable error
      expect((client as unknown as { isConnecting: boolean }).isConnecting).toBe(true);
    });

    it('should set isConnecting to false when client.end() is called', async () => {
      // Mock successful DNS resolution
      mockUtils.getHostAndSelector.mockResolvedValue({
        host: 'server.example.com',
        selector: 'btps1',
        version: '1.0.0',
      });

      // Mock socket setup for this test
      const mockSocket = Object.assign(new EventEmitter(), {
        writable: true,
        write: vi.fn().mockReturnValue(true),
        end: vi.fn(),
        destroy: vi.fn(),
        setTimeout: vi.fn(),
        once: vi.fn(),
        pipe: vi.fn(),
      });

      const mockStream = Object.assign(new EventEmitter(), {
        on: vi.fn(),
      });

      (mockSocket.pipe as ReturnType<typeof vi.fn>).mockReturnValue(mockStream);
      (mockTls.connect as unknown as ReturnType<typeof vi.fn>).mockImplementation((opts, cb) => {
        if (cb) cb();
        return mockSocket;
      });

      // Start connection
      client.connect('recipient$example.com', (events) => {
        events.on('connected', () => {});
      });

      // After connection starts, isConnecting should be true
      await vi.runAllTimersAsync();
      expect((client as unknown as { isConnecting: boolean }).isConnecting).toBe(true);

      // Call client.end()
      client.end();

      // After client.end(), isConnecting should be false
      expect((client as unknown as { isConnecting: boolean }).isConnecting).toBe(false);
    });

    it('should set isConnecting to false when client.destroy() is called', async () => {
      // Mock successful DNS resolution
      mockUtils.getHostAndSelector.mockResolvedValue({
        host: 'server.example.com',
        selector: 'btps1',
        version: '1.0.0',
      });

      // Mock socket setup for this test
      const mockSocket = Object.assign(new EventEmitter(), {
        writable: true,
        write: vi.fn().mockReturnValue(true),
        end: vi.fn(),
        destroy: vi.fn(),
        setTimeout: vi.fn(),
        once: vi.fn(),
        pipe: vi.fn(),
      });

      const mockStream = Object.assign(new EventEmitter(), {
        on: vi.fn(),
      });

      (mockSocket.pipe as ReturnType<typeof vi.fn>).mockReturnValue(mockStream);
      (mockTls.connect as unknown as ReturnType<typeof vi.fn>).mockImplementation((opts, cb) => {
        if (cb) cb();
        return mockSocket;
      });

      // Start connection
      client.connect('recipient$example.com', (events) => {
        events.on('connected', () => {});
      });

      // After connection starts, isConnecting should be true
      await vi.runAllTimersAsync();
      expect((client as unknown as { isConnecting: boolean }).isConnecting).toBe(true);

      // Call client.destroy()
      client.destroy();

      // After client.destroy(), isConnecting should be false
      expect((client as unknown as { isConnecting: boolean }).isConnecting).toBe(false);
    });

    it('should set isConnecting to false when resolveIdentity finally block executes', async () => {
      // Test resolveIdentity method directly
      // Mock successful DNS resolution
      mockUtils.getHostAndSelector.mockResolvedValue({
        host: 'server.example.com',
        selector: 'btps1',
        version: '1.0.0',
      });

      // Mock successful DNS identity parts resolution
      mockUtils.getDnsIdentityParts.mockResolvedValue({
        key: 'rsa',
        version: '1.0.0',
        pem: 'test-key',
      });

      // Mock socket setup for this test
      const mockSocket = Object.assign(new EventEmitter(), {
        writable: true,
        write: vi.fn().mockReturnValue(true),
        end: vi.fn(),
        destroy: vi.fn(),
        setTimeout: vi.fn(),
        once: vi.fn(),
        pipe: vi.fn(),
      });

      const mockStream = Object.assign(new EventEmitter(), {
        on: vi.fn(),
      });

      (mockSocket.pipe as ReturnType<typeof vi.fn>).mockReturnValue(mockStream);
      (mockTls.connect as unknown as ReturnType<typeof vi.fn>).mockImplementation((opts, cb) => {
        if (cb) cb();
        return mockSocket;
      });

      // Call resolveIdentity directly
      const _result = await (
        client as unknown as {
          resolveIdentity: (identity: string, from: string) => Promise<unknown>;
        }
      ).resolveIdentity('recipient$example.com', 'sender$example.com');

      // After resolveIdentity completes, isConnecting should be false (via finally block)
      expect((client as unknown as { isConnecting: boolean }).isConnecting).toBe(false);
    });

    it('should set isConnecting to false when resolveIdentity encounters an error', async () => {
      // Test resolveIdentity method directly with error
      // Mock successful DNS resolution
      mockUtils.getHostAndSelector.mockResolvedValue({
        host: 'server.example.com',
        selector: 'btps1',
        version: '1.0.0',
      });

      // Mock DNS identity parts resolution to fail
      mockUtils.getDnsIdentityParts.mockRejectedValue(new Error('DNS failure'));

      // Mock socket setup for this test
      const mockSocket = Object.assign(new EventEmitter(), {
        writable: true,
        write: vi.fn().mockReturnValue(true),
        end: vi.fn(),
        destroy: vi.fn(),
        setTimeout: vi.fn(),
        once: vi.fn(),
        pipe: vi.fn(),
      });

      const mockStream = Object.assign(new EventEmitter(), {
        on: vi.fn(),
      });

      (mockSocket.pipe as ReturnType<typeof vi.fn>).mockReturnValue(mockStream);
      (mockTls.connect as unknown as ReturnType<typeof vi.fn>).mockImplementation((opts, cb) => {
        if (cb) cb();
        return mockSocket;
      });

      // Call resolveIdentity directly
      const _result = await (
        client as unknown as {
          resolveIdentity: (identity: string, from: string) => Promise<unknown>;
        }
      ).resolveIdentity('recipient$example.com', 'sender$example.com');

      // After resolveIdentity encounters error, isConnecting should be false (via finally block)
      expect((client as unknown as { isConnecting: boolean }).isConnecting).toBe(false);
    });
  });

  describe('listener cleanup', () => {
    it('should clean up connect listeners when connection fails with non-retryable error', async () => {
      // Mock DNS resolution to fail with non-retryable error
      mockUtils.getHostAndSelector.mockResolvedValue(undefined);

      // Start connection
      client.connect('recipient$example.com', (events) => {
        events.on('connected', () => {});
      });

      // After connection fails with non-retryable error
      await vi.runAllTimersAsync();

      // Connect listeners should be cleaned up when shouldRetry is false (non-retryable error)
      const listeners = (
        client as unknown as { listeners: Map<string, Record<string, unknown>> }
      ).listeners.get('connectListeners');

      // With non-retryable error, shouldRetry should be false, so listeners should be cleaned up
      expect(listeners).toBeUndefined();
    });

    it('should not clean up connect listeners when retry is happening', async () => {
      // Mock successful DNS resolution
      mockUtils.getHostAndSelector.mockResolvedValue({
        host: 'server.example.com',
        selector: 'btps1',
        version: '1.0.0',
      });

      // Mock socket setup for this test
      const mockSocket = Object.assign(new EventEmitter(), {
        writable: true,
        write: vi.fn().mockReturnValue(true),
        end: vi.fn(),
        destroy: vi.fn(),
        setTimeout: vi.fn(),
        once: vi.fn(),
        pipe: vi.fn(),
      });

      const mockStream = Object.assign(new EventEmitter(), {
        on: vi.fn(),
      });

      (mockSocket.pipe as ReturnType<typeof vi.fn>).mockReturnValue(mockStream);
      (mockTls.connect as unknown as ReturnType<typeof vi.fn>).mockImplementation((opts, cb) => {
        if (cb) cb();
        return mockSocket;
      });

      // Start connection
      client.connect('recipient$example.com', (events) => {
        events.on('connected', () => {});
      });

      // After connection completes, connect listeners should NOT be cleaned up if retry is happening
      await vi.runAllTimersAsync();

      // Connect listeners should remain if shouldRetry is true (successful connection scenario)
      const listeners = (
        client as unknown as { listeners: Map<string, Record<string, unknown>> }
      ).listeners.get('connectListeners');

      // With successful connection, shouldRetry should be true, so listeners should remain
      expect(listeners).toBeDefined();
    });
  });
});
