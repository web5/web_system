import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execSync } from 'child_process';
import * as path from 'path';

/** 子进程 PATH 补充目录（pm2/npx/pnpm/nohup 拉起的进程 PATH 可能极不完整） */
export const EXTRA_PATH_DIRS = [
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
  '/opt/homebrew/bin',
];

/**
 * 构造子进程 env：继承 process.env + 补全 PATH。
 * pm2/npx/pnpm 都是 node 脚本，PATH 必须包含 node 安装目录，
 * 否则子进程报 `env: node: No such file or directory`（线上真实踩坑）。
 */
export function buildChildEnv(
  extraEnv: Record<string, string> = {},
  nodeBinDir?: string,
): NodeJS.ProcessEnv {
  const dirs = [...EXTRA_PATH_DIRS];
  if (nodeBinDir) dirs.push(nodeBinDir);
  return {
    ...process.env,
    ...extraEnv,
    PATH: `${process.env.PATH ?? ''}:${dirs.join(':')}`,
  };
}

/**
 * 命令执行工具（发布平台同步 exec 的统一承载）。
 *
 * 收敛自 pipeline.service.ts / pm2-probe.service.ts / deploy.service 各自内联的
 * PATH 补齐与 bin 路径解析，改 PATH 只需改 buildChildEnv 一处。
 */
@Injectable()
export class CommandService {
  constructor(private readonly configService: ConfigService) {}

  /** node 安装目录（pm2/npx/pnpm 所在；RELEASE_NODE_BIN 可覆盖） */
  nodeBinDir(): string {
    return this.configService.get<string>('RELEASE_NODE_BIN') || path.dirname(process.execPath);
  }

  pm2Bin(): string {
    return this.configService.get<string>('RELEASE_PM2_BIN') || path.join(this.nodeBinDir(), 'pm2');
  }

  pnpmBin(): string {
    return this.configService.get<string>('RELEASE_PNPM_BIN') || path.join(this.nodeBinDir(), 'pnpm');
  }

  npxBin(): string {
    return path.join(this.nodeBinDir(), 'npx');
  }

  /** 同步执行命令（PATH 补齐），返回 stdout 原文（git/tar/scp/ssh/pm2/pnpm 等共用） */
  exec(cmd: string, cwd: string, extraEnv: Record<string, string> = {}): string {
    return execSync(cmd, {
      cwd,
      encoding: 'utf-8',
      env: buildChildEnv(extraEnv, this.nodeBinDir()),
    });
  }
}
