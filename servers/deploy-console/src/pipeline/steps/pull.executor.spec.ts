import { Test, TestingModule } from '@nestjs/testing';
import { PullExecutor } from './pull.executor';
import { ReleaseGitService } from '../../git/release-git.service';
import { CommandService } from '../../shell/command.service';
import { StepContext } from './step.types';

/**
 * 共享 workspace 包预构建是 admin/portal 并发改造的关键——必须保证：
 *   1) install 完成后一定执行（不静默跳过）
 *   2) 任意一次失败不阻断流水线（个别包损坏还有模块本体重建兜底）
 *   3) 日志写入 ctx.log（运维能从流水线日志看到共享构建走没走）
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

  it('拉取代码后立即预构建共享包 @web-system/shared 与 @web-system/types', async () => {
    const { ctx, logs } = makeCtx();
    await executor.run(ctx);

    // 两次 pnpm --filter ... build 调用都到位
    expect(cmd.exec).toHaveBeenCalledWith(
      expect.stringContaining('--filter @web-system/shared build'),
      '/tmp/ws',
    );
    expect(cmd.exec).toHaveBeenCalledWith(
      expect.stringContaining('--filter @web-system/types build'),
      '/tmp/ws',
    );

    // 流水线日志里能看到「预构建共享包」字样
    expect(logs.some((l) => l.includes('预构建共享包'))).toBe(true);
    expect(logs.some((l) => l.includes('@web-system/shared'))).toBe(true);
    expect(logs.some((l) => l.includes('@web-system/types'))).toBe(true);
  });

  it('任一共享包预构建失败不阻断（继续后续操作）', async () => {
    cmd.exec.mockImplementation((c: string) => {
      if (c.includes('@web-system/shared')) throw new Error('tsc 编译失败');
      return '';
    });
    const { ctx, logs } = makeCtx();
    await expect(executor.run(ctx)).resolves.toBeUndefined();

    // 第二次（types）仍然执行，pipeline 不中断
    expect(cmd.exec).toHaveBeenCalledWith(
      expect.stringContaining('--filter @web-system/types build'),
      '/tmp/ws',
    );
    expect(logs.some((l) => l.includes('[warn] 共享包 @web-system/shared 预构建失败'))).toBe(true);
  });

  it('commit 信息自动从 git 同步结果回填', async () => {
    git.syncToBranch.mockReturnValue('deadbeef');
    const { ctx } = makeCtx();
    await executor.run(ctx);
    expect((ctx.pipeline as any).gitCommit).toBe('deadbeef');
    expect((ctx.pipeline as any).versionTag).toBe('deadbeef');
  });

  it('pnpm install 失败也不阻断：仅记 warn，仍继续共享预构建', async () => {
    git.syncDependencies.mockImplementation(() => {
      throw new Error('pnpm install EAGAIN');
    });
    const { ctx, logs } = makeCtx();
    await expect(executor.run(ctx)).resolves.toBeUndefined();
    expect(logs.some((l) => l.includes('[warn] 依赖同步失败'))).toBe(true);
    // 共享预构建仍在 install 失败后跑（去掉 install 依赖：曾被锁住的旧实现）
    expect(cmd.exec).toHaveBeenCalledWith(
      expect.stringContaining('--filter @web-system/shared build'),
      '/tmp/ws',
    );
  });
});
