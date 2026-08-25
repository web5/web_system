/**
 * grep-search 工具：在目录内正则搜索文本（只读，忽略 node_modules/.git 等）。
 */
import * as fs from 'fs';
import * as path from 'path';
import { ToolDefinition, ToolContext, ToolResult, ToolSchema, ToolParameter } from '../../interfaces/tool.interface';
import { resolveWithinCwd, isIgnoredDir } from './helpers';

const MAX_MATCHES = 30;

export class GrepSearchTool implements ToolDefinition {
  readonly name = 'grep-search';
  readonly description = '在指定目录内按正则搜索文件内容，返回匹配行（只读，上限 30 条）。';
  readonly parameters: Record<string, ToolParameter> = {
    pattern: { type: 'string', description: '正则表达式', required: true },
    path: { type: 'string', description: '目录（相对当前工作目录，默认 .）', required: false },
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
            pattern: { type: 'string', description: '正则表达式' },
            path: { type: 'string', description: '目录' },
          },
          required: ['pattern'],
        },
      },
    };
  }

  async execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
    const cwd = process.cwd();
    const root = resolveWithinCwd(cwd, String(args.path ?? '.'));
    if (!root) return { success: false, content: '', error: '路径越界：仅允许访问当前工作目录内' };

    let regex: RegExp;
    try {
      regex = new RegExp(String(args.pattern ?? ''), 'i');
    } catch (error) {
      return { success: false, content: '', error: `正则无效: ${(error as Error).message}` };
    }

    const matches: string[] = [];
    const walk = (dir: string): void => {
      if (matches.length >= MAX_MATCHES) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (matches.length >= MAX_MATCHES) return;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (!isIgnoredDir(e.name)) walk(full);
        } else if (e.isFile()) {
          try {
            const content = fs.readFileSync(full, 'utf-8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length && matches.length < MAX_MATCHES; i++) {
              if (regex.test(lines[i])) {
                const rel = path.relative(cwd, full);
                matches.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
              }
            }
          } catch {
            // 二进制/不可读文件跳过
          }
        }
      }
    };

    walk(root);
    if (matches.length === 0) {
      return { success: true, content: `未找到匹配 "${args.pattern}" 的内容。` };
    }
    return { success: true, content: matches.join('\n') };
  }
}
