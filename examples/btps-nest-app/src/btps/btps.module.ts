import { Module } from '@nestjs/common';
import { BtpsService } from './btps.service.js';
import { BtpsConfigService } from './config/btps.config.js';
import { BtpsMiddlewareConfigService } from './middleware/btps-middleware-config.service.js';
import { DatabaseModule } from '../database/database.module.js';
import { BtpsAuthService } from './services/btpsAuth.service.js';

@Module({
  imports: [DatabaseModule],
  providers: [
    BtpsService,
    BtpsConfigService,
    BtpsMiddlewareConfigService,
    BtpsAuthService,
  ],
  exports: [BtpsService],
})
export class BtpsModule {}
