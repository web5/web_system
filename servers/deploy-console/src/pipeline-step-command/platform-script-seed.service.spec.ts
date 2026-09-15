import { PlatformScriptSeedService } from './platform-script-seed.service';
import {
  getPlatformStepScript,
  getDefaultStepScript,
  PLATFORM_STEP_SCRIPTS,
  DEFAULT_STEP_SCRIPTS,
} from '../pipeline/step-scripts';

/**
 * 平台托管脚本同步 + 默认脚本初始化的防回归测试。
 *
 * 两套语义刻意相反（用户 2026-09-15）：
 *  - **托管**（restart / verify）：代码是真相源，启动/提交时同步，内容变化会覆盖，`locked=true` 接口拒写；
 *  - **默认**（git）：只在不存在时写入一次（`locked=false`），此后运维在页面上改，代码**不再覆盖**；
 *    历史被锁过的行要**解锁但保留内容**（不拿代码冲掉运维的改动）。
 */
describe('PlatformScriptSeedService（平台托管同步 + 默认脚本初始化）', () => {
  let repo: {
    rows: any[];
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
  };
  let templates: { rows: Array<{ id: string }>; find: jest.Mock };
  let svc: PlatformScriptSeedService;
  const GIT_DEFAULT = () => getDefaultStepScript('git');
  const TOTAL = () => PLATFORM_STEP_SCRIPTS.length + DEFAULT_STEP_SCRIPTS.length;

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

  it('无记录 → 托管节点建 locked=true，git 建 locked=false 的默认脚本', async () => {
    const wrote = await svc.seedForTemplate('t1');
    expect(wrote).toBe(true);
    expect(repo.rows).toHaveLength(TOTAL());

    for (const item of PLATFORM_STEP_SCRIPTS) {
      expect(repo.rows.find((r) => r.nodeKey === item.nodeKey)).toMatchObject({
        templateId: 't1',
        locked: true,
        enabled: true,
        updatedBy: 'system',
      });
    }
    // git 是默认脚本（可编辑），不是托管
    const git = repo.rows.find((r) => r.nodeKey === 'git');
    expect(git).toMatchObject({ templateId: 't1', locked: false, enabled: true });
    expect(git.command).toBe(GIT_DEFAULT());
  });

  /**
   * restart / verify 只做「委托」，实现留在仓库 scripts/pipeline/ 下随业务代码走。
   */
  it('restart / verify 托管，正文委托到仓库内的版本化脚本', async () => {
    await svc.seedForTemplate('t1');
    for (const nodeKey of ['restart', 'verify']) {
      const row = repo.rows.find((r) => r.nodeKey === nodeKey);
      expect(row).toBeTruthy();
      expect(row.locked).toBe(true);
      expect(row.command).toBe(getPlatformStepScript(nodeKey));
      expect(row.command).toContain('scripts/pipeline/');
      expect(row.command).toContain('exec bash');
    }
  });

  it('git 已存在且已解锁 → **不覆盖**（运维改过的脚本永不被冲掉）', async () => {
    await svc.seedForTemplate('t1');
    const git = repo.rows.find((r) => r.nodeKey === 'git');
    git.command = '# 运维自己改过的拉码脚本';

    await svc.seedForTemplate('t1');
    expect(repo.rows.find((r) => r.nodeKey === 'git').command).toBe('# 运维自己改过的拉码脚本');
  });

  it('git 存量 locked=true 行 → 解锁并**保留现内容**（把 git 交还运维）', async () => {
    repo.rows.push({
      templateId: 't1',
      nodeKey: 'git',
      command: '#!/usr/bin/env bash\n# 老的平台托管脚本',
      locked: true,
      enabled: true,
    });

    const wrote = await svc.seedForTemplate('t1');
    expect(wrote).toBe(true);
    const git = repo.rows.find((r) => r.nodeKey === 'git');
    expect(git.locked).toBe(false);
    expect(git.command).toBe('#!/usr/bin/env bash\n# 老的平台托管脚本');
  });

  it('全部一致 → 不写库（幂等，避免每次启动都 UPDATE）', async () => {
    await svc.seedForTemplate('t1');
    const saveCalls = repo.save.mock.calls.length;

    const wrote = await svc.seedForTemplate('t1');
    expect(wrote).toBe(false);
    expect(repo.save.mock.calls.length).toBe(saveCalls);
  });

  it('托管脚本内容变化 → 覆盖（restart/verify 仍是代码说了算）', async () => {
    await svc.seedForTemplate('t1');
    const restart = repo.rows.find((r) => r.nodeKey === 'restart');
    restart.command = '# 被人改坏了';

    const wrote = await svc.seedForTemplate('t1');
    expect(wrote).toBe(true);
    expect(repo.rows.find((r) => r.nodeKey === 'restart').command).toBe(
      getPlatformStepScript('restart'),
    );
    expect(repo.rows.find((r) => r.nodeKey === 'restart').locked).toBe(true);
  });

  it('存量托管行（locked=false）→ 补上锁定位与正文', async () => {
    repo.rows.push({ templateId: 't1', nodeKey: 'verify', command: '旧脚本', locked: false, enabled: false });

    const wrote = await svc.seedForTemplate('t1');
    expect(wrote).toBe(true);
    expect(repo.rows.find((r) => r.nodeKey === 'verify')).toMatchObject({
      locked: true,
      enabled: true,
      command: getPlatformStepScript('verify'),
    });
  });

  it('seedAll 遍历全部模板（新模板不会漏）', async () => {
    const changed = await svc.seedAll();
    expect(changed).toBe(2);
    expect([...new Set(repo.rows.map((r) => r.templateId))].sort()).toEqual(['t1', 't2']);
    expect(repo.rows).toHaveLength(2 * TOTAL());
  });
});
