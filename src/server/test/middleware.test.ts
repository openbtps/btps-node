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
import JsonTrustStore from '../../core/trust/storage/JsonTrustStore.js';

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
    middlewareManager = new MiddlewareManager(middlewareFile);
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
    it('should return empty if no middleware file exists', async () => {
      const trustStore = new JsonTrustStore({
        connection: TEST_FILE,
        entityName: 'trusted_sender',
      });
      await middlewareManager.loadMiddleware({ trustStore });
      const middleware = middlewareManager.getAllMiddleware();
      expect(middleware.length).toBe(0);
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
    it('should skip invalid middleware (missing handler)', async () => {
      await fs.writeFile(middlewareFile, invalidMiddlewareMissingHandler, 'utf8');
      const trustStore = new JsonTrustStore({
        connection: TEST_FILE,
        entityName: 'trusted_sender',
      });
      const warnSpy = vi.spyOn(console, 'warn');
      await middlewareManager.loadMiddleware({ trustStore });
      const middleware = middlewareManager.getAllMiddleware();
      if (middleware.length !== 0) {
        // Debug output
        console.error('Loaded middleware (should be 0):', middleware);
      }
      expect(middleware.length).toBe(0);
      expect(warnSpy).toHaveBeenCalled();
    });
    it('should skip invalid middleware (wrong phase)', async () => {
      await fs.writeFile(middlewareFile, invalidMiddlewareWrongPhase, 'utf8');
      const trustStore = new JsonTrustStore({
        connection: TEST_FILE,
        entityName: 'trusted_sender',
      });
      const warnSpy = vi.spyOn(console, 'warn');
      await middlewareManager.loadMiddleware({ trustStore });
      const middleware = middlewareManager.getAllMiddleware();
      if (middleware.length !== 0) {
        // Debug output
        console.error('Loaded middleware (should be 0):', middleware);
      }
      expect(middleware.length).toBe(0);
      expect(warnSpy).toHaveBeenCalled();
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
});
