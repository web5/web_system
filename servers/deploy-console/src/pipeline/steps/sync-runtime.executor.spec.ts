import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  SyncRuntimeExecutor,
  syncRuntimeProgramCommand,
  syncRuntimeProgramLocal,
  RUNTIME_PROGRAM_BIN_DIR,
  RUNTIME_PROGRAM_FILE,
} from './sync-runtime.executor';
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

  it('sha256 一致时走幂等短路，且比对的是文件本身', () => {
    expect(cmd).toContain('unchanged');
    expect(cmd).toContain(`${RUNTIME_PROGRAM_FILE}.sha256`);
    // 必须是「先比对文件真实 sha 再短路」：比印记会在正文损坏时永远自愈不了
    expect(cmd).toContain('sha256sum "');
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

describe('syncRuntimeProgramLocal（本机落盘）', () => {
  const program = backendRuntimeProgram();
  const sha = createHash('sha256').update(program).digest('hex');
  const home = mkdtempSync(join(tmpdir(), 'rt-home-'));
  const file = join(home, RUNTIME_PROGRAM_BIN_DIR, RUNTIME_PROGRAM_FILE);

  it('首次写入 = updated，内容与程序一致', () => {
    expect(syncRuntimeProgramLocal(program, sha, home)).toBe('updated');
    expect(readFileSync(file, 'utf8')).toBe(program);
    expect(existsSync(file + '.sha256')).toBe(true);
  });

  it('第二次调用幂等 = unchanged', () => {
    syncRuntimeProgramLocal(program, sha, home);
    expect(syncRuntimeProgramLocal(program, sha, home)).toBe('unchanged');
  });

  it('印记与内容不符时重写（自愈）', () => {
    syncRuntimeProgramLocal(program, sha, home);
    writeFileSync(file, 'tampered');
    expect(syncRuntimeProgramLocal(program, sha, home)).toBe('updated');
    expect(readFileSync(file, 'utf8')).toBe(program);
  });

  it('校验失败要抛错，且不留下半截文件', () => {
    const bad = 'b'.repeat(64);
    expect(() => syncRuntimeProgramLocal(program, bad, home)).toThrow('sha256 校验失败');
    expect(readFileSync(file, 'utf8')).toBe(program);
    expect(existsSync(file + '.tmp.' + process.pid)).toBe(false);
  });
});

describe('SyncRuntimeExecutor', () => {
  it('远端环境：本机 + 目标机各落一份', async () => {
    const run = jest.fn(async (_env: string, _cmd: string) => 'updated abc');
    const ssh = { run } as unknown as SshExecService;
    const ctx = buildCtx('prod');
    await new SyncRuntimeExecutor(ssh).run(ctx as unknown as StepContext);
    expect(run.mock.calls[0][0]).toBe('prod');
    expect(ctx.lines.join('\n')).toContain('updated abc');
    expect(ctx.lines.join('\n')).toContain('本机能力程序');
  });

  it('本地环境：只落本机，不 ssh', async () => {
    const run = jest.fn();
    const ssh = { run } as unknown as SshExecService;
    const ctx = buildCtx('local');
    await new SyncRuntimeExecutor(ssh).run(ctx as unknown as StepContext);
    expect(run).not.toHaveBeenCalled();
    expect(ctx.lines.join('\n')).toContain('本机能力程序');
  });
});
