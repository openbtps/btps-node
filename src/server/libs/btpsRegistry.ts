import { BtpsServer } from 'server/btpsServer.js';
import { BtpsServerOptions } from 'server/types/index.js';

/**
 * BtpsServerFactory creates new BtpsServer instances from configuration.
 */
export class BtpsServerFactory {
  static create(config: BtpsServerOptions): BtpsServer {
    return new BtpsServer(config);
  }
}
