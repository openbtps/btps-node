/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { BTPArtifact } from '@core/server/types.js';
import { BTPMessageQueue } from './BTPMessageQueue.js';
import { EventEmitter } from 'events';

type UserScopedQueue = {
  [identity: string]: BTPArtifact[];
};

export class InMemoryQueue extends BTPMessageQueue {
  private queues: UserScopedQueue = {};
  private emitter = new EventEmitter();

  async add(message: BTPArtifact): Promise<void> {
    const isTransporter = 'to' in message && 'from' in message;
    const key = isTransporter ? message.to : message.agentId;
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
