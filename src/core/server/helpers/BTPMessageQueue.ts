import { BTPArtifact } from '@core/server/types.js';

export abstract class BTPMessageQueue {
  abstract add(message: BTPArtifact): Promise<void>;
  abstract getPending(): Promise<BTPArtifact[]>;
  abstract on(event: 'message', handler: (msg: BTPArtifact) => void): void;
  abstract markHandled(id: string): Promise<void>;
}
