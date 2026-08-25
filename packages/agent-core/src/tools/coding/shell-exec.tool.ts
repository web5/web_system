/**
 * shell-exec 工具：受限执行 shell 命令。
 *
 * 安全设计：
 * - 仅允许白名单命令（git/node/npm/pnpm/tsc/cat/ls/grep/echo/pwd/head/tail/wc/diff 等）
 * - 删除/覆盖写等危险命令 → 调用 ctx.confirm() 弹确认框，用户确认后才执行；未注入则默认拒绝
 * - 用 execFile（不经 shell），避免注入；设超时与输出上限
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ToolDefinition, ToolContext, ToolResult, ToolSchema, ToolParameter } from '../../interfaces/tool.interface';

const execFileAsync = promisify(execFile);

/** 普通白名单命令（无需确认的只读/开发命令） */
const ALLOWED_COMMANDS = new Set([
  'git', 'node', 'npm', 'pnpm', 'npx', 'yarn', 'tsc', 'tsx', 'deno', 'bun',
  'cat', 'ls', 'grep', 'echo', 'pwd', 'head', 'tail', 'wc', 'diff', 'find', 'rg',
]);

/** 危险但允许的命令：需弹权限确认（confirm=true）才执行 */
const REQUIRE_CONFIRM_COMMANDS = new Set(['rm', 'mv', 'rmdir', 'chmod', 'chown', 'mkdir']);

/** 完全禁止的命令（即使 confirm 也拒绝） */
const FORBIDDEN_COMMANDS = new Set(['sudo', 'dd', 'shutdown', 'reboot', 'kill', 'pkill']);

/** 覆盖写重定向（危险） */
const REDIRECT_PATTERN = />>?/;

const MAX_OUTPUT = 8000;
const DEFAULT_TIMEOUT = 30_000;

export class ShellExecTool implements ToolDefinition {
  readonly name = 'shell-exec';
  readonly description =
    '在受限制的环境中执行 shell 命令。仅允许开发/只读类命令（git/node/npm/pnpm/tsc/cat/ls/grep 等）。删除、覆盖写、sudo 等危险操作需要用户确认。';
  readonly parameters: Record<string, ToolParameter> = {
    command: { type: 'string', description: '要执行的命令（如 git status）', required: true },
  };

  toSchema(): ToolSchema {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: {
          type: 'object',
          properties: { command: { type: 'string', description: '要执行的命令' } },
          required: ['command'],
        },
      },
    };
  }

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const raw = String(args.command ?? '').trim();
    if (!raw) return { success: false, content: '', error: 'command 不能为空' };

    // 拆分命令与参数（简单按空格；引号参数在此工具内不深度解析，足够安全校验）
    const parts = raw.split(/\s+/).filter(Boolean);
    const cmd = parts[0];

    // 1. 完全禁止的命令（sudo/dd 等，即使 confirm 也拒绝）
    if (FORBIDDEN_COMMANDS.has(cmd)) {
      return {
        success: false,
        content: '',
        error: `命令 "${cmd}" 被完全禁用，出于安全考虑不允许执行。`,
      };
    }

    // 2. 是否危险操作（需确认的命令 或 覆盖写重定向）
    const isDangerous = REQUIRE_CONFIRM_COMMANDS.has(cmd) || REDIRECT_PATTERN.test(raw);

    // 3. 命令必须属于 普通白名单 或 需确认名单
    if (!ALLOWED_COMMANDS.has(cmd) && !REQUIRE_CONFIRM_COMMANDS.has(cmd)) {
      return {
        success: false,
        content: '',
        error: `命令 "${cmd}" 不在允许范围内。允许: ${Array.from(ALLOWED_COMMANDS).join(', ')}, ${Array.from(REQUIRE_CONFIRM_COMMANDS).join(', ')}（需确认）`,
      };
    }

    // 4. 危险操作 → 弹权限确认（无确认器默认拒绝）
    if (isDangerous) {
      if (!ctx.confirm) {
        return {
          success: false,
          content: '',
          error: `命令 "${raw}" 包含危险操作（删除/覆盖写/权限提升），且当前处于非交互环境，已拒绝执行。`,
        };
      }
      const ok = await ctx.confirm(`⚠️ 即将执行危险命令：${raw}\n确认继续? [y/N] `);
      if (ok !== true) {
        return { success: false, content: '', error: '危险命令已被用户拒绝执行。' };
      }
    }

    try {
      const { stdout, stderr } = await execFileAsync(cmd, parts.slice(1), {
        cwd: process.cwd(),
        timeout: DEFAULT_TIMEOUT,
        maxBuffer: MAX_OUTPUT * 2,
      });
      const out = stdout || stderr;
      const content = out.slice(0, MAX_OUTPUT) || '(无输出)';
      return { success: true, content };
    } catch (error: any) {
      const msg = error?.stderr || error?.message || '执行失败';
      return { success: false, content: '', error: String(msg).slice(0, MAX_OUTPUT) };
    }
  }
}
