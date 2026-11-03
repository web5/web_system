import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { DeployPipelineEntity } from '../../entities/deploy-pipeline.entity';
import { SshExecService } from '../../remote/ssh-exec.service';
import { runtimeGcProgram } from '../../deploy/runtime-gc';
import {
  GC_PROGRAM_FILE,
  RUNTIME_PROGRAM_BIN_DIR,
  syncRuntimeProgramCommand,
  syncRuntimeProgramLocal,
} from './sync-runtime.executor';
import { StepContext } from './step.types';

/** 每个 `<module>/<env>` 保留的版本目录份数（console 侧环境变量可覆盖） */
export function gcKeep(): number {
  const raw = Number(process.env.DEPLOY_GC_KEEP || 3);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 3;
}

/**
 * gc 节点作用域：**只收本次发布的模块**。
 *
 * 默认取 `pipeline.moduleKey`（本次发布涉及的模块）—— 这就是「自己的模块」。
 * 为什么必须带作用域：并发发布时全根扫描会碰到别的模块；pm2 引用保护只覆盖
 * 已注册进程，`runtime-checkpoint` 之类目录不在保护集内，误删会毁掉别的模块历史版本。
 *
 * ⚠️ 不按 `pipeline.env`（dev/prod）收窄：磁盘上的环境目录名（如 `todo-service-dev`）
 * 不等于流水线环境值，硬拼会匹配不到目录 → 静默啥也不删。模块级作用域已严格保证
 * 「不触碰其它任何模块」。
 *
 * 取不到合法 moduleKey 一律返回 null —— 调用方必须拒绝执行，绝不退化成全根扫描。
 */
export interface GcScope {
  module: string;
}

export function gcScopeFromPipeline(p: DeployPipelineEntity): GcScope | null {
  const module = (p.moduleKey ?? '').trim();
  if (!module || module === '.' || module === '..' || !/^[A-Za-z0-9_.-]+$/.test(module)) {
    return null;
  }
  return { module };
}

/**
 * 生成「在目标机执行回收」的远端命令（纯函数，便于单测）。
 *
 * 只写**调用**，不写实现 —— 与 apply-runtime 同一口径：
 * 程序本体由本步骤先投放（幂等），脚本/命令里出现的只有一行 `node <path>`。
 *
 * 前置校验：程序文件不存在即 `exit 1`（不静默成功）。
 * 作用域：`GC_SCOPE_MODULE` 必带，缺了程序内会拒绝并非零退出（不静默全根扫描）。
 * 「回收跑没跑」必须能从日志回答，这是 2026-11-01 连续四个假绿换来的判据。
 */
export function gcRuntimeCommand(keep: number, scope: GcScope, dryRun = false): string {
  const file = `$HOME/${RUNTIME_PROGRAM_BIN_DIR}/${GC_PROGRAM_FILE}`;
  return [
    'set -eu',
    `test -f "${file}" || { echo "[error] 目标机缺少回收程序（gc-runtime 步骤未投放成功）" >&2; exit 1; }`,
    `GC_KEEP=${keep} GC_SCOPE_MODULE='${scope.module}'${dryRun ? ' GC_DRY_RUN=1' : ''} node "${file}"`,
  ].join('\n');
}

/** 本机（console 所在机）执行回收：local 环境用，不经 ssh */
export function runGcLocal(
  home: string,
  keep: number,
  scope: GcScope,
  dryRun = false,
): Promise<string> {
  const file = join(home, RUNTIME_PROGRAM_BIN_DIR, GC_PROGRAM_FILE);
  return new Promise<string>((resolve, reject) => {
    execFile(
      'node',
      [file],
      {
        env: {
          ...process.env,
          GC_KEEP: String(keep),
          GC_SCOPE_MODULE: scope.module,
          ...(dryRun ? { GC_DRY_RUN: '1' } : {}),
        },
        timeout: 10 * 60 * 1000,
        maxBuffer: 32 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) return reject(new Error(`本机回收失败: ${error.message}\n${stderr || ''}`));
        resolve(String(stdout || '').trim());
      },
    );
  });
}

/**
 * `gc-runtime` 内置步骤执行体：**投放回收程序 + 带作用域执行回收**。
 *
 * 为什么要做成内置步骤而不是编排脚本里的 shell：
 * 回收的保护集判据（pm2 引用 / 软链目标 / 保留份数）是**平台知识**，
 * 抄进每条编排就等于把它冻结成 15 份化石（正是 heredoc 清零要消灭的东西）。
 * 编排只能决定「要不要这个节点」，不能改写它怎么做。
 *
 * 作用域（A6，2026-11-03）：本节点 = 流水线 gc 节点，**只收本次发布的模块**
 * （默认 `moduleKey`）。缺作用域时**拒绝执行并报错**，绝不退化成全根扫描。
 * 全量运维回收（`gc_runtimes.py`）是独立运维动作，不经过本节点、不在本节点调用 ——
 * 两层职责在代码里不耦合（见 `runtime-gc.ts` 头注释）。
 *
 * ⚠️ 影响面：只删除**目标模块下、确认无人引用**的历史版本目录。
 *    不动 dist 软链、不重启进程、不触碰其它任何模块。
 * ⚠️ 失败即失败：程序非零退出会让本节点 failed（不静默记成功）。
 */
@Injectable()
export class GcRuntimeExecutor {
  constructor(private readonly ssh: SshExecService) {}

  async run(ctx: StepContext): Promise<void> {
    const p = ctx.pipeline;
    const scope = gcScopeFromPipeline(p);
    if (!scope) {
      const reason =
        `gc-runtime 拒绝执行：未拿到作用域（moduleKey=${String(p.moduleKey ?? '')}）。` +
        '流水线 gc 节点必须带本模块作用域，禁止全根扫描（并发发布会误删别的模块历史版本；' +
        'runtime-checkpoint 之类目录不在 pm2 保护集内）；全量回收请用独立运维动作 gc_runtimes.py。';
      ctx.log(reason);
      throw new Error(reason);
    }
    const program = runtimeGcProgram();
    const sha256 = createHash('sha256').update(program).digest('hex');
    const keep = gcKeep();
    await ctx.enterStage(
      `回收历史版本目录（作用域 ${scope.module}，程序 ${sha256.slice(0, 12)}，保留 ${keep} 份）`,
    );

    const local = syncRuntimeProgramLocal(program, sha256, homedir(), GC_PROGRAM_FILE);
    ctx.log(`本机回收程序：${local}（${RUNTIME_PROGRAM_BIN_DIR}/${GC_PROGRAM_FILE}）`);

    if (p.env === 'local') {
      const out = await runGcLocal(homedir(), keep, scope);
      ctx.log(out || '本机回收完成（无输出）');
      await ctx.save();
      return;
    }
    const synced = (
      await this.ssh.run(p.env, gcSyncCommand(program, sha256), 'sync-gc-program')
    ).trim();
    ctx.log(`目标机回收程序：${synced || '已同步'}`);
    const out = (
      await this.ssh.run(p.env, gcRuntimeCommand(keep, scope), 'gc-runtime')
    ).trim();
    ctx.log(out || `目标机回收完成（无输出）`);
    await ctx.save();
  }
}

/** 目标机侧的程序投放命令（供复用/单测；执行体内部已调用 syncRuntimeProgramLocal 覆盖本机） */
export function gcSyncCommand(program: string, sha256: string): string {
  return syncRuntimeProgramCommand(program, sha256, GC_PROGRAM_FILE);
}
