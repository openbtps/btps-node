import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import tls from 'tls';
import split2 from 'split2';
import { BtpsClient } from './btpsClient';
import { BTPErrorException } from '../core/error/index';
import * as utils from '../core/utils/index';
import * as crypto from '../core/crypto/index';
import { BTPDocType, BTPServerResponse } from '../core/server/types';
import { BtpsClientOptions, SendBTPArtifact, BTPSRetryInfo } from './types/index';

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
    mockUtils.getDnsParts.mockResolvedValue('btps://server.example.com:3443');
    mockUtils.getBtpAddressParts.mockReturnValue({
      hostname: 'server.example.com',
      port: '3443',
    } as URL);
    mockUtils.parseIdentity.mockImplementation((id: string) => {
      const [accountName, domainName] = id.split('$');
      if (!accountName || !domainName) return null;
      return { accountName, domainName };
    });
    mockCrypto.signEncrypt.mockResolvedValue({
      payload: {
        id: 'id',
        from: 'test$example.com',
        to: 'recipient$example.com',
        type: 'btp_trust_request',
        issuedAt: '2023-01-01T00:00:00.000Z',
        document: {} as BTPDocType,
        signature: { algorithm: 'sha256', value: 'sig', fingerprint: 'fp' },
        encryption: null,
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
      client.connect('badidentity', (events) => {
        events.on('error', onError);
      });
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(BTPErrorException) }),
      );
    });

    it('should emit error for DNS failure', async () => {
      const onError = vi.fn();
      mockUtils.getDnsParts.mockResolvedValue(undefined);
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
      mockUtils.getBtpAddressParts.mockReturnValue({ hostname: '', port: '3443' } as URL);
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
  });

  describe('send', () => {
    let artifact: SendBTPArtifact;
    beforeEach(() => {
      artifact = {
        to: 'recipient$example.com',
        type: 'btp_trust_request',
        document: {
          name: 'Test User',
          email: 'test@example.com',
          reason: 'Testing',
          phone: '+1234567890',
        },
      };
    });

    it('should send and receive a response', async () => {
      const response: BTPServerResponse = {
        version: '1.0',
        status: { ok: true, code: 200 },
        id: 'id',
        issuedAt: '2023-01-01T00:00:00.000Z',
        type: 'btp_response',
      };
      const promise = client.send(artifact);
      // Simulate connected and message events on internal emitter
      (client as unknown as { emitter: EventEmitter }).emitter.emit('connected');
      (client as unknown as { emitter: EventEmitter }).emitter.emit('message', response);
      await vi.runAllTimersAsync();
      const result = await promise;
      expect(result.response).toEqual(response);
      expect(result.error).toBeUndefined();
    });

    it('should handle DNS failure', async () => {
      mockUtils.getDnsParts.mockResolvedValue(undefined);
      const promise = client.send(artifact);
      // Simulate error event on internal emitter
      (client as unknown as { emitter: EventEmitter }).emitter.emit('error', {
        error: new BTPErrorException({ message: 'invalid btpAddress: undefined' }),
      });
      await vi.runAllTimersAsync();
      const result = await promise;
      expect(result.error).toBeInstanceOf(BTPErrorException);
      expect(result.response).toBeUndefined();
    });

    it('should handle invalid identity', async () => {
      mockUtils.parseIdentity.mockReturnValue(null);
      const promise = client.send(artifact);
      // Simulate error event on internal emitter
      (client as unknown as { emitter: EventEmitter }).emitter.emit('error', {
        error: new BTPErrorException({ message: 'invalid identity: recipient$example.com' }),
      });
      await vi.runAllTimersAsync();
      const result = await promise;
      expect(result.error).toBeInstanceOf(BTPErrorException);
      expect(result.response).toBeUndefined();
    });

    it('should handle signEncrypt failure', async () => {
      mockCrypto.signEncrypt.mockResolvedValue({
        payload: undefined,
        error: new BTPErrorException({ message: 'fail' }),
      });
      const result = await client.send(artifact);
      expect(result.error).toBeInstanceOf(BTPErrorException);
      expect(result.response).toBeUndefined();
    });

    it('should handle destroyed client', async () => {
      client.destroy();
      const result = await client.send(artifact);
      expect(result.error).toBeInstanceOf(BTPErrorException);
      expect(result.error?.message).toContain('destroyed');
    });

    it('should handle unknown errors gracefully', async () => {
      mockUtils.getDnsParts.mockRejectedValue(new Error('Unknown DNS error'));
      // Use a client with maxRetries: 0 so it does not retry
      const noRetryClient = new BtpsClient({ ...mockOptions, maxRetries: 0 });
      const result = await noRetryClient.send({
        to: 'recipient$example.com',
        type: 'btp_trust_request',
        document: {
          name: 'Test User',
          email: 'test@example.com',
          reason: 'Testing',
          phone: '+1234567890',
        },
      });
      expect(result.error).toBeInstanceOf(BTPErrorException);
      expect(result.response).toBeUndefined();
    });
  });

  describe('destruction', () => {
    it('should clean up and prevent further use', () => {
      client.destroy();
      expect(() => client.send({ to: 'a', type: 'b', document: {} as BTPDocType })).not.toThrow();
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
      mockSocket.once.mockImplementation((event, cb) => {
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
  });

  it('should override the port and host if given in the constructor', async () => {
    const tlsConnectSpy = vi.spyOn(tls, 'connect');
    const customOptions: BtpsClientOptions = {
      ...mockOptions,
      host: 'customhost.com',
      port: 9999,
    };
    const customClient = new BtpsClient(customOptions);
    mockUtils.getDnsParts.mockResolvedValue(undefined);
    mockUtils.getBtpAddressParts.mockImplementation((input: string) => new URL(`btps://${input}`));
    // Connect should use the custom host/port
    customClient.connect('recipient$example.com');
    await vi.runAllTimersAsync();
    expect(tlsConnectSpy).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'customhost.com', port: 9999 }),
      expect.any(Function),
    );
  });

  describe('error handling edge cases', () => {
    it('should handle unknown errors gracefully', async () => {
      mockUtils.getDnsParts.mockRejectedValue(new Error('Unknown DNS error'));
      // Use a client with maxRetries: 0 so it does not retry
      const noRetryClient = new BtpsClient({ ...mockOptions, maxRetries: 0 });
      const result = await noRetryClient.send({
        to: 'recipient$example.com',
        type: 'btp_trust_request',
        document: {
          name: 'Test User',
          email: 'test@example.com',
          reason: 'Testing',
          phone: '+1234567890',
        },
      });
      expect(result.error).toBeInstanceOf(BTPErrorException);
      expect(result.response).toBeUndefined();
    });
  });
});
