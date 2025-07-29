/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { BTPArtifact } from '@core/server/types.js';
import { BTPSMessageQueue } from './BtpsMessageQueue.js';
import { EventEmitter } from 'events';
import { isBtpsIdentityRequest, isBtpsTransportArtifact } from '@core/utils/index.js';

type UserScopedQueue = {
  [identity: string]: BTPArtifact[];
};

export class InMemoryQueue extends BTPSMessageQueue {
  private queues: UserScopedQueue = {};
  private emitter = new EventEmitter();

  async add(message: BTPArtifact): Promise<void> {
    const key = isBtpsTransportArtifact(message)
      ? message.to
      : isBtpsIdentityRequest(message)
        ? message.from
        : message.agentId;
    if (!this.queues[key]) this.queues[key] = [];
    this.queues[key].push(message);
    this.emitter.emit('message', message);
  }

  async getPending(identity?: string): Promise<BTPArtifact[]> {
    if (identity) return [...(this.queues[identity] || [])];
    return Object.values(this.queues).flat();
  }

  async markHandled(id: string): Promise<void> {
    for (const key in this.queues) {
      this.queues[key] = this.queues[key].filter((msg) => msg.id !== id);
    }
  }

  on(event: 'message', handler: (msg: BTPArtifact) => void): void {
    this.emitter.on(event, handler);
  }
}
