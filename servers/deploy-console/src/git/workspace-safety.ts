import { BadRequestException, ConflictException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export const CONSOLE_RUNTIME_ROOT = path.resolve(__dirname, '../../../..');
export const BACKEND_RUNTIME_ROOT = path.join(os.homedir(), 'web_system_runtimes');

export function assertRunAfterWorkspaceCutover(startTime: unknown, configuredCutover: unknown): void {
  const raw = String(configuredCutover ?? '').trim();
  if (!raw) return;
  const cutover = Number(raw);
  if (!Number.isSafeInteger(cutover) || cutover <= 0) {
    throw new BadRequestException('RELEASE_WORKSPACE_CUTOVER_MS 必须是正整数毫秒时间戳');
  }
  const started = Number(startTime);
  if (!Number.isSafeInteger(started) || started < cutover) {
    throw new ConflictException('发布单早于构建目录切换或缺少有效时间，保持待审批状态；请在新构建目录重新提交并复核，不自动恢复旧任务');
  }
}

function canonicalPath(value: string): string {
  let existing = path.resolve(value);
  const remaining: string[] = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    remaining.unshift(path.basename(existing));
    existing = parent;
  }
  return path.join(fs.realpathSync(existing), ...remaining);
}

function contains(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export function assertIsolatedBuildWorkspace(workspace: string, runtimeRoots: readonly string[]): void {
  const buildRoot = canonicalPath(workspace);
  for (const root of [...runtimeRoots, BACKEND_RUNTIME_ROOT]) {
    const runtimeRoot = canonicalPath(root);
    if (contains(buildRoot, runtimeRoot) || contains(runtimeRoot, buildRoot)) {
      throw new BadRequestException('构建目录与运行目录重合或互相包含；请将 RELEASE_WORKSPACE 配置为独立构建目录，禁止在运行目录拉码或清理');
    }
  }
}
