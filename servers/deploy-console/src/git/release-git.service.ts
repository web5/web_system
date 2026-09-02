import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { CommandService } from '../shell/command.service';

/** 依赖清单指纹文件（pnpm-lock.yaml 变化才重装） */
const DEPS_HASH_FILE = '.deploy-lock-hash';

/**
 * 发布目录 git 工作区工具（pull 内置步骤的执行体，tool-catalog `code` 分类）。
 *
 * 收敛自 pipeline.service.ts 的 stagePull / gitShortHead / gitBranch / ensureDeps：
 * 发布目录（RELEASE_WORKSPACE）与开发工作区隔离，每次发布保证代码 = 目标 commit，
 * 不会出现「本地未提交代码被发出去」的情况。
 *
 * 安全：branch / commit 会拼进 git 命令，调用方（check 阶段）已做白名单校验，
 * 本工具信任调用方传入（保持与旧实现相同的安全边界）。
 */
@Injectable()
export class ReleaseGitService {
  constructor(
    private readonly configService: ConfigService,
    private readonly command: CommandService,
  ) {}

  /** 发布目录（RELEASE_WORKSPACE，可配） */
  workspace(): string {
    return (
      this.configService.get<string>('RELEASE_WORKSPACE') || '/Users/geekwen/web_system_release'
    );
  }

  /** 校验发布目录为 git 仓库（未 clone 时抛错并给出初始化提示） */
  ensureRepo(): string {
    const ws = this.workspace();
    if (!fs.existsSync(path.join(ws, '.git'))) {
      throw new Error(
        `发布目录不存在: ${ws}。请先初始化：git clone git@github.com:web5/web_system.git ${ws}`,
      );
    }
    return ws;
  }

  /** 当前 HEAD 短哈希 */
  shortHead(ws?: string): string {
    return this.command.exec('git rev-parse --short HEAD', ws ?? this.workspace()).trim();
  }

  /** 当前分支名 */
  branchName(ws?: string): string {
    return this.command.exec('git rev-parse --abbrev-ref HEAD', ws ?? this.workspace()).trim();
  }

  /**
   * 发布目录同步到目标分支（fetch → checkout 目标分支 → 可选 reset commit → clean）。
   * 返回同步后的实际 commit（未指定 commit 时即分支最新）。
   */
  syncToBranch(branch: string, commit?: string, ws?: string): string {
    const dir = ws ?? this.ensureRepo();
    this.command.exec('git fetch --all --prune', dir);
    this.command.exec(
      `git checkout -B ${branch} origin/${branch} 2>/dev/null || git checkout -B ${branch} ${branch}`,
      dir,
    );
    // 指定 commit 则强制 reset（校验 commit 存在，不存在会抛错）
    if (commit) {
      this.command.exec(`git reset --hard ${commit}`, dir);
    }
    // 清理未跟踪文件/目录，避免残留污染构建
    this.command.exec('git clean -fd', dir);
    return this.shortHead(dir);
  }

  /**
   * 依赖同步：pnpm-lock.yaml 指纹变化才执行 pnpm install（避免每次全量安装）。
   * 以 .deploy-lock-hash 记录上次指纹；install 失败向上抛（调用方决定是否阻断）。
   * @returns 'installed' 本次执行了 install；'unchanged' 无变化跳过
   */
  syncDependencies(ws?: string): 'installed' | 'unchanged' {
    const dir = ws ?? this.workspace();
    const lockFile = path.join(dir, 'pnpm-lock.yaml');
    if (!fs.existsSync(lockFile)) return 'unchanged';
    const hash = this.md5(fs.readFileSync(lockFile));
    const hashFile = path.join(dir, DEPS_HASH_FILE);
    const last = fs.existsSync(hashFile) ? fs.readFileSync(hashFile, 'utf-8') : '';
    if (hash === last) return 'unchanged';
    this.command.exec(`"${this.command.pnpmBin()}" install --prefer-offline`, dir);
    fs.writeFileSync(hashFile, hash);
    return 'installed';
  }

  private md5(buf: Buffer): string {
    return crypto.createHash('md5').update(buf).digest('hex');
  }
}
