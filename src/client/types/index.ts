/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import type { BTPCryptoOptions } from '@core/crypto/types.js';
import type { Signer } from '@core/crypto/signer-interface.js';
import type { Decrypter } from '@core/crypto/decrypter-interface.js';
import type { BtpsKeyResolver } from '@core/crypto/keyResolver.js';
import type { BTPErrorException } from '@core/error/index.js';
import type { BtpsClient } from 'client/btpsClient.js';
import type {
  BTPAgentMutation,
  BTPAgentQuery,
  BTPDocType,
  BTPIdsPayload,
  BTPAuthReqDoc,
  BTPServerResponse,
  BTPSyncOf,
  BTPDocumentType,
  BTPDetailPermission,
  BTPEntityType,
  BTPPermissionName,
  BTPTrustPermissions,
  BTPShaped,
  AgentAction,
} from 'server/index.js';
import type { ConnectionOptions, TLSSocket } from 'tls';

export interface BTPTransporterMetrics {
  totalConnections: number;
  activeConnections: number;
}

export interface BTPClientOptions {
  to: string;
  maxRetries?: number;
  retryDelayMs?: number;
  /** How long to wait to connect, in ms: at least 5000, 5000 by default */
  connectTimeoutMs?: number;
  /** How long `send()` waits for the answer, in ms: at least 10000, 20000 by default */
  replyTimeoutMs?: number;
  /** Closes the connection after this long with no artifact waiting for an answer, in ms; reconnects on the next send. Off when not set */
  connectionTimeoutMs?: number;
  btpMtsOptions?: Omit<ConnectionOptions, 'port' | 'host'>;
  host?: string;
  hostSelector?: string;
  /** With `host`: the identity operating that host, which signs its lookup answers. Otherwise read from DNS (`op`). */
  hostOperator?: string;
  /**
   * Since 1.2: take no answer but one signed by this identity under this selector, as a provider's
   * own app expects of its server: its domain's operator (for example `admin$saas.example`). Unsigned
   * answers, and those of any other signer, are refused. Off when not set.
   */
  requireSignedBy?: { identity: string; selector: string };
  /**
   * Since 1.2: finds the keys this client checks and encrypts with: an answer's signer (`verify`)
   * and, in `resolveIdentity`, the receiver's key (`encrypt`, before asking the receiver's host).
   * Without it, each is looked up in DNS, as before.
   */
  keyResolver?: BtpsKeyResolver;
  version?: string;
  port?: number;
  maxQueue?: number;
}

/** An agent and its device key: a PEM key pair, or a Signer (and Decrypter) holding it elsewhere, such as the device's own keystore. */
export type BTPAgent =
  | {
      id: string;
      identityKey: string;
      identityCert: string;
    }
  | {
      id: string;
      signer: Signer;
      decrypter?: Decrypter;
    };

export interface BTPAgentOptions extends Omit<BTPClientOptions, 'to'> {
  agent: BTPAgent;
  btpIdentity: string;
}

export interface BTPTransporterOptions extends Omit<BTPClientOptions, 'to'> {
  maxConnections?: number; // Max active connections allowed
  connectionTTLSeconds?: number; // Optional TTL per connection
}

export type BtpsAgentDoc =
  | BTPDocType
  | BTPAuthReqDoc
  | BTPAgentMutation
  | BTPIdsPayload
  | BTPAgentQuery;

export type BtpsAgentCommandOptions = BTPCryptoOptions & {
  /**
   * Required on `event.send`: the id of the `BTPS_DOC` artifact that delivered the invoice. Since 1.2, required on
   * `details.respond` (the `DETAILS_REQ` it answers) and allowed on `details.request` (the `DETAILS_CHANGED` it
   * follows). Refused elsewhere.
   */
  relatesTo?: string;
  /**
   * Since 1.2, required on `details.changed`, `details.request` and `details.respond`, and refused elsewhere: the
   * `detail:` names the artifact is about, set on its envelope. A `details.respond` is always encrypted.
   */
  details?: BTPDetailPermission[];
  /**
   * Since 1.2, on `artifact.send` to the device's own address only: this send is a sync, the user's own copy of
   * the send it names, by the sent artifact's id and the SHA-256 of its RFC 8785 form (`syncOfArtifact`).
   */
  syncOf?: BTPSyncOf;
  /**
   * Since 1.2, on `artifact.send` only: the document's type, named on the envelope, signed and readable, for a
   * send under a trust with permissions, whose receiver checks `send:<documentType>` is granted. It is the
   * document's own `type`, and stamps the artifact `1.2.0`, so leave it out for any other send.
   */
  documentType?: BTPDocumentType;
  /**
   * Since 1.2, on `trust.request` only: the permissions asked for, one flat list (see Trust permissions). With it,
   * `entityType` is required, and every detail asked for is given in `given`.
   */
  permissions?: BTPTrustPermissions;
  /** Since 1.2, on `trust.request` and `trust.respond`: what owns the user's address. Required with `permissions` and `granted`. */
  entityType?: BTPEntityType;
  /** Since 1.2, on `trust.request` only: the `detail:` names of the details the user gives; their values go in the document. */
  given?: BTPDetailPermission[];
  /** Since 1.2, on `trust.request` only: `true` for a change to an active trust, asking for the whole set now wanted. */
  change?: true;
  /** Since 1.2, on `trust.respond` only, and only when accepting: the permission names granted. */
  granted?: BTPPermissionName[];
  /**
   * The id of the artifact the command sends, a UUID. Sending the same document again after a lost answer under
   * the same id lets the receiver keep it once. Without it, a new id. An event always travels under its own id, so
   * on `event.send` it may only be that id.
   */
  id?: string;
};

