import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as releasePaths from '../pipeline/release-paths';

/** 每个命名空间保留的历史版本目录数量（用户约定 N=5） */
export const KEEP_VERSIONS = 5;

export interface ArtifactCleanupResult {
  kept: string[];
  removed: string[];
}

/**
 * 静态产物存储工具（upload/cleanup 内置步骤的执行体）。
 *
 * R6 命名空间感知（design.md §3.1 D-a）：
 * - legacy：`modules/<module>/<version>/`（一级目录含 index.js）
 * - 流水线：`modules/<module>/<pipelineKey>/<version>/`（一级目录无 index.js，二级为版本）
 */
@Injectable()
export class ArtifactStoreService {
  constructor(private readonly configService: ConfigService) {}

  /** 发布目录（RELEASE_WORKSPACE，可配；与 ReleaseGitService 同配置源） */
  workspace(): string {
    return (
      this.configService.get<string>('RELEASE_WORKSPACE') || releasePaths.defaultReleaseWorkspace()
    );
  }

  /** 某模块产物根目录（本地 fs） */
  private root(moduleKey: string): string {
    return releasePaths.moduleArtifactsRoot(this.workspace(), moduleKey);
  }

  /** 指定版本产物目录（version 可含 `/`，如 `default/1a2b3c4`） */
  private dir(moduleKey: string, version: string): string {
    return releasePaths.moduleArtifactDir(this.workspace(), moduleKey, version);
  }

  /** 产物是否已在磁盘（index.js 存在；version 可含 `/`） */
  exists(moduleKey: string, version: string): boolean {
    return fs.existsSync(releasePaths.moduleArtifactEntry(this.workspace(), moduleKey, version));
  }

  /** 列出某模块产物根的一级子目录（含 mtime，按 mtime 倒序），供内部使用 */
  private listL1(moduleKey: string): { name: string; mtime: number; isVersion: boolean }[] {
    const base = this.root(moduleKey);
    if (!fs.existsSync(base)) return [];
    return fs
      .readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => ({
        name: d.name,
        mtime: fs.statSync(path.join(base, d.name)).mtimeMs,
        // 一级目录含 index.js = legacy 版本；无 = 流水线命名空间
        isVersion: fs.existsSync(path.join(base, d.name, 'index.js')),
      }))
      .sort((a, b) => b.mtime - a.mtime);
  }

  /** 列出某命名空间下的版本目录（二级） */
  private listL2(moduleKey: string, ns: string): { name: string; mtime: number }[] {
    const base = path.join(this.root(moduleKey), ns);
    if (!fs.existsSync(base)) return [];
    return fs
      .readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(base, d.name, 'index.js')))
      .map((d) => ({ name: d.name, mtime: fs.statSync(path.join(base, d.name)).mtimeMs }));
  }

  /**
   * 磁盘产物版本列表（按修改时间倒序，返回完整引用）。
   * 合并 legacy（`<commit>`）与流水线命名空间（`<pipelineKey>/<commit>`）。
   */
  listVersions(moduleKey: string): string[] {
    const l1 = this.listL1(moduleKey);
    const results: { ref: string; mtime: number }[] = [];
    for (const d of l1) {
      if (d.isVersion) {
        // legacy：一级目录即版本
        results.push({ ref: d.name, mtime: d.mtime });
      } else {
        // 流水线命名空间：二级为版本
        for (const v of this.listL2(moduleKey, d.name)) {
          results.push({ ref: `${d.name}/${v.name}`, mtime: v.mtime });
        }
      }
    }
    return results.sort((a, b) => b.mtime - a.mtime).map((r) => r.ref);
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
   * 清理旧版本目录：每个命名空间各自保留最近 keep 个（legacy 独立计）。
   * 与 upload 一样是发布目录内 fs 操作，调用方负责收集受保护版本（灰度规则等）。
   */
  cleanup(
    moduleKey: string,
    keep = KEEP_VERSIONS,
    protectedVersions: ReadonlySet<string> = new Set(),
  ): ArtifactCleanupResult {
    const base = this.root(moduleKey);
    if (!fs.existsSync(base)) return { kept: [], removed: [] };

    const kept: string[] = [];
    const removed: string[] = [];

    // 分组：legacy 直接处理，每个流水线命名空间独立处理
    const l1 = this.listL1(moduleKey);
    for (const d of l1) {
      if (d.isVersion) {
        // legacy 版本
        if (protectedVersions.has(d.name) || kept.length < keep) {
          kept.push(d.name);
        } else {
          fs.rmSync(path.join(base, d.name), { recursive: true, force: true });
          removed.push(d.name);
        }
      } else {
        // 流水线命名空间：清理其下的版本
        const nsKept: string[] = [];
        const nsVersions = this.listL2(moduleKey, d.name).sort((a, b) => b.mtime - a.mtime);
        for (const v of nsVersions) {
          const ref = `${d.name}/${v.name}`;
          if (protectedVersions.has(ref) || protectedVersions.has(v.name) || nsKept.length < keep) {
            nsKept.push(ref);
          } else {
            fs.rmSync(path.join(base, d.name, v.name), { recursive: true, force: true });
            removed.push(ref);
          }
        }
        kept.push(...nsKept);
        // 空命名空间目录清理（无版本时移除）
        if (nsVersions.length === 0) {
          fs.rmSync(path.join(base, d.name), { recursive: true, force: true });
        }
      }
    }
    return { kept, removed };
  }
}
