import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module.js';
import { BtpsModule } from './btps/btps.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    DatabaseModule, // For MongoDB and Redis
    BtpsModule, // BTPS services and authentication
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
