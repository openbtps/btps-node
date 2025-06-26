import tls, { ConnectionOptions, TLSSocket } from 'tls';
import { EventEmitter } from 'events';
import split2 from 'split2';
import { getBtpAddressParts, getDnsParts, parseIdentity } from '@core/utils/index.js';
import {
  BTPClientResponse,
  BtpsClientOptions,
  BTPSRetryInfo,
  SendBTPArtifact,
  TypedEventEmitter,
} from './types/index.js';
import {
  BTP_ERROR_IDENTITY,
  BTPErrorException,
  transformToBTPErrorException,
} from '@core/error/index.js';
import isEmpty from 'lodash/isEmpty.js';
import { signEncrypt, BTPCryptoResponse } from '@core/crypto/index.js';
import { BTPDocType, BTPServerResponse } from '@core/server/types.js';
import { BTP_PROTOCOL_VERSION } from 'server/index.js';
import { validate } from '@core/utils/validation.js';
import { BtpArtifactClientSchema } from '@core/server/schema.js';

export class BtpsClient {
  private socket?: TLSSocket;
  private emitter = new EventEmitter();
  private retries = 0;
  private backpressureQueue: string[] = [];
  private isDraining = false;
  private destroyed = false;
  private shouldRetry = true;
  private isConnecting = false;

  constructor(private options: BtpsClientOptions) {}

  private initializeConnection(receiverId: string, tlsOptions: ConnectionOptions): void {
    if (this.destroyed) {
      this.resolveError(new BTPErrorException({ message: 'BtpsClient instance is destroyed' }));
      return;
    }

    this.socket = tls.connect(tlsOptions, () => {
      this.retries = 0;
      this.emitter.emit('connected');
    });

    if (this.options.connectionTimeoutMs) {
      this.socket.setTimeout(this.options.connectionTimeoutMs, () => {
        this.socket?.destroy();
        const errorInfo = this.resolveError(
          new BTPErrorException({ message: 'Connection timeout' }),
        );
        if (errorInfo.willRetry) this.retryConnect(receiverId);
      });
    }

    this.socket.on('error', (err) => {
      const error = transformToBTPErrorException(err);
      const info = this.resolveError(error);
      if (info.willRetry) this.retryConnect(receiverId);
    });

    this.socket.on('end', () => {
      const info = this.getRetryInfo();
      this.emitter.emit('end', info);
      this.isConnecting = false;
      if (info.willRetry) this.retryConnect(receiverId);
    });

    this.socket.pipe(split2()).on('data', (line: string) => {
      try {
        const msg: BTPServerResponse = JSON.parse(line);
        this.shouldRetry = false;
        this.emitter.emit('message', msg);
        this.socket?.end();
        this.isConnecting = false;
      } catch (e) {
        const err = new SyntaxError(`Invalid JSON: ${e}`);
        this.shouldRetry = false;
        this.isConnecting = false;
        this.emitter.emit('error', { error: err, ...this.getRetryInfo(err) });
      }
    });

    this.socket.on('drain', () => {
      this.flushBackpressure().catch((err) => {
        const error = transformToBTPErrorException(err);
        this.resolveError(error);
      });
    });
  }

  private resolveBtpAddress(receiverId: string) {
    return new Promise<string | undefined>((resolve) => {
      if (this.options.host) {
        resolve(this.options.host);
        return;
      }

      getDnsParts(receiverId, 'btpAddress')
        .then((btpAddress) => {
          if (!btpAddress) {
            resolve(undefined);
            return;
          }
          resolve(btpAddress);
        })
        .catch(() => {
          resolve(undefined);
        });
    });
  }

  private retryConnect(receiverId: string) {
    const maxRetries = this.options.maxRetries ?? 5;
    const delay = this.options.retryDelayMs ?? 1000;
    if (this.retries >= maxRetries) return;

    this.retries++;
    setTimeout(() => {
      this.connect(receiverId);
    }, delay);
  }

  private resolveError(error: BTPErrorException) {
    const errorInfo = this.getRetryInfo({ message: error.message });
    if (errorInfo.willRetry) {
      this.isConnecting = false;
    }

    if (this.emitter.listenerCount('error') === 0) {
      // No error handler registered: log instead of emitting
      console.error('[BtpsClient]::Unhandled error:', error);
    } else {
      this.emitter.emit('error', { ...errorInfo, error });
    }
    return errorInfo;
  }

  private buildClientErrorResponse(error: BTPErrorException): BTPClientResponse {
    return { response: undefined, error };
  }

  private async signEncryptArtifact(
    artifact: SendBTPArtifact,
  ): Promise<BTPCryptoResponse<BTPDocType>> {
    const { to, signature, encryption, ...restArtifact } = artifact;
    const { identity, bptIdentityCert: publicKey, btpIdentityKey: privateKey } = this.options;
    const parsedSender = parseIdentity(identity);
    if (!parsedSender) {
      return {
        payload: undefined,
        error: new BTPErrorException(BTP_ERROR_IDENTITY, {
          cause: `couldn't parse senderIdentity: ${identity}`,
        }),
      };
    }

    return await signEncrypt(
      to,
      { ...parsedSender, pemFiles: { publicKey, privateKey } },
      restArtifact,
      { signature, encryption },
    );
  }

