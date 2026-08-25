/**
 * read-file 工具：读取文本文件（上限 64KB，只读）。
 */
import * as fs from 'fs';
import * as path from 'path';
import { ToolDefinition, ToolContext, ToolResult, ToolSchema, ToolParameter } from '../../interfaces/tool.interface';
import { resolveWithinCwd } from './helpers';

const MAX_BYTES = 64 * 1024;

export class ReadFileTool implements ToolDefinition {
  readonly name = 'read-file';
  readonly description = '读取文本文件内容（只读，单文件上限 64KB）。';
  readonly parameters: Record<string, ToolParameter> = {
    path: { type: 'string', description: '文件路径（相对当前工作目录）', required: true },
  };

  toSchema(): ToolSchema {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: {
          type: 'object',
          properties: { path: { type: 'string', description: '文件路径' } },
          required: ['path'],
        },
      },
    };
  }

  async execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
    const cwd = process.cwd();
    const target = resolveWithinCwd(cwd, String(args.path ?? ''));
    if (!target) return { success: false, content: '', error: '路径越界：仅允许访问当前工作目录内' };

    try {
      const stat = fs.statSync(target);
      if (stat.isDirectory()) return { success: false, content: '', error: '目标是目录，请用 list-dir' };
      if (stat.size > MAX_BYTES) {
        return { success: false, content: '', error: `文件过大（${stat.size} 字节 > 64KB），请缩小范围` };
      }
      const content = fs.readFileSync(target, 'utf-8');
      return { success: true, content };
    } catch (error) {
      return { success: false, content: '', error: (error as Error).message };
    }
  }
}