export type BtpsAgentCommandParams = {
  actionType: AgentAction;
  to: string;
  document?: BtpsAgentDoc;
  options?: BtpsAgentCommandOptions;
};

export interface ConnectionStates {
  isConnecting: boolean;
  isConnected: boolean;
  /** Always false since 1.2: the socket buffers what it cannot send at once, and the client keeps no queue of its own. */
  isDraining: boolean;
  isDestroyed: boolean;
  shouldRetry: boolean;
}

export interface BTPSRetryInfo {
  willRetry: boolean;
  retriesLeft: number;
  attempt: number;
}

export type BtpsClientErrorInfo = BTPSRetryInfo & { error: BTPErrorException };

export interface UpdateBTPClientOptions {
  maxRetries?: number;
  retryDelayMs?: number;
  connectTimeoutMs?: number;
  replyTimeoutMs?: number;
  connectionTimeoutMs?: number;
  maxQueue?: number;
}

/** What the client emits on `connected`. */
export type BtpsClientConnectedInfo = {
  identity: string;
  retries: number;
  states: ConnectionStates;
  socket: TLSSocket;
};

export type BtpsClientEvents = {
  connected: (connectedInfo: BtpsClientConnectedInfo) => void;
  end: (endInfo: BtpsClientErrorInfo) => void;
  error: (errorInfo: BtpsClientErrorInfo) => void;
  message: (msg: BTPClientResponse & { validSignature: boolean }) => void;
  close: (closeInfo: BtpsClientErrorInfo) => void;
};

export type BTPConnectionInternal = BTPConnection & {
  timeout: NodeJS.Timeout;
  listeners?: BtpsClientEvents;
  /** Sends waiting for their answer: the connection is never closed while any are */
  inFlight: number;
  /** Set by updateConnection; the transporter's own TTL otherwise */
  ttlSeconds?: number;
};

export type BTPConnection = {
  id: string;
  client: BtpsClient;
  createdAt: string; // ISO string
  updatedAt: string; // ISO string
  lastUsedAt: string; // ISO string
  isActive: boolean; // Whether the connection is active
  clientOptions: BTPClientOptions;
  getStatus: () => ConnectionStates;
};

export type BTPConnectionUpdate = {
  clientOptions?: BTPClientOptions;
  ttl?: number;
  maxQueue?: number;
};

export type BtpsTransporterEvents = {
  connectionCreated: (connectionId: string) => void;
  connectionUpdated: (connectionId: string) => void;
  connectionDestroyed: (connectionId: string) => void;
  connectionError: (connectionId: string, errorInfo: BtpsClientErrorInfo) => void;
  connectionEnd: (connectionId: string, endInfo: BtpsClientErrorInfo) => void;
  connectionConnected: (connectionId: string) => void;
  connectionClose: (connectionId: string, closeInfo: BtpsClientErrorInfo) => void;
  connectionMessage: (
    connectionId: string,
    message: BTPClientResponse & { validSignature: boolean },
  ) => void;
};

export type TypedEventEmitter<T = BtpsClientEvents> = {
  on<K extends keyof T>(event: K, listener: T[K]): void;
  off<K extends keyof T>(event: K, listener: T[K]): void;
};

export interface BTPClientResponse {
  response?: BTPServerResponse;
  error?: BTPErrorException;
  /** Since 1.2: a trust request sent as its 1.1 receiver allows, and what it left out */
  shaped?: BTPShaped;
}

export type BtpsHostDnsTxt = {
  version: string;
  hostname: string;
  selector: string;
  port: number;
  /** The identity operating the host (`op`), when declared */
  operator?: string;
};
