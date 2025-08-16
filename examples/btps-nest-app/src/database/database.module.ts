import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongoTrustStoreService } from './mongo/mongo-trust-store.service.js';
import { MongoIdentityStoreService } from './mongo/mongo-identity-store.service.js';
import { RedisTokenStoreService } from './redis/redis-token-store.service.js';
import {
  TrustRecord,
  TrustRecordSchema,
} from './mongo/schemas/trust-record.schema.js';
import {
  IdentityRecord,
  IdentityRecordSchema,
} from './mongo/schemas/identity-record.schema.js';
import { Connection } from 'mongoose';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const uri =
          configService.get<string>('MONGODB_URI') ||
          'mongodb://localhost:27017/btps';
        const dbName = configService.get<string>('MONGODB_DB_NAME') || 'btps';

        return {
          uri,
          dbName,
          onConnectionCreate: (connection: Connection) => {
            // Add MongoDB connection event listeners immediately when connection is created
            connection.on('connected', () => {
              console.log('✅ Connected to MongoDB');
            });

            connection.on('error', (error: Error) => {
              console.error('MongoDB connection error:', error);
            });

            connection.on('disconnected', () => {
              console.log('❌ Disconnected from MongoDB');
            });

            return connection;
          },
        };
      },
      inject: [ConfigService],
    }),
    MongooseModule.forFeature([
      { name: TrustRecord.name, schema: TrustRecordSchema },
      { name: IdentityRecord.name, schema: IdentityRecordSchema },
    ]),
  ],
  providers: [
    MongoTrustStoreService,
    MongoIdentityStoreService,
    RedisTokenStoreService,
  ],
  exports: [
    MongoTrustStoreService,
    MongoIdentityStoreService,
    RedisTokenStoreService,
  ],
})
export class DatabaseModule {}
