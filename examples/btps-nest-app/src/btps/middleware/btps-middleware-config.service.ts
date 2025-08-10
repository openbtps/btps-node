import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';

export interface MiddlewareConfig {
  path: string;
  environment: string;
}

@Injectable()
export class BtpsMiddlewareConfigService {
  constructor(private readonly configService: ConfigService) {}

  getMiddlewareConfig(): MiddlewareConfig {
    return {
      path: this.buildMiddlewarePath(),
      environment: this.configService.get<string>('NODE_ENV') || 'development',
    };
  }

  getMiddlewarePath(): string {
    return this.buildMiddlewarePath();
  }

  private buildMiddlewarePath(): string {
    const filename = 'btps.middleware.mjs';
    return join(process.cwd(), filename);
  }
}