  private async flushBackpressure(): Promise<void> {
    if (this.isDraining) return;
    this.isDraining = true;

    try {
      while (this.backpressureQueue.length && this.socket?.writable) {
        const chunk = this.backpressureQueue.shift();
        if (!chunk) break;

        const canWrite = this.socket.write(chunk);
        if (!canWrite) {
          await new Promise<void>((resolve) => this.socket!.once('drain', resolve));
        }
      }
    } finally {
      this.isDraining = false;
    }
  }

  private getRetryInfo(forError?: unknown): BTPSRetryInfo {
    const maxRetries = this.options.maxRetries ?? 5;
    let willRetry = this.retries < maxRetries;

    if (
      this.destroyed ||
      forError instanceof SyntaxError ||
      this.isNonRetryableError(forError) ||
      !this.shouldRetry
    ) {
      willRetry = false;
    }

    return {
      willRetry,
      retriesLeft: willRetry ? maxRetries - this.retries - 1 : 0,
      attempt: this.retries,
    };
  }

  private isNonRetryableError(err: unknown): boolean {
    const message = (err as BTPErrorException)?.message ?? ''.toLowerCase();
    const nonRetrayableError = [
      'invalid identity',
      'invalid btpAddress',
      'invalid hostname',
      'unsupported protocol',
      'signature verification failed',
      'destroyed',
    ];
    return nonRetrayableError.includes(message);
  }

  connect(receiverId: string, callbacks?: (events: TypedEventEmitter) => void) {
    if (this.isConnecting) {
      this.resolveError(new BTPErrorException({ message: 'Already connecting' }));
      return;
    }

    this.isConnecting = true;
    callbacks?.({
      on: (event, listener) => this.emitter.on(event, listener),
    });

    const parsedIdentity = parseIdentity(receiverId);
    if (!parsedIdentity) {
      this.resolveError(new BTPErrorException({ message: `invalid identity: ${receiverId}` }));
      return;
    }

    this.resolveBtpAddress(receiverId)
      .then((btpAddress) => {
        if (!btpAddress) {
          this.resolveError(
            new BTPErrorException({
              message: `DNS resolution failed for ${receiverId}: No btpAddress record found`,
            }),
          );
          return;
        }

        const { port = '', hostname } = getBtpAddressParts(btpAddress) || {};
        if (isEmpty(hostname)) {
          this.resolveError(new BTPErrorException({ message: `invalid hostname: ${hostname}` }));
          return;
        }

        const tlsPort = isEmpty(port) ? (this.options.port ?? 3443) : parseInt(port, 10);

        const tlsOptions = {
          ...this.options.btpMtsOptions,
          host: hostname,
          port: tlsPort,
        };
        this.initializeConnection(receiverId, tlsOptions);
      })
      .catch((error) => {
        this.resolveError(
          new BTPErrorException({
            message: `DNS resolution failed for ${receiverId}: ${error?.message || error}`,
          }),
        );
      });
  }

  async send(artifact: SendBTPArtifact): Promise<BTPClientResponse> {
    // Check if client is destroyed
    if (this.destroyed) {
      return this.buildClientErrorResponse(
        new BTPErrorException({ message: 'BtpsClient instance is destroyed' }),
      );
    }

    const validationResult = validate(BtpArtifactClientSchema, artifact);
    if (!validationResult.success) {
      return this.buildClientErrorResponse(
        new BTPErrorException(
          { message: 'Invalid artifact' },
          { cause: { validationZodError: validationResult.error } },
        ),
      );
    }

    try {
      return await new Promise<BTPClientResponse>((resolve) => {
        let messageReceived = false;
        this.connect(artifact.to, (events) => {
          events.on('connected', async () => {
            const { payload, error } = await this.signEncryptArtifact(artifact);
            if (error) return resolve(this.buildClientErrorResponse(error));
            // add version to the payload
            const payloadWithVersion = { ...payload, version: BTP_PROTOCOL_VERSION };
            const serialized = JSON.stringify(payloadWithVersion) + '\n';
            if (!this.socket?.write(serialized)) {
              this.backpressureQueue.push(serialized);
              this.isDraining = true;
            }
          });

          events.on('message', (msg) => {
            messageReceived = true;
            resolve({ response: msg, error: undefined });
          });

          events.on('error', (errors) => {
            const { error, ...restErrors } = errors;
            // Only resolve if no message received and no more retries
            if (restErrors.willRetry) {
              console.log(
                `[BtpsClient]:: Retrying...for...${artifact.to}`,
                JSON.stringify(errors, null, 2),
              );
            }
            if (!messageReceived && !restErrors.willRetry) {
              const btpError = new BTPErrorException(error, { cause: restErrors });
              resolve(this.buildClientErrorResponse(btpError));
            }
            // If willRetry is true, don't resolve - let retry logic handle it
          });

          events.on('end', ({ willRetry }) => {
            if (!messageReceived && !willRetry) {
              resolve(
                this.buildClientErrorResponse(
                  new BTPErrorException({
                    message: 'Connection ended before message was received',
                  }),
                ),
              );
            }
            // If willRetry is true, don't resolve - let retry logic handle it
          });
        });
      });
    } catch (err: unknown) {
      return { response: undefined, error: transformToBTPErrorException(err) };
    }
  }

  end(): void {
    this.isConnecting = false;
    this.socket?.end();
  }

  destroy(): void {
    this.isConnecting = false;
    this.destroyed = true;
    this.backpressureQueue = [];
    this.socket?.destroy();
    this.shouldRetry = false;
    this.emitter.removeAllListeners();
  }
}
