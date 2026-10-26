import { Test, TestingModule } from '@nestjs/testing';
import { PullExecutor } from './pull.executor';
import { ReleaseGitService } from '../../git/release-git.service';
import { CommandService } from '../../shell/command.service';
import { StepContext } from './step.types';

/**
 * workspace 包预构建（兜底路径，2026-10-26 改为调统一脚本）——必须保证：
 *   1) install 完成后一定执行（不静默跳过）
 *   2) 失败不阻断流水线（prebuild 步骤是主路径；这里是 nodes/旧模板兜底）
 *   3) 日志写入 ctx.log（运维能从流水线日志看到预构建走没走）
 */
describe('PullExecutor（pull 步骤内置逻辑）', () => {
  let executor: PullExecutor;
  let git: { syncToBranch: jest.Mock; syncDependencies: jest.Mock; workspace: jest.Mock };
  let cmd: { pnpmBin: jest.Mock; exec: jest.Mock };

  beforeEach(async () => {
    git = {
      syncToBranch: jest.fn().mockReturnValue('abc1234'),
      syncDependencies: jest.fn().mockReturnValue('unchanged'),
      workspace: jest.fn().mockReturnValue('/tmp/ws'),
    };
    cmd = {
      pnpmBin: jest.fn().mockReturnValue('pnpm'),
      exec: jest.fn(),
    };
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        PullExecutor,
        { provide: ReleaseGitService, useValue: git },
        { provide: CommandService, useValue: cmd },
      ],
    }).compile();
    executor = moduleRef.get(PullExecutor);
  });

  function makeCtx() {
    const logs: string[] = [];
    const p: any = {
      gitBranch: 'master',
      versionTag: 'prev',
      logs: [],
    };
    const ctx: StepContext = {
      pipeline: p,
      uploadTarget: 'local',
      enterStage: jest.fn(async () => undefined),
      log: (line: string) => logs.push(line),
      save: jest.fn(async () => undefined),
      sleep: jest.fn(async () => undefined),
      assertNotCancelled: jest.fn(() => undefined),
    };
    return { ctx, logs, p };
  }

  it('拉取代码后立即调统一脚本预构建 workspace 依赖（不再硬编码包清单）', async () => {
    const { ctx, logs } = makeCtx();
    await executor.run(ctx);

    // 统一脚本：全量扫 packages，isStale 判定（防再漏 agent-core 这类包）
    expect(cmd.exec).toHaveBeenCalledWith(
      expect.stringContaining('prebuild-workspace-deps.mjs'),
      '/tmp/ws',
    );
    // 不再按包清单逐个 pnpm --filter（硬编码清单是 2026-10-26 故障根因）
    expect(cmd.exec).not.toHaveBeenCalledWith(
      expect.stringContaining('--filter @web-system/shared build'),
    );

    // 流水线日志里能看到预构建字样
    expect(logs.some((l) => l.includes('预构建 workspace 依赖'))).toBe(true);
  });

  it('脚本预构建失败不阻断（主路径是 prebuild 步骤，这里是兜底）', async () => {
    cmd.exec.mockImplementation((c: string) => {
      if (c.includes('prebuild-workspace-deps')) throw new Error('tsc 编译失败');
      return '';
    });
    const { ctx, logs } = makeCtx();
    await expect(executor.run(ctx)).resolves.toBeUndefined();
    expect(logs.some((l) => l.includes('[warn] workspace 预构建失败'))).toBe(true);
  });

  it('只负责拉码：版本身份回填由平台统一做（避免与 DB 脚本路径两套逻辑）', async () => {
    git.syncToBranch.mockReturnValue('deadbeef');
    const { ctx } = makeCtx();
    await executor.run(ctx);
    expect(git.syncToBranch).toHaveBeenCalledWith('master', 'prev');
    // 版本身份是发布语义真相源 → 收口在 PipelineService.resolveGitIdentity
    expect((ctx.pipeline as any).gitCommit).toBeUndefined();
    expect((ctx.pipeline as any).versionTag).toBe('prev');
  });

  it('目标 commit 是完整引用（default/<commit>）时只把末段交给 git', async () => {
    const { ctx } = makeCtx();
    (ctx.pipeline as any).versionTag = 'default/abc1234';
    await executor.run(ctx);
    expect(git.syncToBranch).toHaveBeenCalledWith('master', 'abc1234');
  });

  it('afterSync 可独立调用：git 阶段由 DB 锁定脚本执行时，引擎用它收尾依赖同步与预构建', async () => {
    const { ctx, logs } = makeCtx();
    await executor.afterSync(ctx);
    expect(cmd.exec).toHaveBeenCalledWith(
      expect.stringContaining('prebuild-workspace-deps.mjs'),
      '/tmp/ws',
    );
    expect(logs.some((l) => l.includes('预构建 workspace 依赖'))).toBe(true);
  });

  it('pnpm install 失败也不阻断：仅记 warn，仍继续预构建', async () => {
    git.syncDependencies.mockImplementation(() => {
      throw new Error('pnpm install EAGAIN');
    });
    const { ctx, logs } = makeCtx();
    await expect(executor.run(ctx)).resolves.toBeUndefined();
    expect(logs.some((l) => l.includes('[warn] 依赖同步失败'))).toBe(true);
    // 预构建仍在 install 失败后跑（去掉 install 依赖：曾被锁住的旧实现）
    expect(cmd.exec).toHaveBeenCalledWith(
      expect.stringContaining('prebuild-workspace-deps.mjs'),
      '/tmp/ws',
    );
  });
});
