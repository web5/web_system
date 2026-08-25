/**
 * coding 工具共享辅助：忽略目录、路径安全、schema 构造。
 */
import * as path from 'path';
import { ToolSchema } from '../../interfaces/tool.interface';

/** 默认忽略目录（避免扫描 node_modules/.git 等） */
const IGNORED_DIRS = ['node_modules', '.git', '.svn', 'dist', '.next', 'build', '.cache'];

export function isIgnoredDir(name: string): boolean {
  return IGNORED_DIRS.includes(name);
}

/** 解析相对当前目录的绝对路径；越界返回 null */
export function resolveWithinCwd(cwd: string, target: string): string | null {
  const resolved = path.resolve(cwd, target);
  if (resolved !== cwd && !resolved.startsWith(cwd + path.sep)) {
    return null; // 越界
  }
  return resolved;
}

export function makeToolSchema(
  name: string,
  description: string,
  params: Array<{ name: string; type: 'string' | 'number' | 'boolean'; description: string; required: boolean }>,
): ToolSchema {
  const properties: Record<string, { type: string; description: string }> = {};
  const required: string[] = [];
  for (const p of params) {
    properties[p.name] = { type: p.type, description: p.description };
    if (p.required) required.push(p.name);
  }
  return {
    type: 'function',
    function: { name, description, parameters: { type: 'object', properties, required } },
  };
}
