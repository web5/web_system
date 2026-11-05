/**
 * 数据库连接目标守卫 —— 防止后端微服务误连发布平台库并按实体 synchronize 建表。
 *
 * 上提自 `servers/content-hub/src/common/database-target.ts`（PR #558 首次落地），
 * 2026-11-05 起由 `@web-system/shared` 提供唯一实现，content-hub 与 mcp-gateway
 * 共用；两个服务的 app.module.ts 都只调用本模块，不再各自判断 NODE_ENV。
 *
 * ## 事故背景（2026-11-05 分叉诊断）
 *
 * 两个服务的 `app.module.ts` 原本都是：
 *   database: DB_DATABASE || 'web_system'
 *   synchronize: NODE_ENV !== 'production'
 * 两个开关互相独立：只要某个启动脚本 / 影子库演练把 DB_DATABASE 指到
 * `web_system_deploy` 或 `web_system_deploy_shadow`，而 NODE_ENV 不是 production，
 * TypeORM 就会**按当时的 entity 快照在那两个库里 CREATE TABLE**。
 * 实测 2026-10-26 13:14:05 两库同秒被建出 content_items / content_media /
 * content_pipelines / content_publications 四表（0 行、字段与主库互不相同），
 * 此后主库继续演进、两库冻结，形成永久 schema 分叉；2026-11-05 已 DROP 清理。
 *
 * ## 这条守卫钉死什么
 *
 * 1. **库名黑名单**：发布平台库与影子库一律拒绝启动，任何 NODE_ENV 都不放行。
 * 2. **库名白名单**：默认只认 `web_system`；其余库必须显式写进
 *    `DB_DATABASE_ALLOWLIST`（逗号分隔）才允许在非 production 下启动。
 * 3. **synchronize 与库名绑定**：只有「白名单内 ∧ 非 production」才允许自动建表；
 *    production 恒为 false，非白名单库在 production 下即便放行也绝不 synchronize。
 *
 * 为什么不直接硬拦所有非白名单库：prod 可能使用别名库且 NODE_ENV=production
 * （synchronize 本就关闭），硬拦会让线上启动失败。事故路径是「误连 + 自动建表」，
 * 守卫精确掐断这一组合，同时保留 production 只读连接的兼容性。
 *
 * 本模块是纯函数，不读 process.env、不打印日志，便于单测与变异验证。
 */

/** 业务主库（唯一默认目标） */
export const DEFAULT_DB_TARGET = 'web_system';

/** 额外允许库名的环境变量（逗号分隔，仅用于测试库 / 私有化别名库） */
export const DB_TARGET_ALLOWLIST_ENV = 'DB_DATABASE_ALLOWLIST';

/** 发布平台库与影子库：业务服务永远不该连接 */
export const FORBIDDEN_DB_TARGETS: readonly string[] = [
  'web_system_deploy',
  'web_system_deploy_shadow',
];

export class DatabaseTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseTargetError';
  }
}

export interface ResolveDbTargetInput {
  /** 原始 DB_DATABASE，空值回落默认 */
  database?: string | undefined;
  /** 原始 NODE_ENV */
  nodeEnv?: string | undefined;
  /** 原始 DB_DATABASE_ALLOWLIST，逗号分隔 */
  allowlist?: string | undefined;
}

export interface DbTargetResolution {
  database: string;
  synchronize: boolean;
  /** 是否命中白名单（含默认主库） */
  allowlisted: boolean;
  /** 判定依据，便于启动日志 / 排障 */
  reasons: string[];
}

function parseAllowlist(raw: string | undefined): string[] {
  if (!raw || !raw.trim()) return [];
  return Array.from(
    new Set(
      raw
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0 && item !== DEFAULT_DB_TARGET),
    ),
  );
}

/**
 * 解析本次启动的数据库目标；不合规直接抛错（fail fast，绝不带病启动）。
 */
export function resolveDbTarget(input: ResolveDbTargetInput): DbTargetResolution {
  const database = (input.database ?? '').trim() || DEFAULT_DB_TARGET;
  const nodeEnv = (input.nodeEnv ?? '').trim();
  const production = nodeEnv === 'production';
  const extra = parseAllowlist(input.allowlist);
  const allowed = [DEFAULT_DB_TARGET, ...extra];
  const reasons: string[] = [
    `DB_DATABASE=${database}`,
    `NODE_ENV=${nodeEnv || '<unset>'}`,
    `allowlist=[${allowed.join(',')}]`,
  ];

  // 1) 黑名单：发布平台 / 影子库在任何模式下都拒绝
  if (FORBIDDEN_DB_TARGETS.includes(database)) {
    throw new DatabaseTargetError(
      `拒绝启动：DB_DATABASE=${database} 是发布平台库/影子库，业务服务禁止连接。` +
        ` 2026-10-26 曾因误连 + synchronize 在这类库建出空壳 content_* 表（2026-11-05 已清理）。` +
        ` 请改回 ${DEFAULT_DB_TARGET}；确有特殊用途请检查启动脚本的 DB_DATABASE 来源。`,
    );
  }

  const allowlisted = allowed.includes(database);

  // 2) 非白名单 + 非 production：即将开启 synchronize，必须拒绝
  if (!allowlisted && !production) {
    throw new DatabaseTargetError(
      `拒绝启动：DB_DATABASE=${database} 不在白名单 [${allowed.join(', ')}]，` +
        `且 NODE_ENV=${nodeEnv || '<unset>'} 会开启 TypeORM synchronize（自动建表）。` +
        ` 改回 ${DEFAULT_DB_TARGET}，或显式设置 ${DB_TARGET_ALLOWLIST_ENV}=${database} 声明这是受控目标。`,
    );
  }

  // 3) 绑定：只有白名单内且非 production 才允许自动建表
  const synchronize = allowlisted && !production;
  reasons.push(
    synchronize
      ? 'synchronize=true（白名单主库 + 非 production）'
      : `synchronize=false（production=${production}，allowlisted=${allowlisted}，禁止自动建表）`,
  );

  return { database, synchronize, allowlisted, reasons };
}
