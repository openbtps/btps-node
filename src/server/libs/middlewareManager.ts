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
import { BTPServerResponse } from '@core/server/types.js';

export class MiddlewareManager {
  private middleware: MiddlewareDefinition[] = [];
  private lifecycleHooks: {
    onServerStart?: () => Promise<void> | void;
    onServerStop?: () => Promise<void> | void;
    onResponseSent?: (response: BTPServerResponse) => Promise<void> | void;
  } = {};

  constructor(private middlewarePath?: string) {
    if (isEmpty(middlewarePath)) {
      this.middlewarePath = `${process.cwd()}/btps.middleware.mjs`;
    }
  }

  /**
   * Loads and validates middleware from the specified path
   */
  async loadMiddleware(dependencies: MiddlewareContext['dependencies']): Promise<void> {
    if (!this.middlewarePath) return;

    const resolvedPath = resolve(this.middlewarePath);

    if (!existsSync(resolvedPath)) return;

    try {
      // Dynamic import of the middleware file
      const middlewareModule = await import(resolvedPath);
      const createMiddleware = middlewareModule.default;

      if (typeof createMiddleware !== 'function') {
        throw new BTPErrorException({ message: 'Middleware file must export a default function' });
      }

      const result = createMiddleware(dependencies);

      if (this.isMiddlewareModule(result)) {
        // New format with lifecycle hooks
        this.middleware = this.validateAndSortMiddleware(result.middleware);
        this.lifecycleHooks = {
          onServerStart: result.onServerStart,
          onServerStop: result.onServerStop,
          onResponseSent: result.onResponseSent,
        };
      } else if (Array.isArray(result)) {
        // Legacy format - just array of middleware
        this.middleware = this.validateAndSortMiddleware(result);
      } else {
        throw new BTPErrorException({
          message: 'Middleware function must return an array or MiddlewareModule',
        });
      }

      console.log(`[MiddlewareManager] Loaded ${this.middleware.length} middleware`);
    } catch (error) {
      console.error('[MiddlewareManager] Failed to load middleware:', error);
      throw new BTPErrorException({
        message: `Failed to load middleware from ${resolvedPath}: ${error}`,
      });
    }
  }

  /**
   * Validates middleware definitions and sorts them by priority
   */
  private validateAndSortMiddleware(middleware: MiddlewareDefinitionArray): MiddlewareDefinition[] {
    if (!Array.isArray(middleware)) {
      throw new BTPErrorException({ message: 'Middleware must be an array' });
    }

    const validMiddleware: MiddlewareDefinition[] = [];

    middleware.forEach((mw, index) => {
      try {
        this.validateMiddlewareDefinition(mw, index);

        // Only include enabled middleware
        if (mw.config?.enabled !== false) {
          validMiddleware.push(mw);
        }
      } catch (error) {
        console.warn(`[MiddlewareManager] Skipping invalid middleware at index ${index}:`, error);
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
    if (!mw || typeof mw !== 'object') {
      throw new BTPErrorException({ message: 'Middleware must be an object' });
    }

    const middleware = mw as MiddlewareDefinition;

    if (!middleware.phase || !['before', 'after'].includes(middleware.phase)) {
      throw new BTPErrorException({
        message: 'Middleware must have a valid phase (before or after)',
      });
    }

    if (
      !middleware.step ||
      !['parsing', 'signatureVerification', 'trustVerification', 'onArtifact', 'onError'].includes(
        middleware.step,
      )
    ) {
      throw new BTPErrorException({ message: 'Middleware must have a valid step' });
    }

    if (typeof middleware.handler !== 'function') {
      throw new BTPErrorException({ message: 'Middleware must have a handler function' });
    }

    // Validate that the handler signature matches the expected types for the phase and step
    try {
      // This is a runtime check to ensure the handler can be called with the expected parameters
      // The actual type checking happens at compile time with the generic types
      if (middleware.handler.length < 3) {
        throw new BTPErrorException({
          message: 'Middleware handler must accept at least 3 parameters (req, res, next)',
        });
      }
    } catch (error) {
      throw new BTPErrorException({
        message: `Invalid middleware handler signature: ${error}`,
      });
    }

    if (
      middleware.priority !== undefined &&
      (typeof middleware.priority !== 'number' ||
        !Number.isInteger(middleware.priority) ||
        middleware.priority < 0)
    ) {
      throw new BTPErrorException({
        message: 'Middleware priority must be a non-negative integer',
      });
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
