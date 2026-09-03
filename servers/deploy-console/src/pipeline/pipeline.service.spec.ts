import * as path from 'path';
import { resolveStageCwd, isDeletablePipeline } from './pipeline.service';

/**
 * 执行记录删除状态门禁的防回归测试。
 *
 * 背景：历史「删除执行记录」被设计为纯清理（不动版本指针/产物），
 * 但 running/pending/pending-approval 中的实例若被删，正在执行的引擎还会
 * 回写状态/日志到已删行，产生幽灵更新。此测试锁定「仅终态可删」。
 */
describe('isDeletablePipeline（执行记录删除状态门禁）', () => {
  it('终态（succeeded/failed/cancelled）可删', () => {
    for (const s of ['succeeded', 'failed', 'cancelled']) {
      expect(isDeletablePipeline(s)).toBe(true);
    }
  });

  it('运行/待执行/待审批不可删（须先停止或等待结束）', () => {
    for (const s of ['running', 'pending', 'pending-approval']) {
      expect(isDeletablePipeline(s)).toBe(false);
    }
  });
});

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
