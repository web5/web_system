import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { SshExecService } from '../../remote/ssh-exec.service';
import { backendRuntimeProgram } from '../../deploy/backend-runtime';
import { StepContext } from './step.types';

/** 目标机上能力程序的存放目录（相对 `$HOME`） */
export const RUNTIME_PROGRAM_BIN_DIR = 'web_system_runtimes/bin';
/** 能力程序文件名 */
export const RUNTIME_PROGRAM_FILE = 'apply-runtime.js';

/**
 * 生成「把能力程序投放到目标机」的远端命令（纯函数，便于单测）。
 *
 * 方案 B（2026-11-01）：**console 只是执行器，流水线动作是数据**。
 * 这里解决的是「脚本怎么调用平台能力」——
 *
 * - 旧写法：把 `backendRuntimeProgram()` 的整份源码用 heredoc 抄进每条编排
 *   → 能力被冻结在抄写的那天（57 份化石脚本，改代码对 prod 无效）。
 * - 新写法：程序落盘到目标机固定路径，**脚本只写一行 `node <path>`**。
 *   改能力 = 发版 console 后重新投放；改编排 = 改库，不发版。
 *
 * 幂等：先比对 `.sha256` 印记，一致则跳过写入（避免每次发布都传一遍 ~30KB）。
 * 完整性：base64 落临时文件 → sha256 校验 → 失败即删临时文件并 `exit 1`（**不静默**）→ `mv` 原子替换。
 */
export function syncRuntimeProgramCommand(program: string, sha256: string): string {
  const encoded = Buffer.from(program, 'utf8').toString('base64');
  const dir = `$HOME/${RUNTIME_PROGRAM_BIN_DIR}`;
  const file = `${dir}/${RUNTIME_PROGRAM_FILE}`;
  const tmp = `${file}.tmp.$$`;
  const stamp = `${file}.sha256`;
  return [
    'set -eu',
    `mkdir -p "${dir}"`,
    // 幂等判据 = **文件本身**的 sha，不是印记文件：印记可能在文件内容损坏后仍然「对得上」，
    // 那样就永远自愈不了（实测：改坏正文后仍判 unchanged）。
    `if [ -f "${file}" ] && [ "$(sha256sum "${file}" | cut -d' ' -f1)" = "${sha256}" ]; then printf 'unchanged'; exit 0; fi`,
    `printf '%s' '${encoded}' | base64 -d > "${tmp}"`,
    `test "$(sha256sum "${tmp}" | cut -d' ' -f1)" = "${sha256}" || { rm -f "${tmp}"; echo "[error] 能力程序 sha256 校验失败，已放弃写入" >&2; exit 1; }`,
    `mv -f "${tmp}" "${file}"`,
    `printf '%s\\n' "${sha256}" > "${stamp}"`,
    `printf 'updated ${sha256}'`,
  ].join('\n');
}

/**
 * 把能力程序落到**本机**（console 所在机器）的固定路径。
 *
 * 为什么本机也要一份：编排脚本里的「产物守卫」要在**构建机上**跑
 * `action=inspect` 检查本地构建产物。此前这段靠第二个 heredoc 内嵌源码完成，
 * 同样是副本；本机有文件后，脚本改写成 `node "$HOME/.../apply-runtime.js"` 即可。
 *
 * 幂等与完整性与远端一致：sha256 印记比对 → 临时文件 → 校验 → 原子改名。
 */
export function syncRuntimeProgramLocal(
  program: string,
  sha256: string,
  home: string,
): 'updated' | 'unchanged' {
  const dir = join(home, RUNTIME_PROGRAM_BIN_DIR);
  const file = join(dir, RUNTIME_PROGRAM_FILE);
  const stamp = file + '.sha256';
  // 判据 = 文件本身（同远端）：印记对得上但正文坏了的情况必须能自愈
  if (existsSync(file)) {
    const current = createHash('sha256').update(readFileSync(file)).digest('hex');
    if (current === sha256) return 'unchanged';
  }
  mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp.${process.pid}`;
  writeFileSync(tmp, program);
  const actual = createHash('sha256').update(readFileSync(tmp)).digest('hex');
  if (actual !== sha256) {
    rmSync(tmp, { force: true });
    throw new Error('本机能力程序 sha256 校验失败，已放弃写入');
  }
  renameSync(tmp, file);
  writeFileSync(stamp, `${sha256}\n`);
  return 'updated';
}

/**
 * sync-runtime 内置步骤执行体：**把运行时能力程序投放到本机与目标机**。
 *
 * 与 `apply`（部署生效）的区别：本步骤**不改变任何运行态**，
 * 只保证执行环境中存在与当前 console 代码同源的能力程序，供编排脚本调用。
 * 因此它是安全的、可重复执行的，也不持发布锁。
 *
 * ⚠️ 影响面：仅写文件（幂等）。不改变 dist、不重启任何进程。
 */
@Injectable()
export class SyncRuntimeExecutor {
  constructor(private readonly ssh: SshExecService) {}

  async run(ctx: StepContext): Promise<void> {
    const p = ctx.pipeline;
    const program = backendRuntimeProgram();
    const sha256 = createHash('sha256').update(program).digest('hex');
    await ctx.enterStage(`同步运行时能力程序（${sha256.slice(0, 12)}）`);
    const local = syncRuntimeProgramLocal(program, sha256, homedir());
    ctx.log(`本机能力程序：${local}（${RUNTIME_PROGRAM_BIN_DIR}/${RUNTIME_PROGRAM_FILE}）`);
    // 本机环境：部署走本机 dist 与平台代码，不涉及远端投放
    if (p.env === 'local') {
      await ctx.save();
      return;
    }
    const out = (
      await this.ssh.run(p.env, syncRuntimeProgramCommand(program, sha256), 'sync-runtime-program')
    ).trim();
    ctx.log(out || `远端能力程序已同步: ${RUNTIME_PROGRAM_BIN_DIR}/${RUNTIME_PROGRAM_FILE}`);
    await ctx.save();
  }
}
