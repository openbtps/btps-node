import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts', '**/*.spec.ts'],
  modulePathIgnorePatterns: ['<rootDir>/dist/'],
  roots: ['<rootDir>'], // 👈 include all folders
  moduleNameMapper: {
    '@core/(.*)$': '<rootDir>/src/core/$1',
  },
};

export default config;
