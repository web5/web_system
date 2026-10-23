/** jest 配置（deploy-console 单元测试） */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  // 集成测试需要真实 DB，CI 中排除；本地用 jest.int.config.js 跑
  testPathIgnorePatterns: ['<rootDir>/src/integration/'],
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  testEnvironment: 'node',
  // @web-system/shared 通过 file: 链接，jest 直接映射到源码（ts-jest 转译）
  moduleNameMapper: {
    '^@web-system/shared$': '<rootDir>/../../packages/shared/src/index.ts',
  },
  collectCoverageFrom: ['src/**/*.ts'],
  coverageDirectory: 'coverage',
};
