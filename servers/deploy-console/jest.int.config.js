/** jest 集成测试配置（需要真实 MySQL，CI 中不跑） */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.int\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@web-system/shared$': '<rootDir>/../../packages/shared/src/index.ts',
  },
};
