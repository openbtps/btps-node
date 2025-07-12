/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import type { BtpsServerOptions, ProcessedArtifact, ArtifactResCtx } from '../types.js';
import type {
  BTPStatus,
  BTPServerResponse,
  BTPAgentArtifact,
  BTPTransporterArtifact,
} from '@core/server/types.js';

// Type for the BtpsServer instance
interface BtpsServerInstance {
  start(): Promise<void>;
  stop(): void;
  forwardTo(handler: (msg: ProcessedArtifact) => Promise<void>): void;
  onIncomingArtifact(
    type: 'Agent' | 'Transporter',
    handler:
      | ((artifact: BTPAgentArtifact, resCtx: ArtifactResCtx) => void)
      | ((artifact: BTPTransporterArtifact) => void),
  ): void;
  getProtocolVersion(): string;
  prepareBtpsResponse(status: BTPStatus, reqId?: string): Omit<BTPServerResponse, 'type'>;
}

/**
 * Lightweight factory that uses dynamic imports to avoid bundling the full BtpsServer
 * until it's actually needed. This significantly reduces the initial bundle size.
 */
export class BtpsServerLightweightFactory {
  private static instance: BtpsServerInstance | null = null;

  static async create(config: BtpsServerOptions): Promise<BtpsServerInstance> {
    if (!this.instance) {
      // Dynamic import - only loads BtpsServer when create() is called
      const { BtpsServer } = await import('../btpsServer.js');
      this.instance = new BtpsServer(config);
    }
    return this.instance;
  }

  static reset() {
    this.instance = null;
  }
}

/**
 * Synchronous factory that creates the server immediately
 * Use this only if you need the server instance right away
 */
export class BtpsServerSyncFactory {
  private static instance: BtpsServerInstance | null = null;

  static async create(config: BtpsServerOptions): Promise<BtpsServerInstance> {
    if (!this.instance) {
      // This will import the full BtpsServer immediately
      const { BtpsServer } = await import('../btpsServer.js');
      this.instance = new BtpsServer(config);
    }
    return this.instance;
  }

  static reset() {
    this.instance = null;
  }
}
