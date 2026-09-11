import { PipelineStepCommandService } from './pipeline-step-command.service';

/**
 * 节点命令写入守卫的防回归测试。
 *
 * 两条边界：
 *  - `locked=true`（平台托管，如 git）：接口一律拒写 —— 平台脚本只能由代码同步；
 *  - `version` / `pointer`（平台保留字）：结构上就不允许作为节点命令存在。
 */
describe('PipelineStepCommandService（写入守卫）', () => {
  const mk = (row: unknown) =>
    new PipelineStepCommandService({
      findOne: jest.fn(async () => row),
      delete: jest.fn(async () => undefined),
      save: jest.fn(async (r: unknown) => r),
      create: jest.fn((o: unknown) => o),
    } as never);

  it('git：被平台保留字挡在 upsert 之外（结构上就不可写）', async () => {
    const svc = mk({ templateId: 't1', nodeKey: 'git', locked: true });
    await expect(svc.upsert('t1', 'git', 'echo hack')).rejects.toThrow(/平台保留/);
  });

  it('locked 行（非保留字节点）：upsert 被平台托管守卫拒绝', async () => {
    const svc = mk({ templateId: 't1', nodeKey: 'build', locked: true });
    await expect(svc.upsert('t1', 'build', 'echo hack')).rejects.toThrow(/平台托管/);
  });

  it('locked 行：remove 被拒，且不执行删除', async () => {
    const repo = {
      findOne: jest.fn(async () => ({ locked: true })),
      delete: jest.fn(async () => undefined),
    };
    const svc = new PipelineStepCommandService(repo as never);
    await expect(svc.remove('t1', 'git')).rejects.toThrow(/平台托管/);
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('平台保留字（version/pointer）仍按保留字拒绝', async () => {
    const svc = mk(null);
    await expect(svc.upsert('t1', 'version', 'echo hi')).rejects.toThrow(/平台保留/);
    await expect(svc.upsert('t1', 'pointer', 'echo hi')).rejects.toThrow(/平台保留/);
  });

  it('普通 script 节点（未锁定）正常放行', async () => {
    const svc = mk({ templateId: 't1', nodeKey: 'build', locked: false });
    await expect(svc.upsert('t1', 'build', 'echo ok')).resolves.toBeTruthy();
  });
});
