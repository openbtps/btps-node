import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

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
      type: 'doc',
      id: 'gettingStarted/setup',
      label: 'Getting Started',
    },
    {
      type: 'category',
      label: 'Protocol',
      collapsed: false,
      items: [
        'protocol/overview',
        'protocol/principles',
        'protocol/specifications',
        'protocol/trustRecord',
        'protocol/messageFlow',
        {
          type: 'category',
          label: 'Delegation',
          items: [
            'protocol/delegation/overview',
            'protocol/delegation/authentication',
            'protocol/delegation/messageFlow',
            'protocol/delegation/revocation',
            'protocol/delegation/bestPractices',
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
