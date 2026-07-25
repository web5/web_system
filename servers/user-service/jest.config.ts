import type { Config } from '@jest/types';

const config: Config.InitialOptions = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: [['^.+\\.ts?$', 'ts-jest']],
  collectCoverageFrom: ['**/*.(ts|js)', '!**/*.d.ts', '!**/node_modules/**'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
};

export default config;
