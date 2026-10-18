/**
 * admin 前端单测配置。
 *
 * 为什么单独配一份：仓库既有 jest 都在 servers/*（NestJS）与 packages/*，
 * admin 此前没有测试运行时。这里刻意只覆盖 **纯逻辑**（不含 .vue 组件）：
 *   - 不需要 @vue/test-utils / jsdom 等额外依赖，ts-jest + node 环境即可；
 *   - 改动面最小，引入的理由是锁住容易写歪的判定口径（见 guard-process.spec.ts）。
 *
 * testMatch 只收 src 下的 spec：避免把 dist/ 里的构建产物当用例跑。
 */
module.exports = {
  rootDir: '.',
  // jsdom：index.ts 模块顶层 createWebHistory('/admin/') 会摸 window/history，
  // node 环境直接抛 ReferenceError。改成 jsdom 即可，无需 @vue/test-utils。
  testEnvironment: 'jsdom',
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
    // ⚠️ 顺序敏感：jest 按声明顺序匹配，'^@/(.*)$' 会吞掉任何以 @/ 开头的更具体规则。
    // 因此 @/stores/user、@/utils/module-load-error 必须排在它前面 ——
    // 否则 store 不被 stub，模块顶层的 persist.storage = localStorage 在 node 环境下直接抛错。
    '^@/stores/user$': '<rootDir>/test-stubs/empty-module.ts',
    '^@/utils/module-load-error$': '<rootDir>/test-stubs/empty-module.ts',
    '^@web-system/': '<rootDir>/test-stubs/empty-module.ts',
    '\\.vue$': '<rootDir>/test-stubs/empty-module.ts',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
