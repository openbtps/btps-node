import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module.js';
import { BtpsService } from './btps/btps.service.js';
import { BtpsConfigService } from './btps/config/btps.config.js';
import { BtpsMiddlewareConfigService } from './btps/middleware/btps-middleware-config.service.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    DatabaseModule, // For MongoDB and Redis
  ],
  controllers: [],
  providers: [BtpsService, BtpsConfigService, BtpsMiddlewareConfigService],
})
export class AppModule {}
