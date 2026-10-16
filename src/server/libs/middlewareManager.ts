/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { existsSync } from 'fs';
import { resolve } from 'path';
import {
  MiddlewareDefinition,
  MiddlewareDefinitionArray,
  MiddlewareModule,
  MiddlewareContext,
  Phase,
  Step,
} from '../types.js';
import isEmpty from 'lodash/isEmpty.js';
import { BTPErrorException } from '@core/error/index.js';
import { BTP_ERROR_MIDDLEWARE } from '@core/error/constant.js';
import { BTPServerResponse } from '@core/server/types.js';
import { createDefaultMiddleware } from './defaultMiddleware.js';

export class MiddlewareManager {
  private middleware: MiddlewareDefinition[] = [];
  private lifecycleHooks: {
    onServerStart?: () => Promise<void> | void;
    onServerStop?: () => Promise<void> | void;
    onResponseSent?: (response: BTPServerResponse) => Promise<void> | void;
  } = {};

  /** Whether the path was given: a given file must exist; the default one need not. */
  private readonly pathGiven: boolean;

  /**
   * @param middlewarePath - The platform's middleware file; defaults to
   *   `btps.middleware.mjs` in the working directory. A missing default file
   *   is no error; a path given that does not exist is.
   * @param defaultMiddleware - What runs before the file's middleware:
   *   `undefined` for createDefaultMiddleware(), an array to
   *   replace it, `false` for none.
   */
  constructor(
    private middlewarePath?: string,
    private readonly defaultMiddleware?: MiddlewareDefinitionArray | false,
  ) {
    this.pathGiven = !isEmpty(middlewarePath);
    if (!this.pathGiven) {
      this.middlewarePath = `${process.cwd()}/btps.middleware.mjs`;
    }
  }

  /**
   * Loads the default middleware, then the platform's file. Each runs in its
   * own priority order, defaults first within a phase and step; an entry in
   * the file named as a loaded default is skipped, so a file that includes
   * the defaults itself does not run them twice.
   */
  async loadMiddleware(dependencies: MiddlewareContext['dependencies']): Promise<void> {
    const defaults =
      this.defaultMiddleware === false
        ? []
        : this.validateAndSortMiddleware(this.defaultMiddleware ?? createDefaultMiddleware());

    const fromFile = await this.loadMiddlewareFile(dependencies);
    const defaultNames = new Set(defaults.map((mw) => mw.config?.name).filter(Boolean));
    const kept = fromFile.filter((mw) => {
      const duplicate = !!mw.config?.name && defaultNames.has(mw.config.name);
      if (duplicate) {
        console.warn(
          `[MiddlewareManager] Skipping "${mw.config?.name}" from the middleware file: the default middleware already runs it`,
        );
      }
      return !duplicate;
    });
    this.middleware = [...defaults, ...kept];
  }

  /**
   * Loads and validates middleware from the specified path, and its lifecycle hooks
   */
  private async loadMiddlewareFile(
    dependencies: MiddlewareContext['dependencies'],
  ): Promise<MiddlewareDefinition[]> {
    if (!this.middlewarePath) return [];

    const resolvedPath = resolve(this.middlewarePath);

    if (!existsSync(resolvedPath)) {
      if (!this.pathGiven) return [];
      // A file named and not there is a mistake, never "no middleware".
      throw new BTPErrorException(BTP_ERROR_MIDDLEWARE, {
        cause: `The middleware file ${resolvedPath} does not exist`,
        meta: { middlewarePath: this.middlewarePath },
      });
    }

    try {
      // Dynamic import of the middleware file
      const middlewareModule = await import(resolvedPath);
      const createMiddleware = middlewareModule.default;

      if (typeof createMiddleware !== 'function') {
        throw new BTPErrorException(BTP_ERROR_MIDDLEWARE, {
          cause: 'Middleware file must export a default function',
        });
      }

      const result = createMiddleware(dependencies);

      let loaded: MiddlewareDefinition[];
      if (this.isMiddlewareModule(result)) {
        // New format with lifecycle hooks
        loaded = this.validateAndSortMiddleware(result.middleware);
        this.lifecycleHooks = {
          onServerStart: result.onServerStart,
          onServerStop: result.onServerStop,
          onResponseSent: result.onResponseSent,
        };
      } else if (Array.isArray(result)) {
        // Legacy format - just array of middleware
        loaded = this.validateAndSortMiddleware(result);
      } else {
        throw new BTPErrorException(BTP_ERROR_MIDDLEWARE, {
          cause: 'Middleware function must return an array or MiddlewareModule',
        });
      }

      console.log(`[MiddlewareManager] Loaded ${loaded.length} middleware`);
      return loaded;
    } catch (error) {
      console.error('[MiddlewareManager] Failed to load middleware:', error);
      throw new BTPErrorException(BTP_ERROR_MIDDLEWARE, {
        cause: error,
        meta: { middlewarePath: resolvedPath },
      });
    }
  }

