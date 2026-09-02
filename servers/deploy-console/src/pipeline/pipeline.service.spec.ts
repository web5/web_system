import * as path from 'path';
import { resolveStageCwd } from './pipeline.service';

/**
 * 阶段命令工作目录的防回归测试。
 *
 * 背景：从旧 stageBuild 重构为命令驱动时，spawn 丢失了 cwd 设置，
 * 导致默认模板命令（如 `npx tsc -p tsconfig.json`）在 deploy-console 自身目录下执行，
 * 编译错目标。此测试锁定「命令必须在模块目录执行」这一约束。
 */
describe('resolveStageCwd（阶段命令工作目录）', () => {
  const ws = '/release';

  it('后端模块落在 servers/<dir>', () => {
    expect(resolveStageCwd(ws, 'backend', 'auth-service')).toBe(
      path.join(ws, 'servers', 'auth-service'),
    );
  });

  it('前端 / 微前端 / 小程序落在 apps/<dir>', () => {
    expect(resolveStageCwd(ws, 'frontend', 'admin')).toBe(path.join(ws, 'apps', 'admin'));
    expect(resolveStageCwd(ws, 'micro-frontend', 'portal')).toBe(path.join(ws, 'apps', 'portal'));
    expect(resolveStageCwd(ws, 'mini-app', 'mp')).toBe(path.join(ws, 'apps', 'mp'));
  });

  it('模块目录缺失时回落到发布目录（不落到 deploy-console 自身目录）', () => {
    expect(resolveStageCwd(ws, 'backend', undefined)).toBe(ws);
    expect(resolveStageCwd(ws, undefined, undefined)).toBe(ws);
  });
});
