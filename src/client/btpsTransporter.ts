/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { BTP_ERROR_IDENTITY, BTPErrorException } from '@core/error/index.js';
import { BtpsClient } from './btpsClient.js';
import type {
  BTPClientOptions,
  BTPTransporterOptions,
  BTPConnection,
  BTPClientResponse,
  UpdateBTPClientOptions,
  TypedEventEmitter,
  BtpsTransporterEvents,
  BTPConnectionInternal,
  BtpsClientEvents,
  BTPTransporterMetrics,
} from './types/index.js';
import { isValidIdentity } from '@core/utils/index.js';
import { BTP_PROTOCOL_VERSION, BTPTransporterArtifact } from 'server/index.js';
import {
  BTP_TRANSPORTER_DEFAULT_CONNECTION_TTL_SECONDS,
  BTP_TRANSPORTER_DEFAULT_MAX_CONNECTIONS,
  BTP_TRANSPORTER_ERROR_CONNECTION_ALREADY_EXISTS,
  BTP_TRANSPORTER_ERROR_MAX_CONNECTIONS_REACHED,
} from './constants.ts/index.js';
import { BtpTransporterArtifactSchema } from '@core/server/schemas/artifacts/transporterSchema.js';
import { validate } from '@core/utils/validation.js';
import { EventEmitter } from 'events';

export class BtpsTransporter {
  private connections: Map<string, BTPConnectionInternal> = new Map();
  private readonly connectionLock = new Map<string, Promise<void>>();
  private readonly clientOptions: Omit<BTPClientOptions, 'to'>;
  private maxConnections: number;
  private connectionTTLSeconds: number;
  private readonly emitter: EventEmitter = new EventEmitter();

  /*
   * @param options - The options for the transporter
   * @param options.maxConnections - The maximum number of connections to maintain
   * @param options.connectionTTLSeconds - The TTL for the connections
   * @param options.clientOptions - The options for the client
   * @description The transporter is the transporter that is currently created
   */
  constructor(options: BTPTransporterOptions) {
    const { maxConnections, connectionTTLSeconds, ...clientOptions } = options;

    this.maxConnections = maxConnections ?? BTP_TRANSPORTER_DEFAULT_MAX_CONNECTIONS;
    this.connectionTTLSeconds =
      (connectionTTLSeconds ?? BTP_TRANSPORTER_DEFAULT_CONNECTION_TTL_SECONDS) * 1000;

    this.clientOptions = {
      ...clientOptions,
    };
  }

  /*
   * @param to - The identity of the receiver
   * @param clientOptions - The options for the client
   * @returns The client
   * @description The client is the client that is currently created
   */
  private createClient(
    to: string,
    clientOptions?: BTPClientOptions,
  ): { client: BtpsClient; error: undefined } | { client: undefined; error: BTPErrorException } {
    try {
      return {
        client: new BtpsClient({
          to,
          ...(clientOptions ?? this.clientOptions),
        }),
        error: undefined,
      };
    } catch (error) {
      return { client: undefined, error: error as BTPErrorException };
    }
  }

  /*
   * @param connection - The connection to attach the listeners to
   * @description The connection is the connection that is currently registered
   */
  protected attachListeners(connection: BTPConnectionInternal) {
    // Create the listener functions and store them directly in the connection
    connection.listeners = {
      connected: () => {
        connection.isActive = true;
        this.emitter.emit('connectionConnected', connection.id);
      },
      end: (endInfo) => {
        connection.isActive = false;
        this.emitter.emit('connectionEnd', connection.id, endInfo);
      },
      error: (errorInfo) => {
        connection.isActive = false;
        this.emitter.emit('connectionError', connection.id, errorInfo);
      },
      message: (msg) => {
        connection.isActive = true;
        this.emitter.emit('connectionMessage', connection.id, msg);
      },
      close: (closeInfo) => {
        connection.isActive = false;
        this.emitter.emit('connectionClose', connection.id, closeInfo);
      },
    };
    (Object.keys(connection.listeners) as Array<keyof BtpsClientEvents>).forEach((event) => {
      connection.client.on(event, connection.listeners![event]);
    });
  }

  /*
   * @param connection - The connection to detach the listeners from
   * @description The connection is the connection that is currently registered
   */
  protected detachListeners(connection: BTPConnectionInternal) {
    if (!connection.listeners) return;
    (Object.keys(connection.listeners) as Array<keyof BtpsClientEvents>).forEach((event) => {
      connection.client.off(event, connection.listeners![event]);
    });
    // Clear the listeners reference
    delete connection.listeners;
  }

