import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'BTPS Documentation',
  tagline: 'Billing Trust Protocol Secure',
  favicon: 'img/favicon.ico',

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  // Set the production url of your site here
  url: 'https://btps.org',
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: '/',

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: 'btps', // Usually your GitHub org/user name.
  projectName: 'btps-docs', // Usually your repo name.

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
      ({
        docs: {
          path: 'docs',
          routeBasePath: 'docs',
          sidebarPath: './sidebars.ts',
          // Please change this to your repo.
          // Remove this to remove the "edit this page" links.
          editUrl:
            'https://github.com/btps/btps-docs/tree/main/',
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
        }
      }) satisfies Preset.Options,
      
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      // Replace with your project's social card
      image: 'img/btps-social-card.jpg',
      navbar: {
        title: 'BTPS',
        logo: {
          alt: 'BTPS Logo',
          src: 'img/logo.svg',
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
            label: 'Documentation',
          },
          {
            href: 'https://github.com/btps/btps-sdk',
            label: 'GitHub',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Docs',
            items: [
              {
                label: 'Introduction',
                to: '/docs/',
              },
              {
                label: 'Protocol Overview',
                to: '/docs/protocol/overview',
              },
              {
                label: 'SDK Overview',
                to: '/docs/sdk/overview',
              },
            ],
          },
          // {
          //   title: 'Community',
          //   items: [
          //     {
          //       label: 'GitHub',
          //       href: 'https://github.com/btps/btps-sdk',
          //     },
          //     {
          //       label: 'Discussions',
          //       href: 'https://github.com/btps/btps-sdk/discussions',
          //     },
          //     {
          //       label: 'Issues',
          //       href: 'https://github.com/btps/btps-sdk/issues',
          //     },
          //   ],
          // },
          // {
          //   title: 'More',
          //   items: [
          //     {
          //       label: 'Blog',
          //       to: '/blog',
          //     },
          //     {
          //       label: 'Apache 2.0 License',
          //       href: 'https://github.com/btps/btps-sdk/blob/main/LICENSE',
          //     },
          //   ],
          // },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} Bhupendra Tamang. Built with Docusaurus.`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
      },
    }) satisfies Preset.ThemeConfig,

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
