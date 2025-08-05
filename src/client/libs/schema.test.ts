/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  BtpsAgentCommandSchema,
  BtpsAgentCommandCallSchema,
  BtpsAgentCommandDocumentSchema,
  BtpsAgentOptionsSchema,
} from './schema.js';
import { BtpControlArtifactSchema } from '../../core/server/schemas/artifacts/controlSchema.js';
import { BtpIdentityLookupRequestSchema } from '../../core/server/schemas/artifacts/identityLookupSchema.js';
import { BtpArtifactServerSchema } from '../../core/server/schemas/artifacts/artifacts.js';
import { BtpTransporterArtifactSchema } from '../../core/server/schemas/artifacts/transporterSchema.js';
import { processBtpDocSchemaForAgent } from '../../core/server/schemas/helpers.js';
import {
  BtpCryptoOptionsSchema,
  BtpsAgentActionTypeSchema,
} from '../../core/server/schemas/schema.js';
import { identitySchema } from '../../core/server/schemas/shared.js';

describe('BtpsAgent Schema Validation', () => {
  describe('BtpsAgentCommandSchema', () => {
    it('should validate valid command parameters', () => {
      const validCommand = {
        actionType: 'system.ping',
        to: 'alice$example.com',
        document: undefined,
        options: {
          signature: {
            algorithmHash: 'sha256',
          },
          encryption: {
            algorithm: 'aes-256-gcm',
            mode: 'standardEncrypt',
          },
        },
      };

      const result = BtpsAgentCommandSchema.safeParse(validCommand);
      expect(result.success).toBe(true);
    });

    it('should validate command with trust request document', () => {
      const commandWithDoc = {
        actionType: 'trust.request',
        to: 'bob$company.com',
        document: {
          id: 'randomId',
          name: 'Test Company',
          email: 'test@company.com',
          reason: 'Business partnership',
          phone: '+1234567890',
        },
        options: undefined,
      };

      const result = BtpsAgentCommandSchema.safeParse(commandWithDoc);
      expect(result.success).toBe(true);
    });

    it('should validate command with trust response document', () => {
      const commandWithDoc = {
        actionType: 'trust.respond',
        to: 'alice$example.com',
        document: {
          id: 'randomId',
          decision: 'accepted',
          decidedAt: new Date().toISOString(),
          decidedBy: 'bob$company.com',
        },
        options: undefined,
      };

      const result = BtpsAgentCommandSchema.safeParse(commandWithDoc);
      expect(result.success).toBe(true);
    });

    it('should validate command with invoice document', () => {
      const commandWithDoc = {
        actionType: 'artifact.send',
        to: 'alice$example.com',
        document: {
          title: 'Test Invoice',
          id: 'INV-001',
          issuedAt: new Date().toISOString(),
          status: 'unpaid',
          totalAmount: {
            value: 100.0,
            currency: 'USD',
          },
          lineItems: {
            columns: ['Item', 'Quantity', 'Price'],
            rows: [{ Item: 'Service A', Quantity: 1, Price: 100.0 }],
          },
        },
        options: undefined,
      };

      const result = BtpsAgentCommandSchema.safeParse(commandWithDoc);
      expect(result.success).toBe(true);
    });

    it('should fail with invalid action type', () => {
      const invalidCommand = {
        actionType: 'invalid.action',
        to: 'alice$example.com',
        document: undefined,
        options: undefined,
      };

      const result = BtpsAgentCommandSchema.safeParse(invalidCommand);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['actionType']);
        expect(result.error.issues[0].message).toMatch(/Invalid enum value/);
      }
    });

    it('should fail with invalid identity format', () => {
      const invalidCommand = {
        actionType: 'system.ping',
        to: 'invalid-identity',
        document: undefined,
        options: undefined,
      };

      const result = BtpsAgentCommandSchema.safeParse(invalidCommand);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['to']);
        expect(result.error.issues[0].message).toMatch(/must match pattern/);
      }
    });

    it('should fail with invalid crypto options', () => {
      const invalidCommand = {
        actionType: 'system.ping',
        to: 'alice$example.com',
        document: undefined,
        options: {
          signature: {
            algorithmHash: 'md5', // Invalid algorithm
          },
        },
      };

      const result = BtpsAgentCommandSchema.safeParse(invalidCommand);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['options', 'signature', 'algorithmHash']);
      }
    });
  });

  describe('BtpsAgentCommandCallSchema', () => {
    it('should validate system.ping without document', () => {
      const command = {
        actionType: 'system.ping',
        to: 'alice$example.com',
        document: undefined,
        options: undefined,
      };

      const result = BtpsAgentCommandCallSchema.safeParse(command);
      expect(result.success).toBe(true);
    });

    it('should validate trust.request with required document', () => {
      const command = {
        actionType: 'trust.request',
        to: 'bob$company.com',
        document: {
          id: 'randomId',
          name: 'Test Company',
          email: 'test@company.com',
          reason: 'Business partnership',
          phone: '+1234567890',
        },
        options: undefined,
      };

      const result = BtpsAgentCommandCallSchema.safeParse(command);
      expect(result.success).toBe(true);
    });

    it('should fail trust.request without required document', () => {
      const command = {
        actionType: 'trust.request',
        to: 'bob$company.com',
        document: undefined,
        options: undefined,
      };

      const result = BtpsAgentCommandCallSchema.safeParse(command);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['document']);
        expect(result.error.issues[0].message).toBe(
          'Document is required for this action type or document format is invalid',
        );
      }
    });

    it('should fail trust.respond without required document', () => {
      const command = {
        actionType: 'trust.respond',
        to: 'alice$example.com',
        document: undefined,
        options: undefined,
      };

      const result = BtpsAgentCommandCallSchema.safeParse(command);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['document']);
        expect(result.error.issues[0].message).toBe(
          'Document is required for this action type or document format is invalid',
        );
      }
    });

    it('should fail artifact.send without required document', () => {
      const command = {
        actionType: 'artifact.send',
        to: 'alice$example.com',
        document: undefined,
        options: undefined,
      };

      const result = BtpsAgentCommandCallSchema.safeParse(command);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['document']);
        expect(result.error.issues[0].message).toBe(
          'Document is required for this action type or document format is invalid',
        );
      }
    });

    it('should validate draft.create with valid create document', () => {
      const command = {
        actionType: 'draft.create',
        to: 'alice$example.com',
        document: {
          type: 'TRUST_REQ',
          document: {
            id: 'randomId',
            name: 'Test Company',
            email: 'test@company.com',
            reason: 'Business partnership',
            phone: '+1234567890',
          },
        },
        options: undefined,
      };

      const result = BtpsAgentCommandCallSchema.safeParse(command);
      expect(result.success).toBe(true);
    });

    it('should fail draft.create without required document', () => {
      const command = {
        actionType: 'draft.create',
        to: 'alice$example.com',
        document: undefined,
        options: undefined,
      };

      const result = BtpsAgentCommandCallSchema.safeParse(command);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['document']);
        expect(result.error.issues[0].message).toBe(
          'Document is required for this action type or document format is invalid',
        );
      }
    });

    it('should fail draft.create with invalid create document', () => {
      const command = {
        actionType: 'draft.create',
        to: 'alice$example.com',
        document: { foo: 'bar' },
        options: undefined,
      };

      const result = BtpsAgentCommandCallSchema.safeParse(command);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['document']);
        expect([
          'Document is required for this action type or document format is invalid',
          'At least one query field must be provided',
        ]).toContain(result.error.issues[0].message);
      }
    });

    it('should fail draft.create with invalid type in create document', () => {
      const command = {
        actionType: 'draft.create',
        to: 'alice$example.com',
        document: {
          type: 'INVALID_TYPE',
          document: {
            id: 'randomId',
            name: 'Test Company',
            email: 'test@company.com',
            reason: 'Business partnership',
            phone: '+1234567890',
          },
        },
        options: undefined,
      };

      const result = BtpsAgentCommandCallSchema.safeParse(command);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['document']);
        expect([
          'Document is required for this action type or document format is invalid',
          'At least one query field must be provided',
        ]).toContain(result.error.issues[0].message);
      }
    });
  });

  describe('BtpsAgentActionTypeSchema', () => {
    it('should validate all valid action types', () => {
      const validActions = [
        'trust.request',
        'trust.respond',
        'trust.update',
        'trust.delete',
        'trust.fetch',
        'inbox.fetch',
        'inbox.seen',
        'inbox.delete',
        'outbox.fetch',
        'outbox.cancel',
        'draft.fetch',
        'draft.create',
        'draft.update',
        'draft.delete',
        'system.ping',
        'auth.request',
        'artifact.send',
      ];

      validActions.forEach((action) => {
        const result = BtpsAgentActionTypeSchema.safeParse(action);
        expect(result.success).toBe(true);
      });
    });

    it('should fail with invalid action type', () => {
      const result = BtpsAgentActionTypeSchema.safeParse('invalid.action');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toMatch(/Invalid enum value/);
      }
    });
  });

  describe('BtpsAgentToSchema', () => {
    it('should validate valid identity formats', () => {
      const validIdentities = [
        'alice$example.com',
        'bob$company.org',
        'user123$domain.net',
        'test.user$subdomain.example.co.uk',
      ];

      validIdentities.forEach((identity) => {
        const result = identitySchema.safeParse(identity);
        expect(result.success).toBe(true);
      });
    });

    it('should fail with invalid identity formats', () => {
      const invalidIdentities = [
        'invalid-identity',
        'user@domain.com',
        'user.domain.com',
        'user$',
        '$domain.com',
        'user$domain',
        '',
        'user domain.com',
      ];

      invalidIdentities.forEach((identity) => {
        const result = identitySchema.optional().safeParse(identity);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toMatch(/must match pattern/);
        }
      });
    });
  });

  describe('BtpsAgentCommandDocumentSchema', () => {
    it('should validate trust request document', () => {
      const doc = {
        id: 'randomId',
        name: 'Test Company',
        email: 'test@company.com',
        reason: 'Business partnership',
        phone: '+1234567890',
      };

      const result = BtpsAgentCommandDocumentSchema.safeParse(doc);
      expect(result.success).toBe(true);
    });

    it('should validate trust response document', () => {
      const doc = {
        id: 'randomId',
        decision: 'accepted',
        decidedAt: new Date().toISOString(),
        decidedBy: 'bob$company.com',
      };

      const result = BtpsAgentCommandDocumentSchema.safeParse(doc);
      expect(result.success).toBe(true);
    });

    it('should validate invoice document', () => {
      const doc = {
        title: 'Test Invoice',
        id: 'INV-001',
        issuedAt: new Date().toISOString(),
        status: 'unpaid',
        totalAmount: {
          value: 100.0,
          currency: 'USD',
        },
        lineItems: {
          columns: ['Item', 'Quantity', 'Price'],
          rows: [{ Item: 'Service A', Quantity: 1, Price: 100.0 }],
        },
      };

      const result = BtpsAgentCommandDocumentSchema.safeParse(doc);
      expect(result.success).toBe(true);
    });

    it('should validate agent create document', () => {
      const doc = {
        type: 'TRUST_REQ',
        document: {
          id: 'randomId',
          name: 'Test Company',
          email: 'test@company.com',
          reason: 'Business partnership',
          phone: '+1234567890',
        },
      };

      const result = BtpsAgentCommandDocumentSchema.safeParse(doc);
      expect(result.success).toBe(true);
    });

    it('should validate agent create document with BTPS_DOC type', () => {
      const doc = {
        type: 'BTPS_DOC',
        document: {
          title: 'Test Invoice',
          id: 'INV-001',
          issuedAt: new Date().toISOString(),
          status: 'unpaid',
          totalAmount: {
            value: 100.0,
            currency: 'USD',
          },
          lineItems: {
            columns: ['Item', 'Quantity', 'Price'],
            rows: [{ Item: 'Service A', Quantity: 1, Price: 100.0 }],
          },
        },
      };

      const result = BtpsAgentCommandDocumentSchema.safeParse(doc);
      expect(result.success).toBe(true);
    });

    it('should fail agent create document with invalid type', () => {
      const doc = {
        type: 'INVALID_TYPE',
        document: {
          id: 'randomId',
          name: 'Test Company',
          email: 'test@company.com',
          reason: 'Business partnership',
          phone: '+1234567890',
        },
      };

      const result = BtpsAgentCommandDocumentSchema.safeParse(doc);
      expect(result.success).toBe(false);
    });

    it('should fail agent create document with invalid document structure', () => {
      const doc = {
        type: 'TRUST_REQ',
        document: {
          invalidField: 'value',
        },
      };

      const result = BtpsAgentCommandDocumentSchema.safeParse(doc);
      expect(result.success).toBe(false);
    });

    it('should accept undefined document', () => {
      const result = BtpsAgentCommandDocumentSchema.safeParse(undefined);
      expect(result.success).toBe(true);
    });

    it('should validate agent query document with cursor', () => {
      const doc = {
        cursor: 'eyJpZCI6IjEyMyIsImlzc3VlZEF0IjoiMjAyNC0wMS0wMVQwMDowMDowMC4wMDBaIn0=',
        limit: 10,
        sort: 'desc',
      };

      const result = BtpsAgentCommandDocumentSchema.safeParse(doc);
      expect(result.success).toBe(true);
    });

    it('should validate agent query document with cursor and query filters', () => {
      const doc = {
        cursor: 'eyJpZCI6IjEyMyIsImlzc3VlZEF0IjoiMjAyNC0wMS0wMVQwMDowMDowMC4wMDBaIn0=',
        limit: 20,
        query: {
          title: { like: 'Invoice' },
          from: { eq: 'alice$example.com' },
        },
        sort: 'asc',
      };

      const result = BtpsAgentCommandDocumentSchema.safeParse(doc);
      expect(result.success).toBe(true);
    });

    it('should validate agent query document with cursor and date range', () => {
      const doc = {
        cursor: 'eyJpZCI6IjEyMyIsImlzc3VlZEF0IjoiMjAyNC0wMS0wMVQwMDowMDowMC4wMDBaIn0=',
        since: '2024-01-01T00:00:00.000Z',
        until: '2024-12-31T23:59:59.999Z',
        limit: 50,
      };

      const result = BtpsAgentCommandDocumentSchema.safeParse(doc);
      expect(result.success).toBe(true);
    });

    it('should validate agent query document with only cursor', () => {
      const doc = {
        cursor: 'eyJpZCI6IjEyMyIsImlzc3VlZEF0IjoiMjAyNC0wMS0wMVQwMDowMDowMC4wMDBaIn0=',
      };

      const result = BtpsAgentCommandDocumentSchema.safeParse(doc);
      expect(result.success).toBe(true);
    });

    it('should validate agent query document with cursor and complex query filters', () => {
      const doc = {
        cursor: 'eyJpZCI6IjEyMyIsImlzc3VlZEF0IjoiMjAyNC0wMS0wMVQwMDowMDowMC4wMDBaIn0=',
        query: {
          title: {
            like: 'Invoice',
            notIn: ['Draft', 'Template'],
          },
          from: {
            in: ['alice$example.com', 'bob$company.com'],
            ne: 'spam$domain.com',
          },
          to: {
            eq: 'client$business.com',
            notLike: 'test%',
          },
        },
        limit: 25,
        sort: 'desc',
      };

      const result = BtpsAgentCommandDocumentSchema.safeParse(doc);
      expect(result.success).toBe(true);
    });
  });

  describe('BtpsAgentOptionsSchema', () => {
    it('should validate valid crypto options', () => {
      const validOptions = [
        {
          signature: {
            algorithmHash: 'sha256',
          },
        },
        {
          encryption: {
            algorithm: 'aes-256-gcm',
            mode: 'standardEncrypt',
          },
        },
        {
          signature: {
            algorithmHash: 'sha256',
          },
          encryption: {
            algorithm: 'aes-256-gcm',
            mode: '2faEncrypt',
          },
        },
        undefined,
      ];

      validOptions.forEach((option) => {
        const result = BtpsAgentOptionsSchema.safeParse(option);
        expect(result.success).toBe(true);
      });
    });

    it('should fail with invalid signature algorithm', () => {
      const invalidOptions = {
        signature: {
          algorithmHash: 'md5', // Invalid
        },
      };

      const result = BtpsAgentOptionsSchema.safeParse(invalidOptions);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['signature', 'algorithmHash']);
      }
    });

    it('should fail with invalid encryption mode', () => {
      const invalidOptions = {
        encryption: {
          algorithm: 'aes-256-gcm',
          mode: 'invalid-mode', // Invalid
        },
      };

      const result = BtpsAgentOptionsSchema.safeParse(invalidOptions);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['encryption', 'mode']);
      }
    });
  });

  describe('BtpCryptoOptionsSchema', () => {
    it('should validate complete crypto options', () => {
      const options = {
        signature: {
          algorithmHash: 'sha256',
        },
        encryption: {
          algorithm: 'aes-256-gcm',
          mode: 'standardEncrypt',
        },
      };

      const result = BtpCryptoOptionsSchema.safeParse(options);
      expect(result.success).toBe(true);
    });

    it('should validate partial crypto options', () => {
      const signatureOnly = {
        signature: {
          algorithmHash: 'sha256',
        },
      };

      const encryptionOnly = {
        encryption: {
          algorithm: 'aes-256-gcm',
          mode: '2faEncrypt',
        },
      };

      expect(BtpCryptoOptionsSchema.safeParse(signatureOnly).success).toBe(true);
      expect(BtpCryptoOptionsSchema.safeParse(encryptionOnly).success).toBe(true);
    });
  });

  describe('processBtpDocSchemaForAgent', () => {
    it('should return correct schema for trust.request', () => {
      const schema = processBtpDocSchemaForAgent('trust.request');
      expect(schema).toBeDefined();
      expect(schema).not.toBeNull();
    });

    it('should return correct schema for trust.respond', () => {
      const schema = processBtpDocSchemaForAgent('trust.respond');
      expect(schema).toBeDefined();
      expect(schema).not.toBeNull();
    });

    it('should return correct schema for artifact.send', () => {
      const schema = processBtpDocSchemaForAgent('artifact.send');
      expect(schema).toBeDefined();
      expect(schema).not.toBeNull();
    });

    it('should return correct schema for draft.create', () => {
      const schema = processBtpDocSchemaForAgent('draft.create');
      expect(schema).toBeDefined();
      expect(schema).not.toBeNull();
    });

    it('should return null for unknown action type', () => {
      const schema = processBtpDocSchemaForAgent('unknown.action');
      expect(schema).toBeNull();
    });

    it('should return null for system.ping', () => {
      const schema = processBtpDocSchemaForAgent('system.ping');
      expect(schema).toBeNull();
    });
  });

  describe('New Artifact Schemas', () => {
    describe('BtpControlArtifactSchema', () => {
      it('should validate a valid QUIT control artifact', () => {
        const validControl = {
          version: '1.0.0',
          id: 'test-id-123',
          issuedAt: '2024-01-01T00:00:00.000Z',
          action: 'QUIT',
        };

        const result = BtpControlArtifactSchema.safeParse(validControl);
        expect(result.success).toBe(true);
      });

      it('should validate a valid PING control artifact', () => {
        const validControl = {
          version: '1.0.0',
          id: 'test-id-456',
          issuedAt: '2024-01-01T00:00:00.000Z',
          action: 'PING',
        };

        const result = BtpControlArtifactSchema.safeParse(validControl);
        expect(result.success).toBe(true);
      });

      it('should fail validation for invalid action', () => {
        const invalidControl = {
          version: '1.0.0',
          id: 'test-id-123',
          issuedAt: '2024-01-01T00:00:00.000Z',
          action: 'INVALID',
        };

        const result = BtpControlArtifactSchema.safeParse(invalidControl);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].path).toEqual(['action']);
        }
      });
    });

    describe('BtpIdentityLookupRequestSchema', () => {
      it('should validate a valid identity lookup request', () => {
        const validRequest = {
          version: '1.0.0',
          id: 'test-id-123',
          issuedAt: '2024-01-01T00:00:00.000Z',
          identity: 'alice$example.com',
          from: 'bob$example.com',
          hostSelector: 'default',
        };

        const result = BtpIdentityLookupRequestSchema.safeParse(validRequest);
        expect(result.success).toBe(true);
      });

      it('should validate a valid identity lookup request with optional identitySelector', () => {
        const validRequest = {
          version: '1.0.0',
          id: 'test-id-123',
          issuedAt: '2024-01-01T00:00:00.000Z',
          identity: 'alice$example.com',
          from: 'bob$example.com',
          hostSelector: 'default',
          identitySelector: 'custom',
        };

        const result = BtpIdentityLookupRequestSchema.safeParse(validRequest);
        expect(result.success).toBe(true);
      });

      it('should fail validation for invalid identity format', () => {
        const invalidRequest = {
          version: '1.0.0',
          id: 'test-id-123',
          issuedAt: '2024-01-01T00:00:00.000Z',
          identity: 'invalid-identity',
          from: 'bob$example.com',
          hostSelector: 'default',
        };

        const result = BtpIdentityLookupRequestSchema.safeParse(invalidRequest);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].path).toEqual(['identity']);
        }
      });
    });

    describe('BtpArtifactServerSchema', () => {
      it('should validate all artifact types', () => {
        const validArtifacts = [
          // Control artifact
          {
            version: '1.0.0',
            id: 'test-id-123',
            issuedAt: '2024-01-01T00:00:00.000Z',
            action: 'QUIT',
          },
          // Identity lookup artifact
          {
            version: '1.0.0',
            id: 'test-id-456',
            issuedAt: '2024-01-01T00:00:00.000Z',
            identity: 'alice$example.com',
            from: 'bob$example.com',
            hostSelector: 'default',
          },
          // Agent artifact
          {
            id: 'test-id-789',
            action: 'system.ping',
            agentId: 'agent$example.com',
            to: 'alice$example.com',
            issuedAt: '2024-01-01T00:00:00.000Z',
            signature: {
              algorithmHash: 'sha256',
              value: 'test-signature',
              fingerprint: 'test-fingerprint',
            },
            encryption: null,
          },
        ];

        validArtifacts.forEach((artifact) => {
          const result = BtpArtifactServerSchema.safeParse(artifact);
          expect(result.success).toBe(true);
        });
      });
    });

    describe('BtpTransporterArtifactSchema', () => {
      it('should validate a valid transporter artifact', () => {
        const validTransporter = {
          version: '1.0.0',
          id: 'test-id-123',
          issuedAt: '2024-01-01T00:00:00.000Z',
          type: 'TRUST_REQ',
          from: 'alice$example.com',
          to: 'bob$example.com',
          signature: {
            algorithmHash: 'sha256',
            value: 'test-signature',
            fingerprint: 'test-fingerprint',
          },
          encryption: null,
          document: {
            id: 'trust-req-123',
            name: 'Test Company',
            email: 'test@example.com',
            reason: 'Business partnership',
            phone: '+1234567890',
            address: '123 Test St, Test City, TC 12345',
            logoUrl: 'https://example.com/logo.png',
            displayName: 'Test Company Inc',
            websiteUrl: 'https://example.com',
            message: 'We would like to establish a trust relationship',
            expiresAt: '2024-12-31T23:59:59.000Z',
            privacyType: 'unencrypted',
          },
          selector: 'default',
        };

        const result = BtpTransporterArtifactSchema.safeParse(validTransporter);
        expect(result.success).toBe(true);
      });
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle empty string for identity', () => {
      const result = identitySchema.optional().safeParse('');
      expect(result.success).toBe(false);
    });

    it('should handle null values appropriately', () => {
      const command = {
        actionType: 'system.ping',
        to: 'alice$example.com',
        document: null,
        options: null,
      };

      const result = BtpsAgentCommandSchema.safeParse(command);
      expect(result.success).toBe(false);
    });

    it('should handle missing required fields', () => {
      const incompleteCommand = {
        actionType: 'system.ping',
        // missing 'to' field
        document: undefined,
        options: undefined,
      };

      const result = BtpsAgentCommandSchema.safeParse(incompleteCommand);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['to']);
      }
    });

    it('should handle extra fields gracefully', () => {
      const commandWithExtraFields = {
        actionType: 'system.ping',
        to: 'alice$example.com',
        document: undefined,
        options: undefined,
        extraField: 'should be ignored',
      };

      const result = BtpsAgentCommandSchema.safeParse(commandWithExtraFields);
      expect(result.success).toBe(true);
    });
  });
});
