/**
 * 微前端环境（加载维度）共享逻辑
 *
 * 环境 = 「微前端按 envId 加载哪份产物」+「API 网关按 envId 解析哪个上游」，
 * 两侧必须一致（R4），故解析与上报逻辑收口到这一处，供 shell 基座、
 * EnvSwitcher 挂件与独立运行的 micro-app 共用。
 *
 * 设计依据：specs/deploy-console-domain-split/environment-design.md / tech-design.md §运行时契约
 */

/** 用户选择的环境（挂件写入，整页重载后由本模块读回） */
export const ENV_STORAGE_KEY = 'kedou.env';

/** 随请求携带的环境头：gateway 据此解析后端上游（R4 前后端环境联动） */
export const ENV_HEADER = 'x-env-id';

export interface EnvItem {
  id: string;
  name?: string;
}

/** manifest 中与本模块相关的字段（gateway /__manifest__ 产出） */
export interface ManifestLike {
  site?: string | null;
  env?: string;
  defaultEnv?: string;
  switchable?: boolean;
  envs?: EnvItem[];
  byEnv?: Record<string, Record<string, unknown>>;
  /** 兼容期旧结构（gateway 未产出 byEnv 时的回落源） */
  modules?: unknown[];
}

/** 读取注入的 manifest（gateway 注入 window.__MODULES_MANIFEST__） */
export function readManifest(): ManifestLike {
  return ((globalThis as any).__MODULES_MANIFEST__ || {}) as ManifestLike;
}

/**
 * 解析当前 envId，优先级与网关/后端一致：
 *   ① localStorage（用户在挂件里选的）
 *   ② 站点 defaultEnv（Host 匹配站点）
 *   ③ 'dev'（**找不到一律回退主开发环境**，Q1）
 *
 * 注意：① 只在「该环境确实存在于 envs 列表」时生效 —— 环境被删除后
 * localStorage 里的旧值若继续生效会指向已删目录，必须回退。
 */
export function resolveEnvId(manifest: ManifestLike = {}): string {
  const ids = (manifest.envs || []).map((e) => e.id);
  const picked = localStorage.getItem(ENV_STORAGE_KEY);
  if (picked && (!ids.length || ids.includes(picked))) return picked;
  const fallback = manifest.defaultEnv || manifest.env || 'dev';
  if (ids.length && !ids.includes(fallback)) return ids[0] || 'dev';
  return fallback || 'dev';
}

/**
 * 上报环境切换（审计 Q110）。
 *
 * **失败可忽略**：切换本身是本地行为（写 localStorage + reload），
 * 审计上报失败不应阻断用户操作，故只做 fire-and-forget。
 */
export async function reportEnvSwitch(envId: string, siteKey?: string): Promise<void> {
  try {
    const token = localStorage.getItem('token');
    await fetch('/console/api/envs/switch-log', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ envId, siteKey }),
    });
  } catch {
    /* 审计上报失败不影响切换 */
  }
}