  /*
   * @param to - The identity of the receiver
   * @param clientOptions - The options for the client
   * @param override - Whether to override the existing connection
   * @returns The connection
   * @description The connection is the connection that is currently registered
   */
  protected async performConnectionRegistration(
    to: string,
    clientOptions?: BTPClientOptions,
    override: boolean = false,
  ): Promise<
    | { connection: BTPConnection; error: undefined }
    | { connection: undefined; error: BTPErrorException }
  > {
    if (!isValidIdentity(to)) {
      return {
        connection: undefined,
        error: new BTPErrorException(BTP_ERROR_IDENTITY, {
          cause: 'Invalid identity',
          meta: { to },
        }),
      };
    }

    const connection = this.connections.get(to);

    // If the connection already exists and override is false, throw an error
    if (connection) {
      if (!override) {
        return {
          connection: undefined,
          error: new BTPErrorException(BTP_TRANSPORTER_ERROR_CONNECTION_ALREADY_EXISTS, {
            cause: 'Connection already exists',
            meta: { to },
          }),
        };
      } else {
        this.deregisterConnection(to);
      }
    }

    const connectionCount = this.connections.size;
    if (connectionCount >= this.maxConnections) {
      return {
        connection: undefined,
        error: new BTPErrorException(BTP_TRANSPORTER_ERROR_MAX_CONNECTIONS_REACHED, {
          cause: 'Max connections reached',
          meta: { maxConnections: this.maxConnections },
        }),
      };
    }

    const dateNow = new Date().toISOString();
    const { client, error } = this.createClient(to, clientOptions);
    if (error) {
      return { connection: undefined, error };
    }

    const newConnection: BTPConnectionInternal = {
      id: to,
      client,
      createdAt: dateNow,
      updatedAt: dateNow,
      lastUsedAt: dateNow,
      isActive: false,
      clientOptions: clientOptions ?? { to, ...this.clientOptions },
      getStatus: () => client.getConnectionStates(),
      timeout: this.createConnectionTimeout(to),
    };

    this.connections.set(to, newConnection);
    this.attachListeners(newConnection);
    this.emitter.emit('connectionCreated', to);

    return { connection: newConnection, error: undefined };
  }

  /*
   * @param error - The error to build the client error response for
   * @returns The client error response
   * @description The client error response is the error response from the client
   */
  protected buildClientErrorResponse(error: BTPErrorException): Promise<BTPClientResponse> {
    return Promise.resolve({
      error,
    });
  }

  /*
   * @param connectionId - The id of the connection
   * @returns The timeout
   * @description The timeout is the timeout for the connection
   */
  protected createConnectionTimeout(connectionId: string): NodeJS.Timeout {
    return setTimeout(() => {
      this.deregisterConnection(connectionId);
    }, this.connectionTTLSeconds);
  }

  /*
   * @param to - The identity of the receiver
   * @param clientOptions - The options for the client
   * @param override - Whether to override the existing connection
   * @returns The connection
   * @description The connection is the connection that is currently registered
   */
  async registerConnection(
    to: string,
    clientOptions?: BTPClientOptions,
    override: boolean = false,
  ): Promise<BTPConnection> {
    // Prevent race conditions
    const existingLock = this.connectionLock.get(to);
    if (existingLock) {
      await existingLock;
    }

    const registrationPromise = this.performConnectionRegistration(to, clientOptions, override);
    const lockPromise = registrationPromise.then(() => {});
    this.connectionLock.set(to, lockPromise);

    const { connection, error } = await registrationPromise;
    this.connectionLock.delete(to);
    if (error) {
      throw error;
    }

    return connection;
  }

  /*
   * @param to - The identity of the receiver
   * @returns The connection
   * @description The connection is the connection that is currently registered
   */
  deregisterConnection(to: string): void {
    const connection = this.connections.get(to);
    if (!connection) return;
    const { client, timeout } = connection;
    this.detachListeners(connection);
    client.destroy();
    clearTimeout(timeout);
    this.connections.delete(to);
    this.emitter.emit('connectionDestroyed', to);
  }

  /*
   * @param to - The identity of the receiver
   * @param artifact - The artifact to transport
   * @param clientOptions - The options for the client
   * @returns The client response
   * @description The client response is the response from the client
   */
  async transport(
    to: string,
    artifact: BTPTransporterArtifact,
    clientOptions?: BTPClientOptions,
  ): Promise<BTPClientResponse> {
    const validationResult = validate(BtpTransporterArtifactSchema, artifact);
    if (!validationResult.success) {
      return this.buildClientErrorResponse(
        new BTPErrorException(
          { message: 'Invalid artifact' },
          { cause: { validationZodError: validationResult.error }, meta: { artifact } },
        ),
      );
    }

    let connection = this.getConnection(to);
    if (!connection) {
      connection = await this.registerConnection(to, clientOptions);
    }

    /* timeoutMs is the timeout for the client to send the artifact
     * by default if clientOptions is provided then use the connectionTimeoutMs
     * if not provided then send method will take care the its own default timeout
     */
    const timeoutMs = clientOptions?.connectionTimeoutMs ?? 5000;
    return connection.client.send(artifact, timeoutMs);
  }

