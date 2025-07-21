import React from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './index.module.css';
console.log(styles);
function HeroSection() {
  return (
    <section className={styles.hero}>
      <div className="container">
        <div className={styles.heroContent}>
          <Heading as="h2" className={styles.noticeTitle}>
            Currently in Alpha Release
          </Heading>
          <Heading as="h1" className={styles.heroTitle}>
            BTPS
          </Heading>
          <Heading as="h2" className={styles.heroSubtitle}>
            Billing Trust Protocol Secure
          </Heading>
          <Heading as="h1" className={styles.heroTitleSecondary}>
            Secure, Decentralized, Federated, Verifiable Electronic Billing Protocol
          </Heading>
          <p className={styles.heroSubtitle}>
            BTPS is an open protocol for cryptographically secure encrypted electronic billing and
            invoice delivery across SaaS, fintech, and enterprise ecosystems.
          </p>
          <div className={styles.heroButtons}>
            <Link className={styles.primaryButton} to="/docs/">
              Read the Docs
            </Link>
            <Link className={styles.secondaryButton} to="/docs/cli/overview">
              Try the CLI
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function AboutSection() {
  return (
    <section className={styles.about}>
      <div className="container">
        <div className={styles.sectionHeader}>
          <Heading as="h2">About BTPS</Heading>
        </div>
        <div className={styles.aboutContent}>
          <p className={styles.aboutText}>
            BTPS (Billing Trust Protocol Secure) is an open, trust-based protocol for secure,
            cryptographically verifiable billing and invoice communication. It is designed to stop
            invoice fraud, automate onboarding, and enable secure, auditable, and interoperable
            workflows between parties.
          </p>
        </div>
      </div>
    </section>
  );
}

function WhyUseSection() {
  const benefits = [
    {
      title: 'Trust Based Protocol',
      description: 'Messages are only delivered if the sender is in the trusted list',
    },
    {
      title: 'E2E Encryption Support',
      description: 'Messages are encrypted end-to-end. Even the SaaS can not decrypt the message.',
    },
    {
      title: 'BYOK (Bring Your Own Key) Supported',
      description: 'Users own their keys, identities, and operate independently',
    },
    {
      title: 'Prevent invoice fraud',
      description: 'with cryptographic identity and signature verification',
    },
    {
      title: 'Simplify onboarding',
      description: 'with DNS-based identity resolution',
    },
    {
      title: 'Offline and Resilient',
      description: 'Verifiable delivery even during SaaS downtime for E2E encrypted messages',
    },
    {
      title: 'Minimal protocol, maximum extensibility',
      description: 'Identity, integrity, and delivery — nothing else enforced',
    },
    {
      title: 'Empower federated delivery',
      description: '— no vendor lock-in',
    },
    {
      title: 'Enable zero-trust billing',
      description: 'environments with zero-trust messaging',
    },
  ];

  return (
    <section className={styles.whyUse}>
      <div className="container">
        <div className={styles.sectionHeader}>
          <Heading as="h2">Why Use BTPS?</Heading>
        </div>
        <div className={styles.benefitsGrid}>
          {benefits.map((benefit, index) => (
            <div key={index} className={styles.benefitCard}>
              <h3>{benefit.title}</h3>
              <p>{benefit.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function PrinciplesSection() {
  const principles = [
    {
      icon: '🔐',
      title: 'Sovereignty-first',
      description: 'Users own their keys, identities, and operate independently',
    },
    {
      icon: '🏗',
      title: 'Minimal protocol, maximum extensibility',
      description: 'Identity, integrity, and delivery — nothing else enforced',
    },
    {
      icon: '🌐',
      title: 'Federated by design',
      description: 'No central gatekeeper — any server can host identities',
    },
    {
      icon: '💸',
      title: 'SaaS monetization supported, not required',
      description: 'SaaS can layer value — not control delivery',
    },
    {
      icon: '⚙️',
      title: 'Offline and resilient',
      description: 'Verifiable delivery even during SaaS downtime',
    },
    {
      icon: '🧾',
      title: 'Verifiable, not enforceable',
      description: 'Signatures and claims are auditable, not enforced by intermediaries',
    },
  ];

  return (
    <section className={styles.principles}>
      <div className="container">
        <div className={styles.sectionHeader}>
          <Heading as="h2">Core Principles</Heading>
        </div>
        <div className={styles.principlesGrid}>
          {principles.map((principle, index) => (
            <div key={index} className={styles.principleCard}>
              <div className={styles.principleIcon}>{principle.icon}</div>
              <h3>{principle.title}</h3>
              <p>{principle.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function EngineerFeaturesSection() {
  const features = [
    {
      title: 'DNS + crypto-native identity model',
      description: 'Built on proven DNS infrastructure with cryptographic verification',
    },
    {
      title: 'CLI-first developer workflow',
      description: 'Command-line tools for rapid development and testing',
    },
    {
      title: 'JSON-based envelope format',
      description: 'Simple, human-readable message format with full extensibility',
    },
    {
      title: 'Works with existing infra',
      description: 'TLS, DNS, certs — no new infrastructure required',
    },
    {
      title: 'Integrates easily',
      description: 'Into SaaS, billing, fintech stacks with minimal changes',
    },
  ];

  return (
    <section className={styles.engineerFeatures}>
      <div className="container">
        <div className={styles.sectionHeader}>
          <Heading as="h2">Built for Engineers</Heading>
        </div>
        <div className={styles.featuresGrid}>
          {features.map((feature, index) => (
            <div key={index} className={styles.featureCard}>
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function UseCasesSection() {
  const useCases = [
    {
      title: 'Automated invoice delivery',
      description: 'across SaaS platforms',
    },
    {
      title: 'Payslip transmission',
      description: 'to individual employees',
    },
    {
      title: 'B2B billing flows',
      description: 'with delegated identity and audit trails',
    },
    {
      title: 'Financial platforms',
      description: 'needing zero-trust messaging',
    },
  ];

  return (
    <section className={styles.useCases}>
      <div className="container">
        <div className={styles.sectionHeader}>
          <Heading as="h2">Use Cases</Heading>
        </div>
        <div className={styles.useCasesGrid}>
          {useCases.map((useCase, index) => (
            <div key={index} className={styles.useCaseCard}>
              <h3>{useCase.title}</h3>
              <p>{useCase.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TechnologiesSection() {
  const technologies = [
    'Node.js',
    'DNS TXT records',
    'Public key infrastructure',
    'Base64',
    'TLS',
    'JSON',
  ];

  return (
    <section className={styles.technologies}>
      <div className="container">
        <div className={styles.sectionHeader}>
          <Heading as="h2">Technologies</Heading>
        </div>
        <div className={styles.techBadges}>
          {technologies.map((tech, index) => (
            <span key={index} className={styles.techBadge}>
              {tech}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  const { siteConfig } = useDocusaurusContext();

  return (
    <Layout
      title="BTPS - Secure, Verifiable Billing Communication"
      description="BTPS is an open protocol for cryptographically secure billing and invoice delivery across SaaS, fintech, and enterprise ecosystems."
    >
      <main className={styles.main}>
        <HeroSection />
        <AboutSection />
        <WhyUseSection />
        <PrinciplesSection />
        <EngineerFeaturesSection />
        <UseCasesSection />
        <TechnologiesSection />
      </main>
    </Layout>
  );
}
