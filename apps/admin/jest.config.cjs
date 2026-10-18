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
