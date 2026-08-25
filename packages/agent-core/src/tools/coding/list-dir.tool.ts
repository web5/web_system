/**
 * list-dir 工具：列出目录内容（受 cwd 限制，只读）。
 */
import * as fs from 'fs';
import * as path from 'path';
import { ToolDefinition, ToolContext, ToolResult, ToolSchema, ToolParameter } from '../../interfaces/tool.interface';
import { resolveWithinCwd, isIgnoredDir } from './helpers';

export class ListDirTool implements ToolDefinition {
  readonly name = 'list-dir';
  readonly description = '列出指定目录下的文件和子目录（只读，忽略 node_modules/.git 等）。';
  readonly parameters: Record<string, ToolParameter> = {
    path: { type: 'string', description: '目录路径（相对当前工作目录）', required: true },
  };

  toSchema(): ToolSchema {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: {
          type: 'object',
          properties: { path: { type: 'string', description: '目录路径' } },
          required: ['path'],
        },
      },
    };
  }

  async execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
    const cwd = process.cwd();
    const target = resolveWithinCwd(cwd, String(args.path ?? '.'));
    if (!target) return { success: false, content: '', error: '路径越界：仅允许访问当前工作目录内' };

    try {
      const entries = fs.readdirSync(target, { withFileTypes: true });
      const lines = entries
        .filter((e) => !e.isDirectory() || !isIgnoredDir(e.name))
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
      return { success: true, content: lines.length ? lines.join('\n') : '(空目录)' };
    } catch (error) {
      return { success: false, content: '', error: (error as Error).message };
    }
  }
}
