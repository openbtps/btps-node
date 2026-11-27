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
import { BTPErrorException, BTP_ERROR_CONNECTION_CLOSED } from '../core/error/index.js';
import * as utils from '../core/utils/index.js';
import { BTP_PROTOCOL_VERSION } from '../core/server/constants/index.js';
import type { BTPClientOptions } from './types/index.js';
import type { BTPArtifact } from '../core/server/types.js';

// --- Mocks ---
vi.mock('tls');
vi.mock('split2');
vi.mock('../core/utils/index');

const mockTls = vi.mocked(tls);
const mockUtils = vi.mocked(utils);
const mockSplit2 = vi.fn();

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
    ref: ReturnType<typeof vi.fn>;
    unref: ReturnType<typeof vi.fn>;
    destroyed: boolean;
  };
  let mockOptions: BTPClientOptions;
  let mockStream: EventEmitter & { on: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    mockSocket = Object.assign(new EventEmitter(), {
      writable: true,
      write: vi.fn().mockReturnValue(true),
      end: vi.fn(),
      destroy: vi.fn(),
      setTimeout: vi.fn(),
      once: vi.fn(),
      pipe: vi.fn(),
      ref: vi.fn(),
      unref: vi.fn(),
      destroyed: false,
    }) as EventEmitter & {
      writable: boolean;
      write: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
      destroy: ReturnType<typeof vi.fn>;
      setTimeout: ReturnType<typeof vi.fn>;
      once: ReturnType<typeof vi.fn>;
      pipe: ReturnType<typeof vi.fn>;
      ref: ReturnType<typeof vi.fn>;
      unref: ReturnType<typeof vi.fn>;
      destroyed: boolean;
    };

    mockStream = Object.assign(new EventEmitter(), {
      on: vi.fn(),
    });
    (mockSocket.pipe as ReturnType<typeof vi.fn>).mockReturnValue(mockStream);

    // Mock tls.connect to return socket immediately
    (mockTls.connect as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockSocket);

    (split2 as unknown as typeof mockSplit2).mockReturnValue(mockStream);

    mockOptions = {
      to: 'test$example.com',
      maxRetries: 2,
      retryDelayMs: 10,
      connectionTimeoutMs: 100,
      maxQueue: 10,
      btpMtsOptions: {
        rejectUnauthorized: false,
      },
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
    mockUtils.isValidIdentity.mockImplementation((identity?: string) => {
      if (!identity) return false;
      return identity.includes('$') && identity.split('$').length === 2;
    });
    mockUtils.getDnsIdentityParts.mockResolvedValue({
      key: 'test-key',
      version: '1.0.0',
      pem: 'test-pem',
    });

    client = new BtpsClient(mockOptions);

    // Mock the network-dependent methods to prevent actual network calls
    vi.spyOn(client, 'resolveBtpsHostDnsTxt').mockResolvedValue({
      hostname: 'localhost',
      port: 3443,
      selector: 'btps1',
      version: '1.0.0',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    client.destroy();
  });

  describe('constructor', () => {
    it('should construct with valid options', () => {
      expect(client).toBeInstanceOf(BtpsClient);
    });

    it('should throw error for invalid to identity', () => {
      expect(() => {
        new BtpsClient({ ...mockOptions, to: 'invalid-identity' });
      }).toThrow(BTPErrorException);
    });

    it('should throw error for missing to identity', () => {
      expect(() => {
        new BtpsClient({ ...mockOptions, to: undefined as unknown as string });
      }).toThrow(BTPErrorException);
    });
  });

  describe('connection states', () => {
    it('should return correct initial connection states', () => {
      const states = client.getConnectionStates();
      expect(states).toEqual({
        isConnecting: false,
        isConnected: false,
        isDraining: false,
        isDestroyed: false,
        shouldRetry: true,
      });
    });

    it('should update connection states when destroyed', () => {
      client.destroy();
      const states = client.getConnectionStates();
      expect(states.isDestroyed).toBe(true);
    });
  });

  describe('utility methods', () => {
    it('should return correct protocol version', () => {
      expect(client.getProtocolVersion()).toBe(BTP_PROTOCOL_VERSION);
    });

    it('should return connection states', () => {
      const states = client.getConnectionStates();
      expect(states).toBeDefined();
      expect(states.isConnected).toBeDefined();
      expect(states.isConnecting).toBeDefined();
      expect(states.isDestroyed).toBeDefined();
    });

    it('should handle event listeners', () => {
      const listener = vi.fn();
      client.on('connected', listener);
      client.off('connected', listener);
      client.removeAllListeners();
    });

    it('should end connection properly', () => {
      expect(() => client.end()).not.toThrow();
    });

    it('should destroy client properly', () => {
      expect(() => client.destroy()).not.toThrow();
    });
  });

  describe('a write the socket cannot send at once', () => {
    // A large encrypted document: past the socket's buffer, so write() asks the writer to wait.
    const large = {
      id: 'large-id',
      from: 'test$example.com',
      to: 'recipient$example.com',
      type: 'BTPS_DOC' as const,
      issuedAt: '2023-01-01T00:00:00.000Z',
      document: 'x'.repeat(100_000),
      version: BTP_PROTOCOL_VERSION,
      encryption: {
        algorithm: 'aes-256-gcm' as const,
        encryptedKey: 'AA==',
        iv: 'AA==',
        authTag: 'AA==',
        type: 'standardEncrypt' as const,
      },
      selector: 'btps1',
      signature: { algorithmHash: 'sha256' as const, value: 'test-sig', fingerprint: 'test-fp' },
    };

    const sendOn = () => {
      mockSocket.write.mockReturnValue(false);
      client['socket'] = mockSocket as unknown as tls.TLSSocket;
      client['states'].isConnected = true;
      client['attachListeners'](mockSocket as unknown as tls.TLSSocket);
      client['sendArtifact'](large);
    };

    it('is left to the socket to buffer, and never written a second time', async () => {
      sendOn();
      mockSocket.emit('drain');
      await vi.runAllTimersAsync();

      expect(mockSocket.write).toHaveBeenCalledOnce();
      expect(client.getConnectionStates().isDraining).toBe(false);
    });

    it('is not kept by the client once written', () => {
      sendOn();
      const line = JSON.stringify(large) + '\n';
      const holds = (value: unknown): boolean =>
        value === line || (Array.isArray(value) && value.some(holds));

      expect(Object.values(client).some(holds)).toBe(false);
    });
  });

  describe('an error the server could not tie to a request', () => {
    const idlessError = JSON.stringify({
      version: BTP_PROTOCOL_VERSION,
      status: { ok: false, code: 400, message: 'Invalid JSON' },
      id: 'srv-1',
      issuedAt: new Date().toISOString(),
      type: 'btps_error',
    });
    const pending = (id: string) => {
      const resolve = vi.fn();
      client['queue'].set(id, {
        artifact: { id } as BTPArtifact,
        resolve,
        timeout: setTimeout(() => {}, 0),
      });
      return resolve;
    };

    it('goes to the one send that is waiting', async () => {
      const resolve = pending('only');

      await client['onData'](idlessError);

      expect(resolve).toHaveBeenCalledWith({
        response: JSON.parse(idlessError),
        error: undefined,
      });
      expect(client['queue'].size).toBe(0);
    });

    it('goes to no send when several are waiting', async () => {
      const first = pending('a');
      const second = pending('b');
      const heard = vi.fn();
      client['emitter'].on('message', heard);

      await client['onData'](idlessError);

      expect(first).not.toHaveBeenCalled();
      expect(second).not.toHaveBeenCalled();
      expect(heard).toHaveBeenCalled();
    });
  });

  describe('a connection that ends', () => {
    const fakeSocket = () => {
      const socket = Object.assign(new EventEmitter(), {
        destroyed: false,
        writableEnded: false,
        pipe: vi.fn().mockReturnValue(new EventEmitter()),
        unref: vi.fn(),
        destroy: vi.fn(),
      });
      return socket as unknown as tls.TLSSocket & EventEmitter;
    };
    const waitingOn = (id: string, socket: tls.TLSSocket) => {
      const resolve = vi.fn();
      client['queue'].set(id, {
        artifact: { id } as BTPArtifact,
        resolve,
        timeout: setTimeout(() => {}, 0),
        socket,
      });
      return resolve;
    };

    it('fails only the sends written to it: an older connection closing late leaves the current one alone', async () => {
      const older = fakeSocket();
      const current = fakeSocket();
      client['attachListeners'](older);
      client['attachListeners'](current);
      client['socket'] = current;
      client['states'].isConnected = true;
      const lost = waitingOn('on-older', older);
      const kept = waitingOn('on-current', current);

      older.emit('close');
      await vi.waitFor(() => expect(lost).toHaveBeenCalled());

      expect(lost.mock.calls[0]?.[0].error.code).toBe(BTP_ERROR_CONNECTION_CLOSED.code);
      expect(kept).not.toHaveBeenCalled();
      expect(client['queue'].has('on-current')).toBe(true);
      expect(client['socket']).toBe(current);
      expect(client['states'].isConnected).toBe(true);
    });

    it('is not written to again once the server has ended it', () => {
      const ended = fakeSocket();
      client['attachListeners'](ended);
      client['socket'] = ended;
      client['states'].isConnected = true;

      ended.emit('end');

      expect(client['isOpen'](ended)).toBe(false);
    });
  });

  describe('errors with nobody listening', () => {
    it('logs an unreadable line instead of throwing an unheard error event', async () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(client['emitter'].listenerCount('error')).toBe(0);

      await expect(client['onData']('not json')).resolves.toBeUndefined();

      expect(logged).toHaveBeenCalledWith('[BtpsClient]::Unhandled error:', expect.anything());
      logged.mockRestore();
    });

    it('still hands the error to a listener when there is one', async () => {
      const listener = vi.fn();
      client.on('error', listener);

      await client['onData']('not json');

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });
});
