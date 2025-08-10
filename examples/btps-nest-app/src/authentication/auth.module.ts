import { Module } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { DatabaseModule } from '../database/database.module.js';

@Module({
  imports: [DatabaseModule],
  controllers: [],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
