/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import { existsSync, unlinkSync } from 'fs';
import path from 'path';
import { MiddlewareManager } from '../libs/middlewareManager.js';
import { createDefaultMiddleware, DEFAULT_MIDDLEWARE_NAMES } from '../libs/defaultMiddleware.js';
import { BtpsSimpleRateLimiter } from '../libs/btpsSimpleRateLimiter.js';
import JsonTrustStore from '../../core/trust/storage/JsonTrustStore.js';
import { BTP_ERROR_MIDDLEWARE } from '../../core/error/constant.js';

const TEST_FILE = path.join(__dirname, 'test-trust-store.json');

const simpleMiddleware = `
export default function () {
  return [{
    phase: 'before',
    step: 'parsing',
    priority: 1,
    config: { name: 'test-middleware', enabled: true },
    handler: async (req, res, next) => { await next(); }
  }];
}
`;

const invalidMiddlewareMissingHandler = `
export default function () {
  return [{
    phase: 'before',
    step: 'parsing',
    priority: 1,
    config: { name: 'invalid-middleware', enabled: true },
    handler: undefined
  }];
}
`;

const invalidMiddlewareWrongPhase = `
export default function () {
  return [{
    phase: 'not-a-phase',
    step: 'parsing',
    priority: 1,
    config: { name: 'invalid-phase', enabled: true },
    handler: async (req, res, next) => { await next(); }
  }];
}
`;

const priorityMiddleware = `
export default function () {
  return [
    {
      phase: 'before',
      step: 'parsing',
      priority: 10,
      config: { name: 'second', enabled: true },
      handler: async (req, res, next) => { await next(); }
    },
    {
      phase: 'before',
      step: 'parsing',
      priority: 1,
      config: { name: 'first', enabled: true },
      handler: async (req, res, next) => { await next(); }
    },
    {
      phase: 'before',
      step: 'parsing',
      priority: 5,
      config: { name: 'third', enabled: true },
      handler: async (req, res, next) => { await next(); }
    }
  ];
}
`;

function getUniqueMiddlewareFile() {
  return path.join(
    process.cwd(),
    `btps.middleware.${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`,
  );
}

