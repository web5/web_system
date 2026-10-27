/**
 * jest 配置（deploy-console 前端纯函数单测）。
 *
 * 用途：Q3（2026-10-27）「新建流水线默认节点序列」用例在前端层落地——
 * 在哪层实现就在哪层测。runner 复用根 node_modules 的 jest / ts-jest
 * （与 apps/admin、servers/* 同源），零新增依赖；只跑 src 下 *.spec.ts 纯函数用例。
 */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        target: 'ES2020',
        module: 'commonjs',
        strict: true,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        skipLibCheck: true,
        resolveJsonModule: true,
      },
      diagnostics: false,
    }],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