  /**
   * Validates middleware definitions and sorts them by priority. An invalid
   * definition fails the load: skipping it with a warning left a
   * server running without, say, its rate limiter.
   */
  private validateAndSortMiddleware(middleware: MiddlewareDefinitionArray): MiddlewareDefinition[] {
    if (!Array.isArray(middleware)) {
      throw new BTPErrorException(BTP_ERROR_MIDDLEWARE, { cause: 'Middleware must be an array' });
    }

    const validMiddleware: MiddlewareDefinition[] = [];

    middleware.forEach((mw, index) => {
      try {
        this.validateMiddlewareDefinition(mw, index);
      } catch (error) {
        throw new BTPErrorException(BTP_ERROR_MIDDLEWARE, {
          cause: error,
          meta: { index, name: (mw as MiddlewareDefinition | undefined)?.config?.name },
        });
      }
      // Only include enabled middleware
      if (mw.config?.enabled !== false) {
        validMiddleware.push(mw);
      }
    });

    // Sort by priority (lower numbers first)
    return validMiddleware.sort((a, b) => {
      const priorityA = a.priority ?? Number.MAX_SAFE_INTEGER;
      const priorityB = b.priority ?? Number.MAX_SAFE_INTEGER;
      return priorityA - priorityB;
    });
  }

  /**
   * Validates a single middleware definition
   */
  private validateMiddlewareDefinition(
    mw: unknown,
    index: number,
  ): asserts mw is MiddlewareDefinition {
    const invalid = (cause: string) =>
      new BTPErrorException(BTP_ERROR_MIDDLEWARE, { cause, meta: { index } });

    if (!mw || typeof mw !== 'object') throw invalid('Middleware must be an object');

    const middleware = mw as MiddlewareDefinition;

    if (!middleware.phase || !['before', 'after'].includes(middleware.phase)) {
      throw invalid('Middleware must have a valid phase (before or after)');
    }

    if (
      !middleware.step ||
      !['parsing', 'signatureVerification', 'trustVerification', 'onArtifact', 'onError'].includes(
        middleware.step,
      )
    ) {
      throw invalid(`Middleware has no valid step: ${String(middleware.step)}`);
    }

    if (typeof middleware.handler !== 'function') {
      throw invalid('Middleware must have a handler function');
    }

    // The handler is called (req, res, next, context): one declared with
    // fewer than three parameters cannot call next().
    if (middleware.handler.length < 3) {
      throw invalid('Middleware handler must accept at least 3 parameters (req, res, next)');
    }

    if (
      middleware.priority !== undefined &&
      (typeof middleware.priority !== 'number' ||
        !Number.isInteger(middleware.priority) ||
        middleware.priority < 0)
    ) {
      throw invalid('Middleware priority must be a non-negative integer');
    }
  }

  /**
   * Checks if the result is a MiddlewareModule
   */
  private isMiddlewareModule(result: unknown): result is MiddlewareModule {
    return (
      result !== null &&
      typeof result === 'object' &&
      'middleware' in result &&
      Array.isArray((result as MiddlewareModule).middleware)
    );
  }

  /**
   * Gets middleware for a specific phase and step
   */
  getMiddleware(phase: Phase, step: Step): MiddlewareDefinition[] {
    return this.middleware.filter((mw) => mw.phase === phase && mw.step === step);
  }

  /**
   * Gets all middleware
   */
  getAllMiddleware(): MiddlewareDefinition[] {
    return [...this.middleware];
  }

  /**
   * Gets lifecycle hooks
   */
  getLifecycleHooks() {
    return { ...this.lifecycleHooks };
  }

  /**
   * Executes server start lifecycle hooks
   */
  async onServerStart(): Promise<void> {
    if (this.lifecycleHooks.onServerStart) {
      try {
        await this.lifecycleHooks.onServerStart();
      } catch (error) {
        console.error('[MiddlewareManager] Error in onServerStart hook:', error);
      }
    }
  }

  /**
   * Executes server stop lifecycle hooks
   */
  async onServerStop(): Promise<void> {
    if (this.lifecycleHooks.onServerStop) {
      try {
        await this.lifecycleHooks.onServerStop();
      } catch (error) {
        console.error('[MiddlewareManager] Error in onServerStop hook:', error);
      }
    }
  }

  /**
   * Executes onResponseSent lifecycle hooks
   */
  async onResponseSent(response: BTPServerResponse): Promise<void> {
    if (this.lifecycleHooks.onResponseSent) {
      try {
        await this.lifecycleHooks.onResponseSent(response);
      } catch (error) {
        console.error('[MiddlewareManager] Error in onResponseSent hook:', error);
      }
    }
  }
}