describe('MiddlewareManager', () => {
  let middlewareManager: MiddlewareManager;
  let middlewareFile: string;

  beforeEach(async () => {
    middlewareFile = getUniqueMiddlewareFile();
    // These tests are about the file: without the default middleware, tested below.
    middlewareManager = new MiddlewareManager(middlewareFile, false);
    // Ensure no leftover middleware file before each test
    if (existsSync(TEST_FILE)) await fs.unlink(TEST_FILE);
  });

  afterEach(async () => {
    vi.clearAllMocks();
    // Ensure cleanup after each test
    if (existsSync(TEST_FILE)) await fs.unlink(TEST_FILE);
    if (middlewareFile && existsSync(middlewareFile)) unlinkSync(middlewareFile);
  });

  describe('loadMiddleware', () => {
    it('should return empty if no path is given and the default file does not exist', async () => {
      const trustStore = new JsonTrustStore({
        connection: TEST_FILE,
        entityName: 'trusted_sender',
      });
      expect(existsSync(path.join(process.cwd(), 'btps.middleware.mjs'))).toBe(false);
      const manager = new MiddlewareManager(undefined, false);
      await manager.loadMiddleware({ trustStore });
      expect(manager.getAllMiddleware().length).toBe(0);
    });

    // A path given and not there is a mistake, not "no middleware".
    it('fails loudly when a middleware path given explicitly does not exist', async () => {
      const trustStore = new JsonTrustStore({
        connection: TEST_FILE,
        entityName: 'trusted_sender',
      });
      await expect(middlewareManager.loadMiddleware({ trustStore })).rejects.toMatchObject({
        code: BTP_ERROR_MIDDLEWARE.code,
      });
    });

    // It used to be dropped with only a warning.
    it('fails loudly when a handler declares fewer than three parameters', async () => {
      await fs.writeFile(
        middlewareFile,
        `export default function () {
  return [{
    phase: 'before', step: 'parsing', priority: 1,
    config: { name: 'two-params', enabled: true },
    handler: async (req, res) => {}
  }];
}
`,
        'utf8',
      );
      const trustStore = new JsonTrustStore({
        connection: TEST_FILE,
        entityName: 'trusted_sender',
      });
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const warn = vi.spyOn(console, 'warn');
      await expect(middlewareManager.loadMiddleware({ trustStore })).rejects.toMatchObject({
        code: BTP_ERROR_MIDDLEWARE.code,
      });
      expect(warn).not.toHaveBeenCalled();
      expect(middlewareManager.getAllMiddleware()).toEqual([]);
    });

    it('fails loudly when a default replacement has a handler with fewer than three parameters', async () => {
      const manager = new MiddlewareManager(undefined, [
        { phase: 'before', step: 'parsing', handler: async (_req: unknown, _res: unknown) => {} },
      ] as never);
      await expect(
        manager.loadMiddleware({
          trustStore: new JsonTrustStore({ connection: TEST_FILE, entityName: 'trusted' }),
        }),
      ).rejects.toMatchObject({ code: BTP_ERROR_MIDDLEWARE.code });
    });
    it('should load middleware from btps.middleware.mjs if it exists', async () => {
      await fs.writeFile(middlewareFile, simpleMiddleware, 'utf8');
      const trustStore = new JsonTrustStore({
        connection: TEST_FILE,
        entityName: 'trusted_sender',
      });
      await middlewareManager.loadMiddleware({ trustStore });
      const middleware = middlewareManager.getAllMiddleware();
      expect(middleware.length).toBe(1);
      expect(middleware[0].config?.name).toBe('test-middleware');
    });
    // An invalid definition fails the load; it is no longer skipped with a warning.
    it('fails on invalid middleware (missing handler)', async () => {
      await fs.writeFile(middlewareFile, invalidMiddlewareMissingHandler, 'utf8');
      const trustStore = new JsonTrustStore({
        connection: TEST_FILE,
        entityName: 'trusted_sender',
      });
      vi.spyOn(console, 'error').mockImplementation(() => {});
      await expect(middlewareManager.loadMiddleware({ trustStore })).rejects.toMatchObject({
        code: BTP_ERROR_MIDDLEWARE.code,
      });
      expect(middlewareManager.getAllMiddleware().length).toBe(0);
    });
    it('fails on invalid middleware (wrong phase)', async () => {
      await fs.writeFile(middlewareFile, invalidMiddlewareWrongPhase, 'utf8');
      const trustStore = new JsonTrustStore({
        connection: TEST_FILE,
        entityName: 'trusted_sender',
      });
      vi.spyOn(console, 'error').mockImplementation(() => {});
      await expect(middlewareManager.loadMiddleware({ trustStore })).rejects.toMatchObject({
        code: BTP_ERROR_MIDDLEWARE.code,
      });
      expect(middlewareManager.getAllMiddleware().length).toBe(0);
    });
    it('should sort middleware by priority', async () => {
      await fs.writeFile(middlewareFile, priorityMiddleware, 'utf8');
      const trustStore = new JsonTrustStore({
        connection: TEST_FILE,
        entityName: 'trusted_sender',
      });
      await middlewareManager.loadMiddleware({ trustStore });
      const middleware = middlewareManager.getAllMiddleware();
      expect(middleware.length).toBe(3);
      expect(middleware[0].config?.name).toBe('first');
      expect(middleware[1].config?.name).toBe('third');
      expect(middleware[2].config?.name).toBe('second');
    });
  });

  describe('getMiddleware', () => {
    it('should return empty array when no middleware is loaded', async () => {
      middlewareManager = new MiddlewareManager();
      const result = middlewareManager.getMiddleware('before', 'parsing');
      expect(result).toEqual([]);
    });
    it('should return correct middleware for phase and step', async () => {
      await fs.writeFile(middlewareFile, simpleMiddleware, 'utf8');
      const trustStore = new JsonTrustStore({
        connection: TEST_FILE,
        entityName: 'trusted_sender',
      });
      await middlewareManager.loadMiddleware({ trustStore });
      const beforeParse = middlewareManager.getMiddleware('before', 'parsing');
      expect(beforeParse.length).toBe(1);
      expect(beforeParse[0].phase).toBe('before');
      expect(beforeParse[0].step).toBe('parsing');
    });
  });

  describe('lifecycle hooks', () => {
    it('should handle missing lifecycle hooks gracefully', async () => {
      await middlewareManager.onServerStart();
      await middlewareManager.onServerStop();
      expect(true).toBe(true); // Should not throw
    });
  });

  describe('middleware flow control', () => {
    it('should properly handle middleware that sends response and stops flow', async () => {
      const flowControlMiddleware = `
export default function () {
  return [{
    phase: 'before',
    step: 'parsing',
    priority: 1,
    config: { name: 'flow-control-test', enabled: true },
    handler: async (req, res, next) => {
      // This middleware sends a response and returns without calling next()
      // This should stop the flow
      res.sendError({ code: 403, message: 'Access denied' });
      // Note: no await next() call here - this should stop the flow
    }
  }];
}
`;
      await fs.writeFile(middlewareFile, flowControlMiddleware, 'utf8');
      const trustStore = new JsonTrustStore({
        connection: TEST_FILE,
        entityName: 'trusted_sender',
      });
      await middlewareManager.loadMiddleware({ trustStore });
      const middleware = middlewareManager.getAllMiddleware();
      expect(middleware.length).toBe(1);
      expect(middleware[0].config?.name).toBe('flow-control-test');
    });

    it('should load middleware that stops flow', async () => {
      const stopFlowMiddleware = `
export default function () {
  return [
    {
      phase: 'before',
      step: 'parsing',
      priority: 1,
      config: { name: 'stop-flow-test', enabled: true },
      handler: async (req, res, next) => {
        console.log('🛑 Middleware sending error response');
        res.sendError({ code: 429, message: 'Rate limited' });
        // No next() call - flow should stop here
      }
    },
    {
      phase: 'after',
      step: 'parsing',
      priority: 1,
      config: { name: 'should-not-run', enabled: true },
      handler: async (req, res, next) => {
        console.log('❌ This middleware should NOT run');
        await next();
      }
    }
  ];
}
`;
      await fs.writeFile(middlewareFile, stopFlowMiddleware, 'utf8');

      const trustStore = new JsonTrustStore({
        connection: TEST_FILE,
        entityName: 'trusted_sender',
      });

      await middlewareManager.loadMiddleware({ trustStore });
      const middleware = middlewareManager.getAllMiddleware();
      expect(middleware.length).toBe(2);
      expect(middleware[0].config?.name).toBe('stop-flow-test');
      expect(middleware[1].config?.name).toBe('should-not-run');
    });
  });

  // The default middleware is always loaded, before the file,
  // unless the server option turns it off or replaces it.
  describe('default middleware', () => {
    const trustStore = () => new JsonTrustStore({ connection: TEST_FILE, entityName: 'trusted' });
    const names = (mws: { config?: { name?: string } }[]) => mws.map((mw) => mw.config?.name);
    const defaultNames = Object.values(DEFAULT_MIDDLEWARE_NAMES);

    it('loads the defaults when there is no middleware file', async () => {
      const manager = new MiddlewareManager(undefined);
      await manager.loadMiddleware({ trustStore: trustStore() });
      expect(new Set(names(manager.getAllMiddleware()))).toEqual(new Set(defaultNames));
    });

    it('loads the defaults before the file, and both', async () => {
      await fs.writeFile(middlewareFile, simpleMiddleware, 'utf8');
      const manager = new MiddlewareManager(middlewareFile);
      await manager.loadMiddleware({ trustStore: trustStore() });
      expect(names(manager.getMiddleware('before', 'parsing'))).toEqual([
        DEFAULT_MIDDLEWARE_NAMES.ipRateLimiter,
        'test-middleware',
      ]);
    });

    it('runs the identity limiter after signature verification, never at parsing', async () => {
      const manager = new MiddlewareManager(undefined);
      await manager.loadMiddleware({ trustStore: trustStore() });
      expect(names(manager.getMiddleware('after', 'signatureVerification'))).toContain(
        DEFAULT_MIDDLEWARE_NAMES.identityRateLimiter,
      );
      for (const phase of ['before', 'after'] as const) {
        expect(names(manager.getMiddleware(phase, 'parsing'))).not.toContain(
          DEFAULT_MIDDLEWARE_NAMES.identityRateLimiter,
        );
      }
    });

    it('runs the defaults once when the file includes them too', async () => {
      const withDefaults = `
import { createDefaultMiddleware } from '${path.join(process.cwd(), 'src/server/libs/defaultMiddleware.ts')}';
export default function () {
  return [...createDefaultMiddleware(), {
    phase: 'before', step: 'parsing', priority: 1,
    config: { name: 'platform-own', enabled: true },
    handler: async (req, res, next) => { await next(); }
  }];
}
`;
      await fs.writeFile(middlewareFile, withDefaults, 'utf8');
      const manager = new MiddlewareManager(middlewareFile);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await manager.loadMiddleware({ trustStore: trustStore() });
      const loaded = names(manager.getAllMiddleware());
      for (const name of defaultNames) {
        expect(loaded.filter((n) => n === name)).toHaveLength(1);
      }
      expect(loaded).toContain('platform-own');
      expect(warn).toHaveBeenCalled();
    });

    it('loads none when the server option is false', async () => {
      const manager = new MiddlewareManager(undefined, false);
      await manager.loadMiddleware({ trustStore: trustStore() });
      expect(manager.getAllMiddleware()).toEqual([]);
    });

    it('loads the given array instead when the server option replaces them', async () => {
      const replacement = createDefaultMiddleware({
        rateLimiter: new BtpsSimpleRateLimiter({ ipAddress: 500, fromIdentity: 100 }),
      }).filter((mw) => mw.config?.name !== DEFAULT_MIDDLEWARE_NAMES.errorLogger);
      const manager = new MiddlewareManager(undefined, replacement);
      await manager.loadMiddleware({ trustStore: trustStore() });
      expect(names(manager.getAllMiddleware())).not.toContain(DEFAULT_MIDDLEWARE_NAMES.errorLogger);
      expect(manager.getAllMiddleware()).toHaveLength(defaultNames.length - 1);
    });
  });
});
