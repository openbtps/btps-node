import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AbstractTrustStore, BTPTrustRecord } from '@btps/sdk/trust';
import type {
  AbstractIdentityStore,
  BTPIdentityRecord,
} from '@btps/sdk/storage';
import type { BtpsServerOptions, BtpsTlsOptions } from '@btps/sdk/server';
import { BtpsMiddlewareConfigService } from '../middleware/btps-middleware-config.service.js';

@Injectable()
export class BtpsConfigService {
  constructor(
    private readonly configService: ConfigService,
    private readonly middlewareConfigService: BtpsMiddlewareConfigService,
  ) {}

  getServerConfig(
    trustStore: AbstractTrustStore<BTPTrustRecord>,
    identityStore?: AbstractIdentityStore<BTPIdentityRecord>,
  ): BtpsServerOptions {
    const config = this.buildBaseConfig(trustStore, identityStore);
    return config;
  }

  private buildBaseConfig(
    trustStore: AbstractTrustStore<BTPTrustRecord>,
    identityStore?: AbstractIdentityStore<BTPIdentityRecord>,
  ): BtpsServerOptions {
    const serverIdentity = this.getServerIdentity();
    const port = this.getPort();
    const connectionTimeoutMs = parseInt(
      this.configService.get<string>('BTPS_CONNECTION_TIMEOUT_MS') || '30000',
    );

    return {
      serverIdentity,
      trustStore,
      identityStore,
      port,
      connectionTimeoutMs,
      middlewarePath: this.middlewareConfigService.getMiddlewarePath(),
      tlsOptions: this.addTlsConfig(),
    };
  }

  private getServerIdentity() {
    const serverIdentity = this.configService.get<string>(
      'BTPS_SERVER_IDENTITY',
    );
    const publicKey = this.configService.get<string>(
      'BTPS_IDENTITY_PUBLIC_KEY',
    );
    const privateKey = this.configService.get<string>(
      'BTPS_IDENTITY_PRIVATE_KEY',
    );

    if (!serverIdentity || !publicKey || !privateKey) {
      throw new Error(
        'Missing required BTPS configuration: BTPS_SERVER_IDENTITY, BTPS_PUBLIC_KEY, or BTPS_PRIVATE_KEY',
      );
    }

    return {
      identity: serverIdentity,
      publicKey: Buffer.from(publicKey, 'base64').toString('utf8'),
      privateKey: Buffer.from(privateKey, 'base64').toString('utf8'),
    };
  }

  private addTlsConfig(): BtpsTlsOptions {
    const tlsKeyPath = this.configService.get<string>('TLS_KEY');
    const tlsCertPath = this.configService.get<string>('TLS_CERT');
    if (!tlsKeyPath || !tlsCertPath) {
      throw new Error(
        'Missing required TLS configuration: TLS_KEY or TLS_CERT',
      );
    }

    return {
      key: Buffer.from(tlsKeyPath, 'base64').toString('utf8'),
      cert: Buffer.from(tlsCertPath, 'base64').toString('utf8'),
      requestCert: false,
    };
  }

  getPort(): number {
    return parseInt(this.configService.get<string>('BTPS_PORT') || '3443');
  }

  validateConfig(
    trustStore: AbstractTrustStore<BTPTrustRecord>,
    identityStore?: AbstractIdentityStore<BTPIdentityRecord>,
  ): void {
    try {
      this.getServerConfig(trustStore, identityStore);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`BTPS configuration validation failed: ${errorMessage}`);
    }
  }
}
