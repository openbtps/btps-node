/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { BTPArtifact } from '@core/server/types.js';

export abstract class BTPMessageQueue {
  abstract add(message: BTPArtifact): Promise<void>;
  abstract getPending(): Promise<BTPArtifact[]>;
  abstract on(event: 'message', handler: (msg: BTPArtifact) => void): void;
  abstract markHandled(id: string): Promise<void>;
}
