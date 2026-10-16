import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import {
  InMemoryTokenStore,
  BTPsTokenDocument,
  type BTPTokenConsumeResult,
} from '@btps/sdk/authentication';

@Injectable()
export class RedisTokenStoreService
  extends InMemoryTokenStore<BTPsTokenDocument>
  implements OnModuleDestroy
{
  private readonly redis: Redis;
  // Namespaces
  private readonly base = 'btps:token';
  private readonly agentNS = `${this.base}:agent`; // btps:token:agent:<agentId>:<token>
  private readonly userNS = `${this.base}:user`; // btps:token:user:<userIdentity>:<agentId>:<token>

  constructor(private readonly configService: ConfigService) {
    super();

    this.redis = new Redis({
      host: this.configService.get<string>('REDIS_HOST') || 'localhost',
      port: this.configService.get<number>('REDIS_PORT') || 6379,
      password: this.configService.get<string>('REDIS_PASSWORD') || undefined,
      db: this.configService.get<number>('REDIS_DB') || 0,
      maxRetriesPerRequest: 3,
    });

    this.redis.on('error', error => {
      console.error('Redis connection error:', error);
    });

    this.redis.on('connect', () => {
      console.log('✅ Connected to Redis');
    });
  }

  /** Delete both primary and user mirror keys. */
  private async safeDeletePair(
    userIdentity: string,
    agentId: string,
    token: string,
  ): Promise<void> {
    const pipe = this.redis.pipeline();
    pipe.unlink(this.agentKey(agentId, token));
    pipe.unlink(this.userKey(userIdentity, agentId, token));
    await pipe.exec();
  }

  /** Primary (hot-path) key: btps:token:agent:<agentId>:<token> */
  private agentKey(agentId: string, token: string): string {
    return `${this.agentNS}:${agentId}:${token}`;
  }

  /** User-scoped mirror key: btps:token:user:<userIdentity>:<agentId>:<token> */
  private userKey(
    userIdentity: string,
    agentId: string,
    token: string,
  ): string {
    return `${this.userNS}:${userIdentity}:${agentId}:${token}`;
  }

  /** Count matching keys via SCAN (approximate but safe). */
  private async scanCount(
    matchPattern: string,
    pageSize = 1000,
  ): Promise<number> {
    let cursor = '0';
    let total = 0;
    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        matchPattern,
        'COUNT',
        pageSize,
      );
      total += keys.length;
      cursor = next;
    } while (cursor !== '0');
    return total;
  }

  /** Iterate the keySpace for a given MATCH pattern and return all keys. */
  private async scanAll(
    matchPattern: string,
    pageSize = 1000,
  ): Promise<string[]> {
    let cursor = '0';
    const found: string[] = [];
    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        matchPattern,
        'COUNT',
        pageSize,
      );
      if (keys.length) found.push(...keys);
      cursor = next;
    } while (cursor !== '0');
    return found;
  }

  async store(
    token: string,
    agentId: string | null,
    userIdentity: string,
    expiryMs: number,
    decryptBy: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiryMs);

    const doc: BTPsTokenDocument = {
      token,
      agentId: agentId ?? 'anonymous',
      userIdentity,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      decryptBy,
      metadata,
    };

    const ttlSec = Math.ceil(expiryMs / 1000);
    const agentKey = agentId ?? userIdentity;
    const primaryKey = this.agentKey(agentKey, doc.token);
    const userKey = this.userKey(doc.userIdentity, agentKey, doc.token);
    const payload = JSON.stringify(doc);

    // Write both keys with identical TTLs
    const pipe = this.redis.pipeline();
    pipe.setex(primaryKey, ttlSec, payload);
    pipe.setex(userKey, ttlSec, payload);
    await pipe.exec();
  }

  async get(
    agentId: string,
    token: string,
  ): Promise<BTPsTokenDocument | undefined> {
    try {
      const primaryKey = this.agentKey(agentId, token);

      const serialized = await this.redis.get(primaryKey);
      if (!serialized) return undefined;

      const doc: BTPsTokenDocument = JSON.parse(serialized);
      // Double-check expiry (belt & suspenders in case TTL drift)
      if (new Date() > new Date(doc.expiresAt)) {
        await this.safeDeletePair(doc.userIdentity, doc.agentId, doc.token);
        return undefined;
      }
      return doc;
    } catch (error) {
      console.error('Error getting token from Redis:', error);
      return undefined;
    }
  }

  async remove(agentId: string, token: string): Promise<void> {
    try {
      const primaryKey = this.agentKey(agentId, token);
      const serialized = await this.redis.get(primaryKey);
      console.log('Removing token from Redis:', { primaryKey, serialized });
      if (!serialized) {
        // Nothing to do (may already be expired)
        await this.redis.unlink(primaryKey);
        return;
      }
      const doc: BTPsTokenDocument = JSON.parse(serialized);
      await this.safeDeletePair(doc.userIdentity, agentId, token);
    } catch (error) {
      console.error('Error removing token from Redis:', error);
    }
  }

  /**
   * Take a token once (BTPS 1.1 device registration). GETDEL is atomic in Redis (6.2+):
   * of two devices racing with one registration token, one gets it. A
   * marker remembers the token until it would have expired, to answer
   * `used` rather than `invalid`.
   */
  async consume(
    agentId: string,
    token: string,
  ): Promise<BTPTokenConsumeResult<BTPsTokenDocument>> {
    const primaryKey = this.agentKey(agentId, token);
    const usedKey = `${this.base}:used:${agentId}:${token}`;
    const serialized = await this.redis.getdel(primaryKey);
    if (!serialized) {
      return (await this.redis.exists(usedKey))
        ? { status: 'used' }
        : { status: 'invalid' };
    }
    const doc: BTPsTokenDocument = JSON.parse(serialized);
    await this.redis.unlink(this.userKey(doc.userIdentity, agentId, token));
    const remainingMs = new Date(doc.expiresAt).getTime() - Date.now();
    if (remainingMs <= 0) return { status: 'invalid' };
    await this.redis.set(usedKey, '1', 'PX', remainingMs);
    return { status: 'consumed', record: doc };
  }

  async onModuleDestroy() {
    if (this.redis) {
      await this.redis.quit();
    }

    console.log('🔑 Redis token store shutdown');
  }

  async getTokenCount(): Promise<number> {
    return this.scanCount(`${this.base}:*`);
  }

  /** Get all non-expired tokens for a given userIdentity. */
  async getTokensByUser(userIdentity: string): Promise<BTPsTokenDocument[]> {
    try {
      const pattern = `${this.userNS}:${userIdentity}:*`; // only this user's keys
      const keys = await this.scanAll(pattern);
      if (!keys.length) return [];

      const pipe = this.redis.pipeline();
      keys.forEach(k => pipe.get(k));
      const results = await pipe.exec();

      const out: BTPsTokenDocument[] = [];
      if (!results) return out;

      for (const [err, val] of results) {
        if (!err && val) {
          const doc: BTPsTokenDocument = JSON.parse(val as string);
          if (new Date() <= new Date(doc.expiresAt)) {
            out.push(doc);
          } else {
            // best-effort cleanup
            await this.safeDeletePair(doc.userIdentity, doc.agentId, doc.token);
          }
        }
      }
      return out;
    } catch (error) {
      console.error('Error getting tokens by user:', error);
      return [];
    }
  }

  async revokeAllForUser(userIdentity: string): Promise<number> {
    const pattern = `${this.userNS}:${userIdentity}:*`;
    const keys = await this.scanAll(pattern);
    if (!keys.length) return 0;

    // Fetch all user key values in one go
    const getPipe = this.redis.pipeline();
    keys.forEach(k => getPipe.get(k));
    const results = await getPipe.exec();

    // Delete in one go
    const delPipe = this.redis.pipeline();
    let count = 0;

    results?.forEach(([err, val], i) => {
      if (!err && val) {
        try {
          const doc = JSON.parse(val as string) as BTPsTokenDocument;
          delPipe.unlink(this.agentKey(doc.agentId, doc.token)); // primary
          delPipe.unlink(
            this.userKey(doc.userIdentity, doc.agentId, doc.token),
          ); // mirror
          count += 2;
        } catch {
          // JSON corrupted — at least remove the user key
          delPipe.unlink(keys[i]);
          count++;
        }
      } else {
        // Missing value or error — remove the user key anyway
        delPipe.unlink(keys[i]);
        count++;
      }
    });

    await delPipe.exec();
    return count;
  }
}
