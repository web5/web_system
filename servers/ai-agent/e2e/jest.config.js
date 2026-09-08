/**
 * contract-risk E2E 判定单测专用 jest 配置。
 * 仅跑 e2e/contract-risk/*.spec.ts（零 token：不调 LLM，只测 checker/判定逻辑）。
 * 运行：pnpm test:e2e（在 servers/ai-agent 下）
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  roots: ['<rootDir>/contract-risk'],
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  testEnvironment: 'node',
  coverageDirectory: '../coverage-e2e',
};
