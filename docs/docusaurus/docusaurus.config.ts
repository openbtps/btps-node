import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'BTPS Documentation',
  tagline: 'Billing Trust Protocol Secure',
  favicon: 'favicon.ico',
  headTags: [
    {
      tagName: 'link',
      attributes: {
        rel: 'apple-touch-icon',
        sizes: '180x180',
        href: 'favicon/apple-touch-icon.png',
      },
    },
    {
      tagName: 'link',
      attributes: {
        rel: 'icon',
        type: 'image/png',
        sizes: '32x32',
        href: 'favicon/favicon-32x32.png',
      },
    },
    {
      tagName: 'link',
      attributes: {
        rel: 'icon',
        type: 'image/png',
        sizes: '16x16',
        href: 'favicon/favicon-16x16.png',
      },
    },
    {
      tagName: 'link',
      attributes: {
        rel: 'manifest',
        href: 'favicon/site.webmanifest',
      },
    },
    {
      tagName: 'link',
      attributes: {
        rel: 'icon',
        type: 'image/png',
        sizes: '192x192',
        href: 'favicon/android-chrome-192x192.png',
      },
    },
    {
      tagName: 'link',
      attributes: {
        rel: 'icon',
        type: 'image/png',
        sizes: '512x512',
        href: 'favicon/android-chrome-512x512.png',
      },
    },
  ],

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  // Set the production url of your site here
  url: 'https://openbtps.org',
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: '/',

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: 'openbtps', // Usually your GitHub org/user name.
  projectName: 'btps-node', // Usually your repo name.

  onBrokenLinks: 'warn',
  onBrokenMarkdownLinks: 'warn',

  // Even if you don't use internalization, you can use this field to set useful
  // metadata like html lang. For example, if your site is Chinese, you may want
  // to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      {
        docs: {
          path: 'docs',
          routeBasePath: 'docs',
          sidebarPath: './sidebars.ts',
          // Please change this to your repo.
          // Remove this to remove the "edit this page" links.
          editUrl: 'https://github.com/btps/btps-docs/tree/main/',
          // Versioning configuration
          // includeCurrentVersion: false,
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
        sitemap: {
          changefreq: 'weekly',
          priority: 0.5,
          ignorePatterns: ['/tags/**'],
          filename: 'sitemap.xml',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    {
      // Replace with your project's social card
      image: 'img/btps-social-card.jpg',
      navbar: {
        logo: {
          alt: 'BTPS Logo',
          src: 'img/btps.png',
          srcDark: 'img/btps-white.svg',
        },
        items: [
          // {
          //   type: 'docsVersionDropdown',
          //   position: 'right',
          //   dropdownActiveClassDisabled: true,
          // },
          {
            type: 'docSidebar',
            sidebarId: 'docs',
            position: 'left',
            label: 'Docs',
          },
          {
            href: 'https://github.com/openbtps/btps-node',
            label: 'GitHub',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Protocol',
            items: [
              {
                label: 'Overview',
                to: '/docs/protocol/overview',
              },
              {
                label: 'Architecture',
                to: '/docs/',
              },
              {
                label: 'Principles',
                to: '/docs/protocol/principles',
              },
              {
                label: 'Specifications',
                to: '/docs/protocol/specifications',
              },
              {
                label: 'Security',
                to: '/docs/protocol/security/overview',
              },
              {
                label: 'Authentication',
                to: '/docs/protocol/authentication/overview',
              },
              {
                label: 'Delegation',
                to: '/docs/protocol/delegation/overview',
              },
            ],
          },
          {
            title: 'Getting Started',
            items: [
              {
                label: 'Quick Start',
                to: '/docs/getting-started/installation',
              },
              {
                label: 'Server Setup',
                to: '/docs/getting-started/server/setup',
              },
              {
                label: 'Client Setup',
                to: '/docs/getting-started/client/setup',
              },
              {
                label: 'Btps Agent',
                to: '/docs/getting-started/client/agent-setup',
              },
              {
                label: 'Btps Transporter',
                to: '/docs/getting-started/client/transporter-setup',
              },
            ],
          },
          {
            title: 'SDK Documentation',
            items: [
              {
                label: 'Overview',
                to: '/docs/sdk/overview',
              },
              {
                label: 'API References',
                to: '/docs/sdk/api-references',
              },
              {
                label: 'Class References',
                to: '/docs/sdk/class-api-references',
              },
              {
                label: 'Types and Interfaces',
                to: '/docs/sdk/types-and-interfaces',
              },
            ],
          },
          {
            title: 'Developer Resources',
            items: [
              {
                label: 'BTPS Client',
                to: '/docs/client/overview',
              },
              {
                label: 'Client Best Practices',
                to: '/docs/client/best-practices',
              },
              {
                label: 'BTPS Server',
                to: '/docs/server/overview',
              },
              {
                label: 'Middlewares',
                to: '/docs/server/middlewares',
              },
              {
                label: 'Advanced Usages',
                to: '/docs/server/advanced-usages',
              },
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} Bhupendra Tamang`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
      },
    } satisfies Preset.ThemeConfig,

  // Mermaid plugin configuration
  themes: ['@docusaurus/theme-mermaid'],
  markdown: {
    mermaid: true,
  },

  plugins: [
    // Remove docusaurus-search-local plugin
  ],
} satisfies Config;

export default config;
