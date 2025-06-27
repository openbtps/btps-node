/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { BTPErrorException } from '@core/error/index.js';
import { IMetricsTracker } from './type.js';

export class BtpsSimpleMetricsTracker implements IMetricsTracker {
  onMessageReceived(sender: string, recipient?: string) {
    console.log(`[Metrics] Received message from ${sender}${recipient ? ` to ${recipient}` : ''}`);
  }

  onMessageRejected(sender: string, recipient: string, reason: string) {
    console.warn(`[Metrics] Rejected message from ${sender} to ${recipient}: ${reason}`);
  }

  onError(error: BTPErrorException) {
    console.error(`[Metrics] Error:`, error.toJSON());
  }
}
