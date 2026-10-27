import { Test, TestingModule } from '@nestjs/testing';
import { PullExecutor } from './pull.executor';
import { ReleaseGitService } from '../../git/release-git.service';
import { CommandService } from '../../shell/command.service';
import { StepContext } from './step.types';

/**
 * pull 拉码后的平台收尾（Q2，2026-10-27 拍板：预构建兜底**完全移除**）——必须保证：
 *   1) afterSync 只做依赖同步（pnpm-lock 指纹变化才 install）；
 *   2) **不再调** `scripts/prebuild-workspace-deps.mjs`、**不再输出**预构建相关日志
 *      （预构建已是画布上的普通脚本节点 key=prebuild，需要的流水线自行添加）；
 *   3) 依赖安装失败不阻断流水线，仅醒目 warn。
 * ⚠️ 防回退：也不许恢复旧 PREBUILD_SHARED_PACKAGES 硬编码清单（2026-10-26 #270 根因）。
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

  it('拉取代码后不再调预构建脚本、不再输出预构建日志（Q2 兜底完全移除）', async () => {
    const { ctx, logs } = makeCtx();
    await executor.run(ctx);

    expect(git.syncToBranch).toHaveBeenCalledWith('master', 'prev');
    expect(git.syncDependencies).toHaveBeenCalled();
    // 不再出现 prebuild-workspace-deps.mjs 调用（预构建改普通脚本节点，平台不代跑）
    expect(cmd.exec).not.toHaveBeenCalledWith(
      expect.stringContaining('prebuild-workspace-deps.mjs'),
      expect.anything(),
    );
    expect(cmd.exec).not.toHaveBeenCalled();
    // 不再出现预构建相关日志（含「兜底」「workspace 预构建」字样）
    expect(logs.some((l) => l.includes('预构建'))).toBe(false);
    expect(logs.some((l) => l.includes('prebuild'))).toBe(false);
  });

  it('afterSync 可独立调用：git 阶段由 DB 锁定脚本执行时，只收尾依赖同步、不碰预构建', async () => {
    const { ctx, logs } = makeCtx();
    await executor.afterSync(ctx);
    expect(git.syncDependencies).toHaveBeenCalled();
    expect(cmd.exec).not.toHaveBeenCalledWith(
      expect.stringContaining('prebuild-workspace-deps.mjs'),
      expect.anything(),
    );
    expect(cmd.exec).not.toHaveBeenCalled();
    expect(logs.some((l) => l.includes('预构建'))).toBe(false);
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

  it('pnpm install 失败也不阻断：仅记 warn，且不再继续预构建', async () => {
    git.syncDependencies.mockImplementation(() => {
      throw new Error('pnpm install EAGAIN');
    });
    const { ctx, logs } = makeCtx();
    await expect(executor.run(ctx)).resolves.toBeUndefined();
    expect(logs.some((l) => l.includes('[warn] 依赖同步失败'))).toBe(true);
    // 预构建已移除：install 失败后不再有任何预构建调用/日志
    expect(cmd.exec).not.toHaveBeenCalled();
    expect(logs.some((l) => l.includes('预构建'))).toBe(false);
  });
});
