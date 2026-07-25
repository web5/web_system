module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': [
      '/Users/geekwen/workspace/web_system/node_modules/.pnpm/ts-jest@29.4.11_@babel+core@7.29.0_@jest+transform@30.4.1_@jest+types@30.4.1_babel-jest_b25c8910ac5098d335ccf1a0d9542cd3/node_modules/ts-jest',
      { tsconfig: '<rootDir>/tsconfig.json' },
    ],
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(.pnpm/)?(@nestjs|@web-system)/)',
  ],
  moduleNameMapper: {
    '^@web-system/types$': '<rootDir>/../../packages/types/src',
    '^@web-system/shared$': '<rootDir>/../../packages/shared/src',
  },
  testEnvironment: 'node',
};
