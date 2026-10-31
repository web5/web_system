/** jest 配置（mcp-gateway 单元测试） */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  // 装饰器（@Controller / @InjectRepository）依赖 reflect-metadata 先加载
  setupFiles: ['reflect-metadata'],
  transform: {
    // 只转译 .ts：工作区依赖的 dist/*.js 是已编译产物，不该再过一遍 ts-jest
    //（否则 tsconfig 未开 allowJs，每次都会刷「Got a .js file」告警）
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  testEnvironment: 'node',
  // 工作区依赖（@web-system/shared、@web-system/mcp-core）走 **构建产物** 解析，
  // 与 content-hub 同口径：先跑依赖包 build 再跑 test。
  // CI 的 scripts/ci/changed-packages.sh 已经按拓扑序先构建「改动包的工作区依赖」，
  // 本地则 `pnpm --filter @web-system/shared --filter @web-system/mcp-core build`。
  collectCoverageFrom: ['src/**/*.ts'],
  coverageDirectory: 'coverage',
};
