import { BadRequestException } from '@nestjs/common';
import * as path from 'node:path';

export const DEFAULT_RUNTIME_ROOT = '/data/web_system';

export function resolveRuntimeRoot(config: { get<T = string>(key: string): T | undefined }, env?: string): string {
  const scoped = env ? config.get<string>(`WEB_SYSTEM_DIR_${env.toUpperCase()}`)?.trim() : '';
  const root = scoped || config.get<string>('WEB_SYSTEM_DIR')?.trim() || DEFAULT_RUNTIME_ROOT;
  if (!path.posix.isAbsolute(root) || /['"`$;\r\n]/.test(root)) {
    throw new BadRequestException('运行根必须是安全的绝对路径');
  }
  const normalized = path.posix.normalize(root).replace(/\/+$/, '');
  if (!normalized || path.posix.basename(normalized) === 'web_system_git') {
    throw new BadRequestException('运行根须统一到 web_system；旧 web_system_git 目录先完成受控迁移，不能继续作为发布目标');
  }
  return normalized;
}
