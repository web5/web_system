import { toCommitId } from './release-paths';

/**
 * 发布收尾 manifest 硬门禁的纯规则层（半发布治理 F1-③，2026-11-12，05a 专项 P0-1）。
 *
 * 判据：gateway `/__manifest__` 的 `byEnv[env][moduleKey].version`（回落 `modules[]`
 * 同名模块）== 本次发布的 versionTag。两侧都过 `toCommitId` 归一 —— 版本串存在
 * `<ns>/<commit>` 与纯 commit 两种拼写（05a P1-1），不归一会把同一版本判成不一致。
 *
 * manifest 是 DB 驱动的**线上实际供数面**：它说旧版本 = 用户拿到的就是旧版本，
 * 无论流水线显示什么。不一致即半发布（或半发布的镜像形态），必须判 failed。
 */

/** manifest 响应的最小结构（与 gateway buildManifest 同源口径） */
export interface ManifestLike {
  modules?: Array<{ name?: string; key?: string; version?: string }>;
  byEnv?: Record<string, Record<string, { entry?: string; css?: string | null; version?: string }>>;
}

/** 从 manifest 取某 env 下某模块的供数版本（byEnv 优先，回落兼容字段 modules[]） */
export function manifestVersionOf(
  manifest: ManifestLike | null | undefined,
  env: string,
  moduleKey: string,
): string | null {
  if (!manifest) return null;
  const byEnv = manifest.byEnv?.[env]?.[moduleKey]?.version;
  if (byEnv) return byEnv;
  const legacy = manifest.modules?.find((m) => (m.key ?? m.name) === moduleKey)?.version;
  return legacy ?? null;
}

/** 双侧归一化后比对；任一侧取不到/归一不出 → 不一致（不猜） */
export function manifestMatches(
  manifest: ManifestLike | null | undefined,
  env: string,
  moduleKey: string,
  expectVersion: string,
): boolean {
  const actual = manifestVersionOf(manifest, env, moduleKey);
  if (!actual || !expectVersion) return false;
  const a = toCommitId(actual) ?? actual;
  const e = toCommitId(expectVersion) ?? expectVersion;
  return a === e;
}

/** 门禁失败错误（文案带三方定位信息：期望版本 vs manifest 实供版本） */
export class ManifestGateError extends Error {
  constructor(
    readonly env: string,
    readonly moduleKey: string,
    readonly expectVersion: string,
    readonly manifestVersion: string | null,
  ) {
    super(
      `发布收尾硬门禁失败：gateway manifest 实供版本与本次发布不一致 —— ` +
        `${moduleKey}@${env} 期望 ${expectVersion}，manifest 实供 ${manifestVersion ?? '（取不到）'}。` +
        `疑似半发布（盘/表/manifest 撕裂），请查 GET /api/reconcile/pointers 对账报告，并用指针修复入口收敛`,
    );
    this.name = 'ManifestGateError';
  }
}
