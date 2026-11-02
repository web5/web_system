import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  GcRuntimeExecutor,
  gcRuntimeCommand,
  gcSyncCommand,
  gcKeep,
} from './gc-runtime.executor';
import { GC_PROGRAM_FILE, RUNTIME_PROGRAM_BIN_DIR } from './sync-runtime.executor';
import { runtimeGcProgram } from '../../deploy/runtime-gc';
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

describe('gcRuntimeCommand', () => {
  it('只写调用：命令里不含程序源码', () => {
    const cmd = gcRuntimeCommand(3);
    expect(cmd).not.toContain('function executeRuntimeGc');
    expect(cmd).not.toContain(Buffer.from(runtimeGcProgram(), 'utf8').toString('base64'));
    expect(cmd).toContain(`$HOME/${RUNTIME_PROGRAM_BIN_DIR}/${GC_PROGRAM_FILE}`);
  });

  it('程序缺失即失败，不静默成功', () => {
    expect(gcRuntimeCommand(2)).toContain('exit 1');
    expect(gcRuntimeCommand(2)).toContain('[error]');
  });

  it('保留份数通过 GC_KEEP 传入（编排可调，不必改代码）', () => {
    expect(gcRuntimeCommand(5)).toContain('GC_KEEP=5');
    expect(gcRuntimeCommand(1, true)).toContain('GC_DRY_RUN=1');
  });
});

describe('gcSyncCommand', () => {
  it('投放到与 apply-runtime 相同的 bin 目录，文件名不同', () => {
    const program = runtimeGcProgram();
    const sha = createHash('sha256').update(program).digest('hex');
    const cmd = gcSyncCommand(program, sha);
    expect(cmd).toContain(RUNTIME_PROGRAM_BIN_DIR);
    expect(cmd).toContain(GC_PROGRAM_FILE);
    expect(cmd).toContain(Buffer.from(program, 'utf8').toString('base64'));
  });
});

describe('GcRuntimeExecutor', () => {
  it('远端环境：先投放程序再执行回收，两次 ssh 都按环境分派', async () => {
    const run = jest.fn(async (_env: string, _cmd: string, label?: string) =>
      label === 'sync-gc-program' ? 'updated abc' : '{"action":"gc","deleted":[]}',
    );
    const ssh = { run } as unknown as SshExecService;
    const ctx = buildCtx('prod');
    await new GcRuntimeExecutor(ssh).run(ctx as unknown as StepContext);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0][0]).toBe('prod');
    expect(run.mock.calls[1][0]).toBe('prod');
    expect(run.mock.calls[0][2]).toBe('sync-gc-program');
    expect(run.mock.calls[1][2]).toBe('gc-runtime');
    expect(ctx.lines.join('\n')).toContain('本机回收程序');
  });

  it('本机也会落一份程序（local 环境）', async () => {
    const run = jest.fn();
    const ssh = { run } as unknown as SshExecService;
    const ctx = buildCtx('local');
    // local 分支会真跑 node；这里只用假 home 校验「先落盘」这一步已被调用
    const home = mkdtempSync(join(tmpdir(), 'gc-home-'));
    await expect(
      new GcRuntimeExecutor(ssh).run({
        ...ctx,
        pipeline: { ...ctx.pipeline, env: 'local' },
      } as unknown as StepContext),
    ).rejects.toThrow(/本机回收失败/); // home 未注入 → 程序不在预期路径，必须报错而非静默成功
    expect(run).not.toHaveBeenCalled();
    expect(existsSync(home)).toBe(true);
  });

  it('远端回收失败（非零退出）要向上抛，节点不能记成成功', async () => {
    const run = jest.fn(async (_env: string, _cmd: string, label?: string) => {
      if (label === 'gc-runtime') throw new Error('remote exit 1: 拒绝回收');
      return 'updated';
    });
    const ssh = { run } as unknown as SshExecService;
    const ctx = buildCtx('prod');
    await expect(new GcRuntimeExecutor(ssh).run(ctx as unknown as StepContext)).rejects.toThrow(
      /拒绝回收/,
    );
  });
});

describe('gcKeep', () => {
  const original = process.env.DEPLOY_GC_KEEP;
  afterEach(() => {
    if (original === undefined) delete process.env.DEPLOY_GC_KEEP;
    else process.env.DEPLOY_GC_KEEP = original;
  });

  it('默认保留 3 份', () => {
    delete process.env.DEPLOY_GC_KEEP;
    expect(gcKeep()).toBe(3);
  });

  it('非法值回落默认，不产生 0 份（0 = 删光所有历史版本）', () => {
    process.env.DEPLOY_GC_KEEP = '0';
    expect(gcKeep()).toBe(3);
    process.env.DEPLOY_GC_KEEP = 'abc';
    expect(gcKeep()).toBe(3);
  });
});
