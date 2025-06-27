/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { BtpsServer } from 'server/btpsServer.js';
import { BtpsServerOptions } from 'server/types/index.js';

/**
 * BtpsServerRegistry keeps track of multiple named BtpsServer instances.
 */
export class BtpsServerRegistry {
  private static servers = new Map<string, BtpsServer>();

  static register(id: string, server: BtpsServer) {
    this.servers.set(id, server);
  }

  static get(id: string): BtpsServer | undefined {
    return this.servers.get(id);
  }

  static async start(id: string): Promise<void> {
    const server = this.servers.get(id);
    if (server) {
      await server.start();
    } else {
      console.warn(`[BtpsServerRegistry] Server with id '${id}' not found.`);
    }
  }

  static stop(id: string): void {
    const server = this.servers.get(id);
    if (server) {
      server.stop();
    } else {
      console.warn(`[BtpsServerRegistry] Server with id '${id}' not found.`);
    }
  }

  static async startAll() {
    const startPromises = Array.from(this.servers.values()).map((server) => server.start());
    await Promise.all(startPromises);
  }

  static stopAll() {
    for (const server of this.servers.values()) {
      server.stop();
    }
  }

  static clear() {
    this.servers.clear();
  }
}

/**
 * BtpsServerFactory creates singleton BtpsServer instances from configuration.
 */
export class BtpsServerSingletonFactory {
  private static instance: BtpsServer | null = null;

  static create(config: BtpsServerOptions): BtpsServer {
    if (!this.instance) {
      this.instance = new BtpsServer(config);
    }
    return this.instance;
  }

  static reset() {
    this.instance = null;
  }
}
