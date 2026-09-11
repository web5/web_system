import { PlatformScriptSeedService } from './platform-script-seed.service';
import { getPlatformStepScript } from '../pipeline/step-scripts';

/**
 * 平台托管脚本同步的防回归测试。
 *
 * 语义：**代码是真相源**（启动/提交时把 git 脚本同步进 DB，`locked=true`，接口拒写）。
 * 因此这里锁死三件事：新模板会补、内容一致不写库、内容变化会覆盖。
 */
describe('PlatformScriptSeedService（平台托管脚本同步）', () => {
  let repo: {
    rows: any[];
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
  };
  let templates: { rows: Array<{ id: string }>; find: jest.Mock };
  let svc: PlatformScriptSeedService;
  const GIT = () => getPlatformStepScript('git');

  beforeEach(() => {
    repo = {
      rows: [] as any[],
      findOne: jest.fn(async ({ where }: any) =>
        repo.rows.find((r) => r.templateId === where.templateId && r.nodeKey === where.nodeKey) ?? null,
      ),
      create: jest.fn((o: any) => ({ ...o })),
      save: jest.fn(async (r: any) => {
        const i = repo.rows.findIndex((x) => x.templateId === r.templateId && x.nodeKey === r.nodeKey);
        if (i >= 0) repo.rows[i] = r;
        else repo.rows.push(r);
        return r;
      }),
      find: jest.fn(async () => templates.rows),
    };
    templates = { rows: [{ id: 't1' }, { id: 't2' }], find: jest.fn(async () => templates.rows) };
    svc = new PlatformScriptSeedService(repo as never, templates as never);
  });

  it('无记录 → 新建 git 节点命令并置 locked=true', async () => {
    const wrote = await svc.seedForTemplate('t1');
    expect(wrote).toBe(true);
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0]).toMatchObject({ templateId: 't1', nodeKey: 'git', locked: true, enabled: true });
    expect(repo.rows[0].command).toContain('set -euo pipefail');
    expect(repo.rows[0].updatedBy).toBe('system');
  });

  it('内容与锁定位都已一致 → 不写库（幂等，避免每次启动都 UPDATE）', async () => {
    await svc.seedForTemplate('t1');
    const saveCalls = repo.save.mock.calls.length;

    const wrote = await svc.seedForTemplate('t1');
    expect(wrote).toBe(false);
    expect(repo.save.mock.calls.length).toBe(saveCalls);
  });

  it('脚本内容变化 → 覆盖（代码是真相源，DB 只是存放介质）', async () => {
    await svc.seedForTemplate('t1');
    repo.rows[0].command = '# 被人改坏了';

    const wrote = await svc.seedForTemplate('t1');
    expect(wrote).toBe(true);
    expect(repo.rows[0].command).toBe(GIT());
    expect(repo.rows[0].locked).toBe(true);
  });

  it('存量用户行（locked=false）→ 补上锁定位与正文', async () => {
    repo.rows.push({ templateId: 't1', nodeKey: 'git', command: '旧脚本', locked: false, enabled: false });

    const wrote = await svc.seedForTemplate('t1');
    expect(wrote).toBe(true);
    expect(repo.rows[0]).toMatchObject({ locked: true, enabled: true });
    expect(repo.rows[0].command).toBe(GIT());
  });

  it('seedAll 遍历全部模板（新模板不会漏）', async () => {
    const changed = await svc.seedAll();
    expect(changed).toBe(2);
    expect(repo.rows.map((r) => r.templateId).sort()).toEqual(['t1', 't2']);
  });
});
