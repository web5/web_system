import { SyncRuntimeExecutor, syncRuntimeProgramCommand, RUNTIME_PROGRAM_FILE } from './sync-runtime.executor';
import { backendRuntimeProgram } from '../../deploy/backend-runtime';
import { SshExecService } from '../../remote/ssh-exec.service';
import { StepContext } from './step.types';

const buildCtx = (env: string) => {
  const lines: string[] = [];
  return {
    pipeline: { env, id: 'run-1', moduleKey: 'user-service' },
    lines,
    enterStage: jest.fn(async (m: string) => lines.push('stage:' + m)),
    log: (l: string) => lines.push(l),
    save: jest.fn(async () => undefined),
    sleep: jest.fn(async () => undefined),
    assertNotCancelled: jest.fn(),
    uploadTarget: 'remote' as const,
  };
};

describe('syncRuntimeProgramCommand', () => {
  const program = backendRuntimeProgram();
  const sha = 'a'.repeat(64);
  const cmd = syncRuntimeProgramCommand(program, sha);

  it('把程序以 base64 载荷下发，命令里不出现原始源码', () => {
    expect(cmd).toContain(Buffer.from(program, 'utf8').toString('base64'));
    expect(cmd).not.toContain('function executeBackendRuntime');
  });

  it('写入目标机固定路径 bin/apply-runtime.js', () => {
    expect(cmd).toContain('web_system_runtimes/bin');
    expect(cmd).toContain(RUNTIME_PROGRAM_FILE);
  });

  it('sha256 一致时走幂等短路，不重复写入', () => {
    expect(cmd).toContain('unchanged');
    expect(cmd).toContain(`${RUNTIME_PROGRAM_FILE}.sha256`);
    // 必须是「先比对印记再短路」，不是无条件 exit 0（否则每次都跳过 = 能力永不更新）
    expect(cmd).toContain('cat "');
    expect(cmd).toContain('= "' + sha + '"');
  });

  it('校验失败要删临时文件并非零退出（不静默成功）', () => {
    expect(cmd).toContain('sha256 校验失败');
    expect(cmd).toContain('exit 1');
    expect(cmd).toContain('rm -f');
  });

  it('用 mv 原子替换，避免半截文件被读到', () => {
    expect(cmd).toContain('mv -f');
  });
});

describe('SyncRuntimeExecutor', () => {
  it('远端环境：投放并落日志', async () => {
    const run = jest.fn(async (_env: string, _cmd: string) => 'updated abc');
    const ssh = { run } as unknown as SshExecService;
    const ctx = buildCtx('prod');
    await new SyncRuntimeExecutor(ssh).run(ctx as unknown as StepContext);
    expect(run.mock.calls[0][0]).toBe('prod');
    expect(ctx.lines.join('\n')).toContain('updated abc');
  });

  it('本地环境：不 ssh、不改运行态', async () => {
    const run = jest.fn();
    const ssh = { run } as unknown as SshExecService;
    const ctx = buildCtx('local');
    await new SyncRuntimeExecutor(ssh).run(ctx as unknown as StepContext);
    expect(run).not.toHaveBeenCalled();
    expect(ctx.enterStage).not.toHaveBeenCalled();
    expect(ctx.lines.join('\n')).toContain('本地环境');
  });
});
