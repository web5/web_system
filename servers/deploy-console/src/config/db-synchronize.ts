import { Logger } from '@nestjs/common';

/**
 * 主库 `synchronize` 开关的唯一定夺处（诊断 #19）。
 *
 * 背景：`app.module.ts` 里硬编码 `synchronize: true` —— 服务**每次启动**都会拿实体
 * 元数据去对齐表结构（加列/改列/建表），一个实体字段写错就是一次静默 DDL。
 *
 * 已确认的事实（决定风险等级，别凭印象）：
 * - deploy-console **只在 dev 机运行**（prod 无该进程），作用对象是 dev 运维库
 * - 云库（prod 指针读源）由 `CloudDbService` 单独建连接，那里**已经是** `synchronize: false`
 *
 * 所以风险不是「改坏生产表」，而是：
 * ① 哪天把 console 部署到 prod（或指向别的库）就会自动 DDL；
 * ② dev 库的表结构变更不可追溯（没人写 migration，出事只能翻提交历史）。
 *
 * 取舍：**不引入 migrations 体系**（当前库已是 synchronize 建出来的，补 baseline 迁移
 * 风险大于收益），改为「默认保持现状 + 一条环境变量关掉 + 远端库自动拒绝」。
 * 这样止血成本为零，想收紧时一个开关即可。
 */

/** 本机回环地址：只有这些才允许默认自动建表 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

export interface SynchronizeDecision {
  /** 最终是否开启自动建表 */
  enabled: boolean;
  /** 为何这么定（启动日志要看得到，否则排障时又是一团雾） */
  reason: 'explicit-on' | 'explicit-off' | 'production' | 'remote-host' | 'default-local';
}

/**
 * 定夺规则（优先级从高到低）：
 * 1. `DB_SYNCHRONIZE` 显式指定 → 无条件听它的（'false'/'0'/'no' 视为关）
 * 2. `NODE_ENV=production` → 关
 * 3. 连的是非回环地址（远端库）→ 关
 * 4. 其余（本地/无 NODE_ENV）→ 开（保持既有行为，不影响 dev 启动）
 */
export function resolveSynchronize(
  cfg: { get: (key: string) => string | undefined },
  env: NodeJS.ProcessEnv = process.env,
): SynchronizeDecision {
  const raw = (cfg.get('DB_SYNCHRONIZE') ?? env.DB_SYNCHRONIZE ?? '').trim().toLowerCase();
  if (raw) {
    const off = ['false', '0', 'no', 'off'].includes(raw);
    return { enabled: !off, reason: off ? 'explicit-off' : 'explicit-on' };
  }

  if ((env.NODE_ENV || '').trim() === 'production') {
    return { enabled: false, reason: 'production' };
  }

  const host = (cfg.get('MYSQL_HOST') ?? env.MYSQL_HOST ?? '').trim().toLowerCase();
  if (host && !LOCAL_HOSTS.has(host)) {
    return { enabled: false, reason: 'remote-host' };
  }

  return { enabled: true, reason: 'default-local' };
}

/** 启动日志：开关状态必须显式可见，不能靠读代码才知道 */
export function logSynchronizeDecision(
  decision: SynchronizeDecision,
  host: string,
  database: string,
): void {
  if (decision.enabled) {
    new Logger('TypeORM').warn(
      `synchronize=true（自动建表）→ ${host}/${database}，` +
        `启动时会按实体对齐表结构。生产/远端库请设 DB_SYNCHRONIZE=false`,
    );
    return;
  }
  const why: Record<SynchronizeDecision['reason'], string> = {
    'explicit-off': 'DB_SYNCHRONIZE 显式关闭',
    production: 'NODE_ENV=production',
    'remote-host': `连接的是非回环地址 ${host}（远端库不允许自动 DDL）`,
    'explicit-on': '',
    'default-local': '',
  };
  new Logger('TypeORM').log(
    `synchronize=false（不自动建表）→ ${host}/${database}：${why[decision.reason]}`,
  );
}
