import { PlatformScriptSeedService } from './platform-script-seed.service';
import {
  getDefaultStepScript,
  PLATFORM_STEP_SCRIPTS,
  DEFAULT_STEP_SCRIPTS,
} from '../pipeline/step-scripts';

/**
 * 平台托管脚本同步 + 默认脚本初始化的防回归测试。
 *
 * 两套语义刻意相反（用户 2026-09-15）：
 *  - **托管**（`PLATFORM_STEP_SCRIPTS`）：代码是真相源，启动/提交时同步，内容变化会覆盖，`locked=true` 接口拒写；
 *  - **默认**（`DEFAULT_STEP_SCRIPTS`，git）：只在不存在时写入一次（`locked=false`），此后运维在页面上改，
 *    代码**不再覆盖**；历史被锁过的行要**解锁但保留内容**。
 *
 * 2026-09-21 变更（`specs/pipeline-restart-verify-as-action/design.md`）：
 * restart / verify 已从托管清单移除（下沉为发布流水线里的 DB action），故新增两条护栏 ——
 * 清单必须为空、seed 不再产出 restart/verify 行（防止有人把托管机制加回来时无人察觉）。
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
  /** 当前应写入的节点行数：托管清单 + 默认清单 */
  const TOTAL = () => PLATFORM_STEP_SCRIPTS.length + DEFAULT_STEP_SCRIPTS.length;

  beforeEach(() => {
    repo = {
      rows: [] as any[],
      findOne: jest.fn(async ({ where }: any) =>
        repo.rows.find((r) => r.pipelineId === where.pipelineId && r.nodeKey === where.nodeKey) ?? null,
      ),
      create: jest.fn((o: any) => ({ ...o })),
      save: jest.fn(async (r: any) => {
        const i = repo.rows.findIndex((x) => x.pipelineId === r.pipelineId && x.nodeKey === r.nodeKey);
        if (i >= 0) repo.rows[i] = r;
        else repo.rows.push(r);
        return r;
      }),
      find: jest.fn(async () => templates.rows),
    };
    templates = { rows: [{ id: 't1' }, { id: 't2' }], find: jest.fn(async () => templates.rows) };
    svc = new PlatformScriptSeedService(repo as never, templates as never);
  });

  it('托管清单为空：restart / verify 已下沉为发布流水线里的 DB action', () => {
    expect(PLATFORM_STEP_SCRIPTS).toHaveLength(0);
  });

  it('无记录 → 只建默认脚本（git，locked=false），不再产出 restart/verify 托管行', async () => {
    const wrote = await svc.seedForTemplate('t1');
    expect(wrote).toBe(true);
    expect(repo.rows).toHaveLength(TOTAL());
    expect(repo.rows.map((r) => r.nodeKey)).toEqual(['git']);
    expect(repo.rows.find((r) => r.nodeKey === 'restart')).toBeUndefined();
    expect(repo.rows.find((r) => r.nodeKey === 'verify')).toBeUndefined();

    const git = repo.rows.find((r) => r.nodeKey === 'git');
    expect(git).toMatchObject({ pipelineId: 't1', locked: false, enabled: true });
    expect(git.command).toBe(GIT_DEFAULT());
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
      pipelineId: 't1',
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

  it('restart / verify 存量托管行：平台不再触碰（内容归运维）', async () => {
    repo.rows.push(
      { pipelineId: 't1', nodeKey: 'restart', command: '# 运维自己的重启脚本', locked: true, enabled: true },
      { pipelineId: 't1', nodeKey: 'verify', command: '# 运维自己的探活脚本', locked: true, enabled: true },
    );

    await svc.seedForTemplate('t1');
    const restart = repo.rows.find((r) => r.nodeKey === 'restart');
    const verify = repo.rows.find((r) => r.nodeKey === 'verify');
    expect(restart.command).toBe('# 运维自己的重启脚本');
    expect(verify.command).toBe('# 运维自己的探活脚本');
    // 平台不再"锁定"它们（托管语义已撤），但仍不覆盖内容
    expect(restart.locked).toBe(true);
  });

  it('全部一致 → 不写库（幂等，避免每次启动都 UPDATE）', async () => {
    await svc.seedForTemplate('t1');
    const saveCalls = repo.save.mock.calls.length;

    const wrote = await svc.seedForTemplate('t1');
    expect(wrote).toBe(false);
    expect(repo.save.mock.calls.length).toBe(saveCalls);
  });

  it('seedAll 遍历全部模板（新模板不会漏）', async () => {
    const changed = await svc.seedAll();
    expect(changed).toBe(2);
    expect([...new Set(repo.rows.map((r) => r.pipelineId))].sort()).toEqual(['t1', 't2']);
    expect(repo.rows).toHaveLength(2 * TOTAL());
  });
});
