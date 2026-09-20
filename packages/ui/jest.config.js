/**
 * packages/ui 单测配置。
 *
 * 只用工作区已装的 jest / ts-jest（不新增依赖）：共享组合式函数（如 env 解析）
 * 的语义需要被锁死，否则 shell / admin / portal 三处会出现环境解析漂移。
 * 测试环境用 node：env.spec.ts 自行 stub localStorage，无需 jsdom。
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['**/*.spec.ts'],
};
