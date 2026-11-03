/**
 * 部署形态判定 — 唯一实现，禁止各服务按「本服务有没有凭证」自行推断。
 *
 * ## 为什么要显式声明
 *
 * 历史上「是不是集群」是**隐式**的：`upload-dir.ts` 的入口判据是
 * `INTERNAL_API_KEY` 是否为空。而凭证是**部署细节**，不是形态声明 ——
 * 2026-11-03 实测 prod：`ai/user/upload/system-service` 配了内部密钥，
 * `content-hub / gateway / auth-service` 没配 —— 同一个集群被推出两种形态。
 *
 * 更危险的是形态决定**数据目录口径**：集群形态下若拿不到权威值就回落到
 * 单机默认路径（`~/web_system/uploads`，prod 上是 `/root/web_system/uploads`），
 * 与存量 `/data/web_system/uploads` 分裂，日志里只有一条 warn。
 * 即「用单服务的路径去接受微服务的请求」。
 *
 * ## 两条硬约定
 *
 * 1. **形态只能显式声明**：未声明走平台默认（`cluster`，与 dev/prod 现状一致），
 *    拼错**拒绝启动**而不是静默当默认 —— 「以为声明了其实没有」比报错更难查。
 * 2. **cluster 形态下权威值必需**：拿不到、或权威源自己也在用平台默认时，
 *    {@link assertClusterConfigured} 抛错。**不允许回落到单机路径** ——
 *    链上没有这条路，才是防漂移的结构性保证。
 */

/** 部署形态：`cluster` 微服务集群（系统配置表为权威）/ `standalone` 单机或私有化单系统 */
export type DeployMode = 'cluster' | 'standalone';

/** 形态声明环境变量 */
export const DEPLOY_MODE_ENV = 'DEPLOY_MODE';

/** 合法取值（区分大小写 —— 拼错即拒绝启动，不做大小写容错） */
export const DEPLOY_MODES: readonly DeployMode[] = ['cluster', 'standalone'] as const;

/**
 * 权威配置值的来源（由 system-service 自报）：
 * - `system_configs`：配置表里真有人设过
 * - `env`：system-service 自己的环境变量
 * - `default`：**没人设过**，是平台内置默认 —— 集群形态下视为不合规
 */
export type ConfigSource = 'system_configs' | 'env' | 'default';

export interface DeployModeResolution {
  mode: DeployMode;
  /** `explicit` 显式声明 / `default` 未声明走平台默认 */
  source: 'explicit' | 'default';
  /** 判定依据，启动必打印 —— 回答「为什么是这个形态」 */
  reasons: string[];
}

/** 形态判定不合规（调用方据此 fail-fast 拒绝启动） */
export class DeployModeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeployModeError';
  }
}

/**
 * 判定当前部署形态。
 *
 * @throws DeployModeError 声明了非法值（拼错 / 大小写不对）
 */
export function resolveDeployMode(
  env: NodeJS.ProcessEnv = process.env,
): DeployModeResolution {
  const raw = (env[DEPLOY_MODE_ENV] || '').trim();

  if (!raw) {
    return {
      mode: 'cluster',
      source: 'default',
      reasons: [
        `${DEPLOY_MODE_ENV} 未设置 → 按集群形态运行（与 dev/prod 现状一致，系统配置表为权威）`,
        '单机 / 私有化单系统部署请显式设置 DEPLOY_MODE=standalone',
      ],
    };
  }

  if ((DEPLOY_MODES as readonly string[]).includes(raw)) {
    return {
      mode: raw as DeployMode,
      source: 'explicit',
      reasons: [`${DEPLOY_MODE_ENV}=${raw}（显式声明）`],
    };
  }

  throw new DeployModeError(
    `${DEPLOY_MODE_ENV}=${raw} 不是合法值（仅支持 ${DEPLOY_MODES.join(' / ')}，区分大小写）—— ` +
      '拼错不会静默按默认值运行，请修正后重启；单机部署请设为 standalone。',
  );
}

/**
 * cluster 形态闸门：权威值必须真的来自「有人配过」。
 *
 * 为什么连 `source==='default'` 也要拦：那意味着 system-service 自己也在用平台默认，
 * 集群里其实没人配过路径 —— 此时放行等于让所有服务静默使用单机默认路径（数据分裂）。
 *
 * @param source system-service 自报的来源；`undefined` = 根本没取到值
 * @param label  配置用途（用于报错文案，如「上传根目录」）
 * @throws DeployModeError 不合规
 */
export function assertClusterConfigured(
  source: ConfigSource | undefined,
  label = '数据目录',
): void {
  if (source === 'system_configs' || source === 'env') return;

  if (source === 'default') {
    throw new DeployModeError(
      `集群形态下「${label}」的权威源未配置：system-service 返回的是平台默认值，` +
        '说明集群里没有人真正设过该路径 —— 继续启动会让所有服务静默改用单机默认路径（数据分裂）。' +
        '请在系统管理页面配置后重启，或显式声明 DEPLOY_MODE=standalone。',
    );
  }

  throw new DeployModeError(
    `集群形态下未能取得「${label}」的权威值（system-service 不可达 / 未返回路径）—— ` +
      '不允许回落到单机默认路径。请检查 system-service 与 INTERNAL_API_KEY，' +
      '或显式声明 DEPLOY_MODE=standalone。',
  );
}

/** 启动日志用：一句话说清形态、来源与依据 */
export function describeDeployMode(res: DeployModeResolution): string {
  const tag = res.source === 'explicit' ? '显式声明' : '平台默认';
  return `部署形态=${res.mode}（${tag}）：${res.reasons.join('；')}`;
}
