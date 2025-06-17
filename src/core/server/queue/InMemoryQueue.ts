import { BTPArtifact } from '@core/server/types';
import { BTPMessageQueue } from './BTPMessageQueue';
import { EventEmitter } from 'events';

type UserScopedQueue = {
  [identity: string]: BTPArtifact[];
};

export class InMemoryQueue extends BTPMessageQueue {
  private queues: UserScopedQueue = {};
  private emitter = new EventEmitter();

  async add(message: BTPArtifact): Promise<void> {
    const key = message.to;
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
