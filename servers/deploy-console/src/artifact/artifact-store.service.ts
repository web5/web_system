import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as releasePaths from '../pipeline/release-paths';

/** 每个命名空间保留的历史版本目录数量（用户约定 N=5） */
export const KEEP_VERSIONS = 5;

/**
 * 版本目录的最短保留时长（毫秒），默认 24h。
 *
 * 为什么需要：只按"最近 N 个"保留时，高频发布（一天十几次）会把几小时前的版本全部
 * 清掉 —— 而用户浏览器里可能还开着那个版本的页面，切模块时会请求已被删除的分包 →
 * 404 → 首屏空白（2026-09-11 事故）。加时间下限后，最近 24h 内的产物一定还在，
 * 已打开的旧页面有充足窗口自然刷新。传 0 可关闭该下限（测试/特殊场景）。
 */
export const KEEP_MIN_AGE_MS = 24 * 60 * 60 * 1000;

export interface ArtifactCleanupResult {
  kept: string[];
  removed: string[];
}

/** 产物根下一级目录的分类结果（见 {@link ArtifactStoreService.listL1} 的三种布局） */
export interface L1Entry {
  name: string;
  mtime: number;
  /** 一级目录即版本（legacy） */
  isVersion: boolean;
  /** 该层是 env-dir 入口指针层时，指针当前指向的版本（纯 commit） */
  pointerTarget: string | null;
  /** 该层是否存在 index.js（指针或版本入口） */
  hasEntry: boolean;
}

/**
 * 读入口指针指向的版本（纯函数）。
 *
 * 指针文本形如 `System.register(['./<version>/index.js'], …)`（写法 A′）。
 * 解析不出就返回 null —— 调方据此当作「不是指针层」，不会误保护。
 */
export function readPointerTarget(entryFile: string): string | null {
  try {
    const content = fs.readFileSync(entryFile, 'utf-8');
    const m = content.match(/['"]\.\/(.+?)\/index\.js['"]/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
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

  /**
   * 列出某模块产物根的一级子目录（含 mtime，按 mtime 倒序），供内部使用。
   *
   * 三种布局（诊断 #9 修正点）：
   * - **legacy**：`modules/<m>/<commit>/index.js` —— 一级即版本
   * - **流水线命名空间**：`modules/<m>/<pipeline>/<commit>/index.js` —— 一级无 index.js
   * - **env-dir（微前端）**：`modules/<m>/<env>/index.js` 是**入口指针**，
   *   真正的版本在其下的 `modules/<m>/<env>/<commit>/index.js`
   *
   * 旧的判定只看「一级目录含不含 index.js」，把 env-dir 的 **env 层误判成版本**：
   * ① 它的 L2 版本目录永远扫不到 ⇒ 永不清理、无限增长；
   * ② 更危险：一旦该 env 层 mtime 超过 minAge 且不在 keep 内，就会走 legacy 分支
   *   `rmSync(<base>/<env>)` —— **连指针带所有版本整个删掉**，线上直接白屏。
   *
   * 修正后的判定：**有「含 index.js 的子目录」⇒ 该层是命名空间/env 层**，
   * 只有「含 index.js 且无此类子目录」才是 legacy 版本。这条规则同时覆盖流水线
   * 命名空间与 env-dir，不需要额外引入 deployMode 概念。
   */
  private listL1(moduleKey: string): L1Entry[] {
    const base = this.root(moduleKey);
    if (!fs.existsSync(base)) return [];
    return fs
      .readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d): L1Entry => {
        const dir = path.join(base, d.name);
        const entry = path.join(dir, 'index.js');
        const hasEntry = fs.existsSync(entry);
        const hasVersionChildren = fs
          .readdirSync(dir, { withFileTypes: true })
          .some((c) => c.isDirectory() && fs.existsSync(path.join(dir, c.name, 'index.js')));

        return {
          name: d.name,
          mtime: fs.statSync(dir).mtimeMs,
          isVersion: hasEntry && !hasVersionChildren,
          // 有子版本 + 有 index.js ⇒ 那个 index.js 是入口指针（env-dir）
          pointerTarget: hasEntry && hasVersionChildren ? readPointerTarget(entry) : null,
          hasEntry,
        };
      })
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
   * 清理旧版本目录：每个命名空间各自保留
   *   ① 受保护版本（当前版本 / 启用中的灰度版本，由调用方收集）
   *   ② 最近 keep 个（legacy 与每个流水线命名空间独立计）
   *   ③ **未满 minAgeMs 的版本**（时间下限，见 KEEP_MIN_AGE_MS）
   *
   * 为什么要 ③：只按数量保留时，高频发布会把几小时前的产物全清掉，而用户浏览器里
   * 可能还开着那个版本的页面 → 切模块请求已删除的分包 → 白屏（2026-09-11 事故）。
   *
   * 与 upload 一样是发布目录内 fs 操作。
   */
  cleanup(
    moduleKey: string,
    keep = KEEP_VERSIONS,
    protectedVersions: ReadonlySet<string> = new Set(),
    minAgeMs = KEEP_MIN_AGE_MS,
  ): ArtifactCleanupResult {
    const base = this.root(moduleKey);
    if (!fs.existsSync(base)) return { kept: [], removed: [] };

    const now = Date.now();
    /** 未满最短保留时长 → 一律保留（mtime 越新越该留） */
    const withinMinAge = (mtime: number): boolean => minAgeMs > 0 && now - mtime < minAgeMs;

    const kept: string[] = [];
    const removed: string[] = [];

    // 分组：legacy 直接处理，每个流水线命名空间独立处理
    const l1 = this.listL1(moduleKey);
    for (const d of l1) {
      if (d.isVersion) {
        // legacy 版本
        if (protectedVersions.has(d.name) || kept.length < keep || withinMinAge(d.mtime)) {
          kept.push(d.name);
        } else {
          fs.rmSync(path.join(base, d.name), { recursive: true, force: true });
          removed.push(d.name);
        }
      } else {
        // 命名空间 / env 层：清理其下的版本
        const nsKept: string[] = [];
        const nsVersions = this.listL2(moduleKey, d.name).sort((a, b) => b.mtime - a.mtime);
        for (const v of nsVersions) {
          const ref = `${d.name}/${v.name}`;
          // env-dir：指针当前指向的版本必须受保护 —— 它是**线上正在服务的版本**。
          // 少了这条，高频发布下清理有可能把当前版本删掉 ⇒ 已打开页面请求不到分包（白屏）。
          // 调用方传入的 protectedVersions 未必覆盖它（那张表可能是空的或被绕过）。
          const isPointerTarget = !!d.pointerTarget && d.pointerTarget === v.name;
          if (
            isPointerTarget ||
            protectedVersions.has(ref) ||
            protectedVersions.has(v.name) ||
            nsKept.length < keep ||
            withinMinAge(v.mtime)
          ) {
            nsKept.push(ref);
          } else {
            fs.rmSync(path.join(base, d.name, v.name), { recursive: true, force: true });
            removed.push(ref);
          }
        }
        kept.push(...nsKept);
        // 空命名空间目录清理：无版本**且无入口指针**时才移除。
        // env-dir 的 env 层即使版本被清空，`index.js`（指针）也必须留着 —— 删了它
        // 等于把该环境的入口文件删除，gateway 拼 index.html 时直接取不到模块。
        if (nsVersions.length === 0 && !d.hasEntry) {
          fs.rmSync(path.join(base, d.name), { recursive: true, force: true });
        }
      }
    }
    return { kept, removed };
  }
}
