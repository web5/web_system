import * as path from 'path';

/**
 * 静态产物路径工具（纯函数，便于单测）。
 *
 * 发布平台「产物在哪个目录、HTTP URL 是什么、远端投到哪」这类平台知识，
 * 此前散落在 pipeline.service.ts 多处手拼（hasArtifact / listArtifactVersions /
 * switchPointer / stageUpload / stageCleanup / stageVerify），改布局只漏改一处就会
 * 出现「投递成功但验证 404」这类静默问题。统一收口到本文件（V6 平台逻辑收敛为工具）。
 */

/** 发布目录内 gateway 静态产物相对布局（与本地发布目录 / 远程部署目录布局一致） */
export const STATIC_MODULES_REL = 'servers/gateway/public/static/modules';

/** 远程服务器投递根目录（scp 目标，与发布目录布局一致） */
export const REMOTE_MODULES_ROOT = '/data/web_system/servers/gateway/public/static/modules';

/** 发布目录（本地 fs）中某模块产物根目录 */
export function moduleArtifactsRoot(releaseWorkspace: string, moduleKey: string): string {
  return path.join(releaseWorkspace, STATIC_MODULES_REL, moduleKey);
}

/** 指定版本的产物目录（本地 fs）；version 可含 `/`（`<pipelineKey>/<commit>` 命名空间） */
export function moduleArtifactDir(
  releaseWorkspace: string,
  moduleKey: string,
  version: string,
): string {
  return path.join(moduleArtifactsRoot(releaseWorkspace, moduleKey), version);
}

/** 产物入口文件绝对路径（index.js），用于磁盘存在性断言 */
export function moduleArtifactEntry(
  releaseWorkspace: string,
  moduleKey: string,
  version: string,
): string {
  return path.join(moduleArtifactDir(releaseWorkspace, moduleKey, version), 'index.js');
}

/** 产物 HTTP URL（gateway 静态服务可访问地址，verify 阶段 HEAD 探活用） */
export function moduleArtifactUrl(gatewayBaseUrl: string, moduleKey: string, version: string): string {
  return `${gatewayBaseUrl}/static/modules/${moduleKey}/${version}/index.js`;
}

/** gateway 模块清单 URL（verify 阶段断言版本已生效） */
export function manifestUrl(gatewayBaseUrl: string): string {
  return `${gatewayBaseUrl}/__manifest__`;
}

// ── R6 版本身份（design.md §3.1 D-a）─────────────────────────

/** 版本引用解析结果 */
export interface ReleaseRef {
  /** 流水线 key（无 `/` 前缀 = legacy 历史版本） */
  pipelineKey?: string;
  /** 版本号（git 短哈希） */
  version: string;
}

/**
 * 解析版本引用（**唯一解析点**，design.md §3.1 §7.3）。
 *
 * - `default/1a2b3c4` → `{ pipelineKey: 'default', version: '1a2b3c4' }`（流水线命名空间）
 * - `1a2b3c4`         → `{ version: '1a2b3c4' }`（legacy 历史产物）
 *
 * 产物目录 = `modules/<module>/<完整引用>/`，`current_version` = 完整引用。
 * gateway / nginx 零改动（gateway 只做字符串拼接，version 含 `/` 即多一级目录）。
 */
export function parseReleaseRef(ref: string): ReleaseRef {
  const idx = ref.indexOf('/');
  if (idx < 0) return { version: ref };
  const pipelineKey = ref.slice(0, idx);
  const version = ref.slice(idx + 1);
  if (!pipelineKey || !version) return { version: ref };
  return { pipelineKey, version };
}

/** 组装版本引用（`<pipelineKey>/<version>` 或纯 `<version>`） */
export function buildReleaseRef(pipelineKey: string | undefined, version: string): string {
  return pipelineKey ? `${pipelineKey}/${version}` : version;
}
