import type { Config } from '@jest/types';

const config: Config.InitialOptions = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  // 记录形式（不是 [['pattern', 'transformer']] 数组）：数组形式在 jest 29 的
  // `Config.InitialOptions` 里类型不合法，会导致 jest **根本加载不了本配置**
  // （TSError: Type '[string, string][]' is not assignable），test 档一律 exit 1。
  transform: { '^.+\\.ts?$': 'ts-jest' },
  collectCoverageFrom: ['**/*.(ts|js)', '!**/*.d.ts', '!**/node_modules/**'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
};

export default config;
