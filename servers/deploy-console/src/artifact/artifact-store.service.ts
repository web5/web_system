import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as releasePaths from '../pipeline/release-paths';

/** 保留的历史版本目录数量（用户约定 N=5） */
export const KEEP_VERSIONS = 5;

export interface ArtifactCleanupResult {
  kept: string[];
  removed: string[];
}

/**
 * 静态产物存储工具（upload/cleanup 内置步骤的执行体，tool-catalog `deploy/cleanup` 分类）。
 *
 * 收敛自 pipeline.service.ts：hasArtifact / listArtifactVersions / stageUpload(local) /
 * stageCleanup / switchPointer 的产物检查 中散落的发布目录 fs 操作。
 * 目录/URL 布局知识见 release-paths（本服务为 fs 操作层）。
 */
@Injectable()
export class ArtifactStoreService {
  constructor(private readonly configService: ConfigService) {}

  /** 发布目录（RELEASE_WORKSPACE，可配；与 ReleaseGitService 同配置源） */
  workspace(): string {
    return (
      this.configService.get<string>('RELEASE_WORKSPACE') || '/Users/geekwen/web_system_release'
    );
  }

  /** 某模块产物根目录（本地 fs） */
  private root(moduleKey: string): string {
    return releasePaths.moduleArtifactsRoot(this.workspace(), moduleKey);
  }

  /** 指定版本产物目录（本地 fs） */
  private dir(moduleKey: string, version: string): string {
    return releasePaths.moduleArtifactDir(this.workspace(), moduleKey, version);
  }

  /** 产物是否已在磁盘（index.js 存在） */
  exists(moduleKey: string, version: string): boolean {
    return fs.existsSync(releasePaths.moduleArtifactEntry(this.workspace(), moduleKey, version));
  }

  /** 磁盘产物版本列表（按修改时间倒序） */
  listVersions(moduleKey: string): string[] {
    const base = this.root(moduleKey);
    if (!fs.existsSync(base)) return [];
    return fs
      .readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(base, d.name, 'index.js')))
      .map((d) => ({ name: d.name, mtime: fs.statSync(path.join(base, d.name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .map((d) => d.name);
  }

  /**
   * 本地投递：清空目标版本目录后整拷 dist（避免残留过期文件）。
   * @returns 目标目录（供日志）
   */
  uploadLocal(moduleKey: string, version: string, srcDir: string): string {
    const dest = this.dir(moduleKey, version);
    fs.mkdirSync(dest, { recursive: true });
    for (const f of fs.readdirSync(dest)) {
      fs.rmSync(path.join(dest, f), { recursive: true, force: true });
    }
    fs.cpSync(srcDir, dest, { recursive: true });
    return dest;
  }

  /**
   * 清理旧版本目录：保留最近 keep 个（受保护版本不删），返回保留/删除清单。
   * 与 upload 一样是发布目录内 fs 操作，调用方负责收集受保护版本（灰度规则等）。
   */
  cleanup(
    moduleKey: string,
    keep = KEEP_VERSIONS,
    protectedVersions: ReadonlySet<string> = new Set(),
  ): ArtifactCleanupResult {
    const base = this.root(moduleKey);
    if (!fs.existsSync(base)) return { kept: [], removed: [] };

    const dirs = fs
      .readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => ({ name: d.name, mtime: fs.statSync(path.join(base, d.name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    const kept: string[] = [];
    const removed: string[] = [];
    for (const d of dirs) {
      if (protectedVersions.has(d.name) || kept.length < keep) {
        kept.push(d.name);
        continue;
      }
      fs.rmSync(path.join(base, d.name), { recursive: true, force: true });
      removed.push(d.name);
    }
    return { kept, removed };
  }
}
