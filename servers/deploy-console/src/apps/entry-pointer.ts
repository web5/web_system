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
 * 入口指针写法 **A'（两行）**：`export *` 不透传 `default`（P0 验证结论），
 * 故同时透传命名导出与 default，兼容 shell-loader 的 lifecycle 解析顺序。
 */

/** T1 定稿 A'：命名导出 + default 双透传（单测锁定，勿改） */
export function entryPointerJs(version: string): string {
  return `export * from './${version}/index.js';\nexport { default } from './${version}/index.js';\n`;
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
  const m = content.match(/from\s+'\.\/(.+?)\/index\.js'/);
  return m ? m[1] : null;
}

/** 产物 HTTP URL（供 verify 探活 / 前端加载） */
export function envEntryUrl(appKey: string, envId: string): string {
  return `/static/modules/${appKey}/${envId}/index.js`;
}
