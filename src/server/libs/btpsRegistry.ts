/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { BtpsServer } from 'server/btpsServer.js';
import { BtpsServerOptions } from 'server/types.js';

/**
 * BtpsServerFactory creates new BtpsServer instances from configuration.
 */
export class BtpsServerFactory {
  static create(config: BtpsServerOptions): BtpsServer {
    return new BtpsServer(config);
  }
}
