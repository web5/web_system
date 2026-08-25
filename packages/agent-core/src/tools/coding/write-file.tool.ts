/**
 * write-file 工具：新建 / 覆盖 / 追加写文件。
 *
 * 安全设计：
 * - 所有写操作（新建/覆盖/追加）均需权限确认（调用 ctx.confirm），非交互默认拒绝。
 * - 路径限制在当前工作目录内；内容上限 64KB。
 * - 覆盖 / 追加会对已有文件造成修改，全部走确认，最保守。
 */
import * as fs from 'fs';
import * as path from 'path';
import { ToolDefinition, ToolContext, ToolResult, ToolSchema, ToolParameter } from '../../interfaces/tool.interface';
import { resolveWithinCwd } from './helpers';

const MAX_BYTES = 64 * 1024;

export type WriteMode = 'create' | 'overwrite' | 'append';

export class WriteFileTool implements ToolDefinition {
  readonly name = 'write-file';
  readonly description =
    '写入文件内容。支持模式: create（新建）/ overwrite（覆盖）/ append（追加）。' +
    '所有写操作都会请求用户确认。路径需在当前工作目录内，内容上限 64KB。';
  readonly parameters: Record<string, ToolParameter> = {
    path: { type: 'string', description: '文件路径（相对当前工作目录）', required: true },
    content: { type: 'string', description: '要写入的文本内容', required: true },
    mode: {
      type: 'string',
      description: '写入模式: create 新建（已存在则报错）/ overwrite 覆盖 / append 追加。默认: 文件不存在则 create，存在则 overwrite',
      required: false,
    },
  };

  toSchema(): ToolSchema {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '文件路径' },
            content: { type: 'string', description: '文本内容' },
            mode: { type: 'string', description: 'create/overwrite/append' },
          },
          required: ['path', 'content'],
        },
      },
    };
  }

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const cwd = process.cwd();
    const target = resolveWithinCwd(cwd, String(args.path ?? ''));
    if (!target) return { success: false, content: '', error: '路径越界：仅允许访问当前工作目录内' };

    const content = String(args.content ?? '');
    if (Buffer.byteLength(content, 'utf-8') > MAX_BYTES) {
      return { success: false, content: '', error: `内容过大（>64KB）` };
    }

    const exists = fs.existsSync(target);
    const modeRaw = String(args.mode ?? '').trim();
    let mode: WriteMode;
    if (modeRaw === 'create' || modeRaw === 'overwrite' || modeRaw === 'append') {
      mode = modeRaw;
    } else {
      mode = exists ? 'overwrite' : 'create';
    }

    // 模式与现状校验
    if (mode === 'create' && exists) {
      return { success: false, content: '', error: '文件已存在，如需覆盖请用 mode=overwrite' };
    }

    // 所有写操作均需权限确认（最保守）
    if (!ctx.confirm) {
      return {
        success: false,
        content: '',
        error: `写文件操作（${mode} ${args.path}）需要权限确认，但当前处于非交互环境，已拒绝。`,
      };
    }
    const actionDesc =
      mode === 'create' ? `新建文件 ${args.path}` : mode === 'overwrite' ? `覆盖文件 ${args.path}` : `追加内容到 ${args.path}`;
    const ok = await ctx.confirm(`⚠️ 即将${actionDesc}（${Buffer.byteLength(content, 'utf-8')} 字节）\n确认继续? [y/N] `);
    if (ok !== true) {
      return { success: false, content: '', error: '写文件操作已被用户拒绝。' };
    }

    try {
      // 确保父目录存在
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (mode === 'append') {
        fs.appendFileSync(target, content, 'utf-8');
      } else {
        fs.writeFileSync(target, content, 'utf-8');
      }
      return { success: true, content: `已${mode === 'append' ? '追加到' : '写入'} ${target}` };
    } catch (error) {
      return { success: false, content: '', error: (error as Error).message };
    }
  }
}