  /*
   * @param to - The identity of the receiver
   * @param artifacts - The artifacts to transport
   * @param clientOptions - The options for the client
   * @returns The client responses
   * @description The client responses are the responses from the client
   */
  async transportBatch(
    to: string,
    artifacts: BTPTransporterArtifact[],
    clientOptions?: BTPClientOptions,
  ): Promise<BTPClientResponse[]> {
    return Promise.all(artifacts.map((artifact) => this.transport(to, artifact, clientOptions)));
  }

  /*
   * @returns The maximum number of connections
   * @description The maximum number of connections is the maximum number of connections that are currently allowed
   */
  getMaxConnections(): number {
    return this.maxConnections;
  }

  /*
   * @param maxConnections - The maximum number of connections
   * @description The maximum number of connections is the maximum number of connections that are currently allowed
   */
  setMaxConnections(maxConnections: number): void {
    this.maxConnections = maxConnections;
  }

  /*
   * @returns The connection TTL in seconds
   * @description The connection TTL in seconds is the TTL for the connections
   */
  getConnectionTTLSeconds(): number {
    return this.connectionTTLSeconds;
  }

  /*
   * @param connectionTTLSeconds - The connection TTL in seconds
   * @param updateExistingConnections - Whether to update the existing connections
   */
  updateConnectionTTLSeconds(
    connectionTTLSeconds: number,
    updateExistingConnections: boolean = false,
  ): void {
    this.connectionTTLSeconds = connectionTTLSeconds * 1000;
    if (updateExistingConnections) {
      this.connections.forEach((connection) => {
        this.updateConnection(connection.id, undefined, connectionTTLSeconds);
      });
    }
  }

  /*
   * @returns The client options
   * @description The client options are the options that are currently used for the client
   */
  getClientOptions(): Omit<BTPClientOptions, 'to'> {
    return this.clientOptions;
  }

  /*
   * @returns The protocol version
   * @description The protocol version is the version of the protocol that is currently used
   */
  getProtocolVersion(): string {
    return BTP_PROTOCOL_VERSION;
  }

  /*
   * @returns The connections
   * @description The connections are the connections that are currently registered
   */
  getConnections(): BTPConnection[] {
    return Array.from(this.connections.values()).map((connection) => {
      const { timeout, ...rest } = connection;
      return rest;
    });
  }

  /*
   * @param id - The id of the connection
   * @description The connection is the connection that is currently registered
   * @returns The connection
   */
  getConnection(id: string): BTPConnection | undefined {
    const connection = this.connections.get(id);
    if (!connection) {
      return undefined;
    }

    const { timeout, ...rest } = connection;
    return rest;
  }

  /*
   * @param id - The id of the connection
   * @param clientOptions - The options for the client
   * @param ttlSeconds - The TTL for the connection
   * @returns The connection
   */
  updateConnection(
    id: string,
    clientOptions?: UpdateBTPClientOptions,
    ttlSeconds?: number,
  ): BTPConnection | undefined {
    const connection = this.connections.get(id);
    if (!connection) return undefined;
    const { client, timeout } = connection;
    if (clientOptions) {
      client.update(clientOptions);
    }
    if (ttlSeconds) {
      clearTimeout(timeout);
      connection.timeout = setTimeout(() => {
        this.deregisterConnection(id);
      }, ttlSeconds * 1000);
    }
    connection.updatedAt = new Date().toISOString();
    this.emitter.emit('connectionUpdated', id);
    return connection;
  }

  /*
   * @returns The active connections
   * @description The active connections are the connections that are currently active
   */
  getActiveConnections(): BTPConnection[] {
    return Array.from(this.connections.values()).filter((connection) => connection.isActive);
  }

  /*
   * @returns The total number of connections
   * @description The total number of connections is the number of connections that are currently registered
   */
  getTotalConnections(): number {
    return this.connections.size;
  }

  /*
   * @returns The total number of active connections
   * @description The total number of active connections is the number of connections that are currently active
   */
  getTotalActiveConnections(): number {
    return this.getActiveConnections().length;
  }

  /*
   * @returns The metrics
   * @description The metrics are the total number of connections and the total number of active connections
   */
  getMetrics(): BTPTransporterMetrics {
    return {
      totalConnections: this.getTotalConnections(),
      activeConnections: this.getTotalActiveConnections(),
    };
  }

  /*
   * @param event - The event to listen to
   * @param listener - The listener function
   * @returns The transporter
   */
  on: TypedEventEmitter<BtpsTransporterEvents>['on'] = (event, listener) => {
    this.emitter.on(event, listener);
    return this;
  };

  /*
   * @param event - The event to listen to
   * @param listener - The listener function
   * @returns The transporter
   */
  off: TypedEventEmitter<BtpsTransporterEvents>['off'] = (event, listener) => {
    this.emitter.off(event, listener);
    return this;
  };

  /*
   * @returns The transporter
   */
  destroy(): void {
    this.connections.forEach((connection) => {
      this.deregisterConnection(connection.id);
    });
    this.connectionLock.clear();
    this.emitter.removeAllListeners();
    this.connections.clear();
  }
}
