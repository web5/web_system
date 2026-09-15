import { Injectable } from '@nestjs/common';
import { spawn } from 'child_process';
import { CommandService, buildChildEnv } from './command.service';
import { killShellProcess } from './shell-process';

/**
 * 可注入的 shell 执行通道（P0 流水线节点模型的技术前提）。
 *
 * 背景：`runShell` 原先内联在 `PipelineService` 里直接 `spawn('bash', …)`，
 * 全仓没有任何 mock 手段 ⇒ `run` / `executeStage` / 节点执行**零测试**，
 * approval 节点的「挂起 → 批准后从该节点继续」无法在单测里验证。
 *
 * 抽成接口后：生产注入 `SpawnShellRunner`（行为与原实现一致：detached 进程组、
 * 超时整组终止、流式日志），测试注入假实现返回预设 exit code 与输出。
 */

/** 执行句柄：取消 / 超时时终止进程（对上层隐藏 ChildProcess） */
export interface ShellRunHandle {
  kill(): void;
}

export interface ShellRunRequest {
  /** 脚本文体（bash -c 执行） */
  command: string;
  /** 工作目录（缺省回落到调用方给定的发布目录） */
  cwd: string;
  /** 注入进程的环境变量（内部再补全 PATH / node bin） */
  env: Record<string, string>;
  /** 超时秒数；<=0 或缺失用 defaultTimeoutSec（再缺省 BUILD_TIMEOUT_MS） */
  timeoutSec?: number;
  /** 全局默认超时（毫秒） */
  defaultTimeoutMs?: number;
  /** 流式日志（stdout 逐行；stderr 带 `[stderr] ` 前缀） */
  onLog?: (line: string) => void;
  /** 子进程已启动（供调用方登记，便于外部取消） */
  onStart?: (handle: ShellRunHandle) => void;
  /** node bin 目录（PATH 补齐用） */
  nodeBinDir?: string;
}

export interface ShellRunner {
  /** 执行命令，resolve 退出码（非 0 由调用方按 continueOnError 决定是否中断） */
  run(req: ShellRunRequest): Promise<number>;
}

/** 默认构建超时（毫秒）—— 与引擎历史值一致 */
export const DEFAULT_SHELL_TIMEOUT_MS = 10 * 60 * 1000;

/** DI token（测试用 useValue 注入假实现） */
export const SHELL_RUNNER = 'SHELL_RUNNER';

@Injectable()
export class SpawnShellRunner implements ShellRunner {
  constructor(private readonly commandService: CommandService) {}

  run(req: ShellRunRequest): Promise<number> {
    const timeoutMs =
      req.timeoutSec && req.timeoutSec > 0
        ? req.timeoutSec * 1000
        : (req.defaultTimeoutMs ?? DEFAULT_SHELL_TIMEOUT_MS);
    const nodeBinDir = req.nodeBinDir ?? this.commandService.nodeBinDir();
    const stage = req.env.STAGE ?? 'shell';

    return new Promise<number>((resolve) => {
      const child = spawn('bash', ['-c', req.command], {
        // 未显式传 cwd 时由调用方兜底；这里保证不落到 deploy-console 自身目录
        cwd: req.cwd,
        // PATH 补齐与 CommandService 同一实现（node 目录 / /usr/local/bin 等）
        env: buildChildEnv(req.env, nodeBinDir),
        // 独立进程组：终止时可按负 pid 整组 kill，避免 vite / nest build 等孙进程残留
        // 继续占用端口与 CPU（历史「6200 孤儿进程抢端口、发布不生效」的同类根因）
        detached: true,
      });

      req.onStart?.({
        kill: () =>
          killShellProcess(
            child.pid ?? 0,
            (pid, signal) => process.kill(pid, signal),
            (signal) => child.kill(signal),
          ),
      });

      const timer = setTimeout(() => {
        req.onLog?.(`[${stage}] 执行超时（${Math.round(timeoutMs / 1000)}s），终止进程组`);
        killShellProcess(
          child.pid ?? 0,
          (pid, signal) => process.kill(pid, signal),
          (signal) => child.kill(signal),
        );
      }, timeoutMs);

      let settled = false;
      const finalize = (code: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(code ?? 1);
      };

      const push = (raw: string, prefix = '') => {
        for (const line of String(raw).split('\n').filter(Boolean)) {
          req.onLog?.(`${prefix}${line}`);
        }
      };
      child.stdout.on('data', (d: Buffer) => push(String(d)));
      child.stderr.on('data', (d: Buffer) => push(String(d), '[stderr] '));
      child.on('close', (code: number | null) => finalize(code ?? 1));
      // 兜底：detached 进程组里若有孙进程仍持有 stdio，'close' 可能迟迟不触发。
      // bash 自身退出 1s 后按 exit code 收口，避免流水线白白卡到超时才结束。
      child.on('exit', (code: number | null) => {
        setTimeout(() => finalize(code ?? 1), 1000);
      });
      child.on('error', (err: Error) => {
        req.onLog?.(`[${stage}] 命令启动失败: ${err.message}`);
        finalize(1);
      });
    });
  }
}
