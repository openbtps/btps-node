import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

/**
 * Creating a sidebar enables you to:
 - create an ordered group of docs
 - render a sidebar for each doc of that group
 - provide next/previous navigation

 The sidebars can be generated from the filesystem, or explicitly defined here.

 Create as many sidebars as you want.
 */
const sidebars: SidebarsConfig = {
  // Manual sidebar configuration for explicit control over order
  docs: [
    {
      type: 'doc',
      id: 'introduction',
      label: 'BTPS Introduction',
    },
    {
      type: 'category',
      label: 'Getting Started',
      collapsed: false,
      items: [
        'getting-started/installation',
        {
          type: 'category',
          label: 'Server Setup',
          items: [
            'getting-started/server/prerequisites',
            'getting-started/server/setup',
            'getting-started/server/dataStorageSupport',
            'getting-started/server/databaseIntegration',
            'getting-started/server/middlewares',
            'getting-started/server/eventHandlers',
            'getting-started/server/transporterSupport',
            'getting-started/server/authenticationSupport',
            'getting-started/server/delegationSupport',
            'getting-started/server/forwardingArtifact',
            'getting-started/server/supportingQueries',
          ],
        },
        {
          type: 'category',
          label: 'Client Setup',
          items: [
            'getting-started/client/prerequisites',
            'getting-started/client/setup',
            'getting-started/client/authentication',
            'getting-started/client/btpsAgent',
            'getting-started/client/btpsTransporter',
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Protocol',
      collapsed: false,
      items: [
        'protocol/overview',
        'protocol/principles',
        'protocol/specifications',
        'protocol/keyRotation',
        'protocol/trustRecord',
        'protocol/messageFlow',
        {
          type: 'category',
          label: 'Delegation',
          items: [
            'protocol/delegation/overview',
            'protocol/delegation/specification',
            'protocol/delegation/verificationProcess',
            'protocol/delegation/delegationFlow',
            'protocol/delegation/btpsDelegator',
            'protocol/delegation/bestPractices',
            'protocol/delegation/revocation',
          ],
        },
        {
          type: 'category',
          label: 'Authentication',
          items: [
            'protocol/authentication/overview',
            'protocol/authentication/setup',
            'protocol/authentication/authenticationFlow',
            'protocol/authentication/btpsAuthentication',
            'protocol/authentication/examples',
          ],
        },
        {
          type: 'category',
          label: 'Security',
          items: [
            'protocol/security/overview',
            'protocol/security/algorithm',
            'protocol/security/encryption',
            'protocol/security/decryption',
            'protocol/security/signature',
            'protocol/security/keyManagement',
            'protocol/security/bestPractices',
          ],
        },

        // Add more protocol docs here
      ],
    },
    {
      type: 'category',
      label: 'BTPS Client',
      items: [
        'client/overview',
        'client/setup',
        {
          type: 'category',
          label: 'BTPS Agent',
          items: [
            'client/btpsAgent/overview',
            'client/btpsAgent/setup',
            'client/btpsAgent/commands',
            'client/btpsAgent/examples',
          ],
        },
        {
          type: 'category',
          label: 'BTPS Transporter',
          items: [
            'client/btpsTransporter/overview',
            'client/btpsTransporter/setup',
            'client/btpsTransporter/examples',
          ],
        },
        'client/examples',
        'client/metricsAndMonitor',
        'client/debugging',
        'client/bestPractices',
      ],
    },
    {
      type: 'category',
      label: 'BTPS Server',
      items: [
        'server/overview',
        'server/setup',
        'server/middlewares',
        'server/advancedUsages',
        'server/metricsAndMonitor',
        'server/debugging',
      ],
    },
    {
      type: 'category',
      label: 'SDK & API Reference',
      items: [
        'sdk/overview',
        'sdk/apiReference',
        'sdk/classApiReference',
        'sdk/typesAndInterfaces',
      ],
    },
  ],
};

export default sidebars;
