# Contributing to BTPS SDK

Thank you for your interest in contributing to the BTPS SDK! This document provides guidelines and best practices for contributing to the project.

---

## 🚀 Getting Started

### Prerequisites

- **Node.js ≥ 16** (ESM-only package)
- **Yarn** (recommended) or npm
- **Git**

### Development Setup

```bash
# Clone the repository
git clone https://github.com/openbtps/btps-node
cd btps-node

# Install dependencies
yarn install

# Build the project
yarn build

# Run tests
yarn test

# Start development mode
yarn dev
```

---

## 📋 Contribution Guidelines

### Code Style and Standards

- **TypeScript:** All code must be written in TypeScript with strict type checking
- **ESM Only:** Use ES modules (`import`/`export`) - no CommonJS (`require`)
- **ESLint:** Follow the project's ESLint configuration
- **Prettier:** Code formatting is handled by Prettier
- **Conventional Commits:** Use conventional commit messages

### File Structure

```
src/
├── client/          # Client SDK
├── server/          # Server SDK
├── core/            # Core utilities and types
│   ├── crypto/      # Cryptographic functions
│   ├── trust/       # Trust store implementations
│   ├── error/       # Error handling
│   └── utils/       # Utility functions
└── index.ts         # Main entry point
```

### Naming Conventions

- **Files:** Use kebab-case for file names (e.g., `btps-server.ts`)
- **Classes:** Use PascalCase (e.g., `BtpsServer`)
- **Functions:** Use camelCase (e.g., `sendInvoice`)
- **Constants:** Use UPPER_SNAKE_CASE (e.g., `DEFAULT_PORT`)
- **Types/Interfaces:** Use PascalCase with descriptive names (e.g., `BTPArtifact`)

---

## 🧪 Testing Requirements

### Test Coverage Requirements

- **Minimum Coverage:** 90% code coverage required
- **Critical Paths:** 100% coverage for cryptographic functions and trust verification
- **Integration Tests:** Required for all public APIs
- **Error Handling:** All error paths must be tested

### Test Structure

```typescript
// Example test structure
describe('BtpsServer', () => {
  describe('constructor', () => {
    it('should create server with default options', () => {
      // Test implementation
    });

    it('should throw error for invalid options', () => {
      // Test error handling
    });
  });

  describe('start()', () => {
    it('should start server successfully', async () => {
      // Test implementation
    });

    it('should handle startup errors', async () => {
      // Test error scenarios
    });
  });
});
```

### Running Tests

```bash
# Run all tests
yarn test

# Run tests with coverage
yarn test:coverage

# Run tests in watch mode
yarn test:watch

# Run specific test file
yarn test src/server/btpsServer.test.ts

# Run integration tests
yarn test:integration
```

### Test Best Practices

1. **Arrange-Act-Assert:** Structure tests with clear setup, execution, and verification
2. **Descriptive Names:** Use descriptive test names that explain the scenario
3. **Isolation:** Each test should be independent and not rely on other tests
4. **Mocking:** Mock external dependencies (DNS, network, file system)
5. **Edge Cases:** Test boundary conditions and error scenarios
6. **Performance:** Include performance tests for critical functions

### Example Test Cases

```typescript
// Good test example
describe('signEncrypt', () => {
  it('should sign and encrypt document with valid parameters', async () => {
    // Arrange
    const document = { type: 'BTPS_DOC', document: { amount: 100 } };
    const recipient = 'pay$client.com';
    const keys = await keygen('ed25519');

    // Act
    const result = await signEncrypt(recipient, keys, document);

    // Assert
    expect(result.error).toBeUndefined();
    expect(result.payload).toBeDefined();
    expect(result.payload.signature).toBeDefined();
    expect(result.payload.encryption).toBeDefined();
  });

  it('should return error for invalid recipient format', async () => {
    // Arrange
    const document = { type: 'BTPS_DOC', document: { amount: 100 } };
    const invalidRecipient = 'invalid-format';
    const keys = await keygen('ed25519');

    // Act
    const result = await signEncrypt(invalidRecipient, keys, document);

    // Assert
    expect(result.error).toBeDefined();
    expect(result.error.message).toContain('Invalid recipient format');
  });
});
```

