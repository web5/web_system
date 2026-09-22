import * as fs from 'fs';
import * as path from 'path';
import { moduleArtifactsRoot } from '../pipeline/release-paths';

/**
 * 入口指针工具（微前端域 · P1）
 *
 * 设计依据：specs/deploy-console-domain-split/design.md v2 §3（Q105-B）+ tech-design.md §2.1（T1 定稿）
 *
 * 产物布局：
 * ```
 * <ws>/servers/gateway/public/static/modules/<appKey>/
 *   <envId>/
 *     index.js          ← 入口指针（no-cache）：指向当前版本
 *     <version>/        ← 版本目录（immutable）
 *       index.js  index.css  assets/*
 * ```
 *
 * 入口指针写法 **A'（System.register 版）**：命名导出 + `default` 双透传。
 *
 * ⚠️ 必须写成 System.register，**不能**用原生 ESM 的 `export * from`：
 * 微前端产物统一以 `MF_FORMAT=system` 构建（`scripts/deploy.sh` / `deploy-local.sh`），
 * 消费方 `packages/shell-loader` 只走 `System.import()`（失败才回退 UMD 经典脚本）。
 * 原生 `export` 语法会在 **SystemJS 解析阶段**直接抛 `Unexpected token 'export'`，
 * 文件体从未执行 —— 连 loader 的 ③ `window.__MODULES__[name]` 全局兜底也一并失效
 * （指针文件根本没跑起来，产物自然也没被加载）。
 *
 * 依据：systemjs 6.15.1 实测（ESM 指针 THROW / 本写法 PASS 且 `default.mount` 可用）
 * 与 2026-09-21 `local.kedouai.com` 门户加载失败事故（`portal@env:local`）。
 */

/** T1 定稿 A' 的 SystemJS 等价写法（单测锁定，勿改） */
export function entryPointerJs(version: string): string {
  return (
    `System.register(['./${version}/index.js'], function (_export) {\n` +
    `  'use strict';\n` +
    `  return {\n` +
    `    setters: [function (m) { _export(m); }],\n` +
    `    execute: function () {}\n` +
    `  };\n` +
    `});\n`
  );
}

/** 样式入口指针（版本目录存在 index.css 时才写） */
export function entryPointerCss(version: string): string {
  return `@import url('./${version}/index.css');\n`;
}

/** `<ws>/servers/gateway/public/static/modules/<appKey>/<envId>` */
export function envArtifactsDir(releaseWorkspace: string, appKey: string, envId: string): string {
  return path.join(moduleArtifactsRoot(releaseWorkspace, appKey), envId);
}

/** 某版本产物目录（version 可含 `/`，如 `default/1a2b3c4`） */
export function envVersionDir(
  releaseWorkspace: string,
  appKey: string,
  envId: string,
  version: string,
): string {
  return path.join(envArtifactsDir(releaseWorkspace, appKey, envId), version);
}

/** 某版本产物是否就绪（入口文件存在） */
export function hasEnvVersion(
  releaseWorkspace: string,
  appKey: string,
  envId: string,
  version: string,
): boolean {
  return fs.existsSync(path.join(envVersionDir(releaseWorkspace, appKey, envId, version), 'index.js'));
}

/**
 * 列出某环境下的产物版本（按 mtime 倒序）。
 * 兼容两种布局：一级即版本（`<version>/index.js`）与命名空间（`<ns>/<commit>/index.js`）。
 */
export function listEnvVersions(releaseWorkspace: string, appKey: string, envId: string): string[] {
  const base = envArtifactsDir(releaseWorkspace, appKey, envId);
  if (!fs.existsSync(base)) return [];
  const found: { ref: string; mtime: number }[] = [];
  for (const d of fs.readdirSync(base, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const l1 = path.join(base, d.name);
    if (fs.existsSync(path.join(l1, 'index.js'))) {
      found.push({ ref: d.name, mtime: fs.statSync(l1).mtimeMs });
      continue;
    }
    for (const v of fs.readdirSync(l1, { withFileTypes: true })) {
      if (!v.isDirectory()) continue;
      const l2 = path.join(l1, v.name);
      if (fs.existsSync(path.join(l2, 'index.js'))) {
        found.push({ ref: `${d.name}/${v.name}`, mtime: fs.statSync(l2).mtimeMs });
      }
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime).map((r) => r.ref);
}

/**
 * 改写入口指针（**切换版本 / 回滚的唯一写入口**，不重建产物）。
 * @returns 实际写入的绝对路径（js 必有，css 视产物而定）
 */
export function writeEnvEntryPointer(
  releaseWorkspace: string,
  appKey: string,
  envId: string,
  version: string,
): { js: string; css: string | null } {
  const dir = envArtifactsDir(releaseWorkspace, appKey, envId);
  fs.mkdirSync(dir, { recursive: true });
  const js = path.join(dir, 'index.js');
  fs.writeFileSync(js, entryPointerJs(version), 'utf-8');
  let css: string | null = null;
  if (fs.existsSync(path.join(dir, version, 'index.css'))) {
    css = path.join(dir, 'index.css');
    fs.writeFileSync(css, entryPointerCss(version), 'utf-8');
  }
  return { js, css };
}

/** 读回入口指针当前指向的版本（展示/校验用；解析失败返回 null） */
export function readEnvEntryPointer(
  releaseWorkspace: string,
  appKey: string,
  envId: string,
): string | null {
  const file = path.join(envArtifactsDir(releaseWorkspace, appKey, envId), 'index.js');
  if (!fs.existsSync(file)) return null;
  const content = fs.readFileSync(file, 'utf-8');
  // 兼容两种历史写法：System.register(['./<v>/index.js'], …) 与旧 ESM 的 from './<v>/index.js'
  const m = content.match(/'\.\/(.+?)\/index\.js'/);
  return m ? m[1] : null;
}

/** 产物 HTTP URL（供 verify 探活 / 前端加载） */
export function envEntryUrl(appKey: string, envId: string): string {
  return `/static/modules/${appKey}/${envId}/index.js`;
}
