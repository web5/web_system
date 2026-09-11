module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
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