---

## 🔧 Development Workflow

### Branch Strategy

- **main:** Production-ready code
- **develop:** Integration branch for features
- **feature/\***: Feature branches (e.g., `feature/rate-limiting`)
- **bugfix/\***: Bug fix branches (e.g., `bugfix/dns-lookup-error`)
- **hotfix/\***: Critical production fixes

### Pull Request Process

1. **Create Feature Branch:** `git checkout -b feature/your-feature-name`
2. **Make Changes:** Implement your feature with tests
3. **Run Tests:** Ensure all tests pass and coverage meets requirements
4. **Update Documentation:** Update relevant documentation
5. **Create PR:** Submit pull request with detailed description
6. **Code Review:** Address review comments
7. **Merge:** Once approved, merge to develop

### Commit Message Format

Use conventional commits:

```
type(scope): description

[optional body]

[optional footer]
```

Examples:

- `feat(server): add rate limiting middleware`
- `fix(client): handle DNS resolution errors`
- `docs(readme): update installation instructions`
- `test(crypto): add test cases for key rotation`

### Types:

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes
- `refactor`: Code refactoring
- `test`: Test additions or changes
- `chore`: Build or tooling changes

---

## 🛠 Development Tools

### Available Scripts

```bash
# Build
yarn build              # Build the project
yarn build:watch        # Build in watch mode

# Testing
yarn test               # Run tests
yarn test:coverage      # Run tests with coverage
yarn test:watch         # Run tests in watch mode
yarn test:integration   # Run integration tests

# Linting and Formatting
yarn lint               # Run ESLint
yarn lint:fix           # Fix ESLint issues
yarn format             # Format code with Prettier

# Development
yarn dev                # Start development mode
yarn clean              # Clean build artifacts
```

### IDE Configuration

Recommended VS Code extensions:

- TypeScript and JavaScript Language Features
- ESLint
- Prettier
- GitLens

### Debugging

```bash
# Debug tests
yarn test:debug

# Debug with Node.js inspector
node --inspect-brk node_modules/.bin/vitest
```

---

## 📚 Documentation

### Documentation Requirements

- **API Documentation:** All public APIs must be documented
- **Examples:** Provide working examples for all major features
- **Type Definitions:** Comprehensive TypeScript definitions
- **README Updates:** Update README for new features

### Documentation Structure

```
docs/
├── SERVER.md          # Server SDK documentation
├── CLIENT.md          # Client SDK documentation
├── TRUST.md           # Trust model documentation
├── EXAMPLES.md        # Usage examples
├── ARCHITECTURE.md    # Architecture overview
└── SDK.md             # SDK reference
```

---

## 🔒 Security Considerations

### Security Best Practices

- **Input Validation:** Validate all inputs thoroughly
- **Cryptographic Security:** Use secure cryptographic algorithms and key sizes
- **Error Handling:** Don't expose sensitive information in error messages
- **Dependency Management:** Keep dependencies updated and audit for vulnerabilities
- **Secret Management:** Never commit secrets or private keys

### Security Testing

- **Penetration Testing:** Regular security assessments
- **Vulnerability Scanning:** Automated vulnerability scanning
- **Code Review:** Security-focused code reviews
- **Dependency Auditing:** Regular dependency vulnerability checks

---

## 🚀 Release Process

### Versioning

Follow semantic versioning (SemVer):

- **Major:** Breaking changes
- **Minor:** New features (backward compatible)
- **Patch:** Bug fixes (backward compatible)

### Release Checklist

- [ ] All tests pass
- [ ] Code coverage meets requirements
- [ ] Documentation is updated
- [ ] CHANGELOG is updated
- [ ] Version is bumped
- [ ] Release notes are prepared
- [ ] Security review completed

---

## 🤝 Community Guidelines

### Code of Conduct

- Be respectful and inclusive
- Provide constructive feedback
- Help others learn and grow
- Follow project guidelines

### Getting Help

- **Issues:** Use GitHub issues for bug reports and feature requests
- **Discussions:** Use GitHub discussions for questions and ideas
- **Documentation:** Check existing documentation first

---

## 📄 License

By contributing to BTPS SDK, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to BTPS SDK! 🎉
