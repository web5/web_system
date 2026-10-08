import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

/**
 * 云数据库（**prod 数据真相源**）独立连接。
 *
 * 背景：`deploy-console` 跑在 dev 机（南京 / vpc-ljskd1kp），云数据库在广州 vpc-hiltvaat，
 * dev → 云库内网 **跨地域 + 跨 VPC 不通**，只能走公网（`gz-cdb-*.sql.tencentcdb.com`）。
 * 而 prod gateway 在广州 VPC 内、内网读云库 ⇒ 形成「平台写 dev 本机库 / prod 读云库」的分裂，
 * prod 发布后指针不生效（2026-09-30 基座事故的成因之一，当时靠人工同步指针）。
 *
 * 设计依据：specs/deploy-console-env-datasource/design.md
 *
 * 关键约束：
 * - **不用 Nest TypeORM 模块**：主连接 `synchronize: true`（自动建表），若云库沿用会拿本地
 *   实体去 **DDL 变更生产表**。这里显式 `synchronize: false`，且不给 entities。
 * - **懒连接**：未启用 / 连不上都不阻塞 console 启动；失败可按需重试。
 * - **只写不读业务**：镜像写用原生 SQL upsert（见 EnvSplitWriterService），不注册实体元数据。
 */
@Injectable()
export class CloudDbService implements OnModuleDestroy {
  private readonly logger = new Logger(CloudDbService.name);
  private ds: DataSource | null = null;
  private initTask: Promise<DataSource | null> | null = null;

  constructor(private readonly cfg: ConfigService) {}

  /** 总开关：false = 回到「人工同步指针」的现状 */
  get enabled(): boolean {
    return String(this.cfg.get('DEPLOY_CLOUD_DB_ENABLED') ?? '').toLowerCase() === 'true';
  }

  /** 严格模式：prod 数据写云库失败是否抛出（默认 true，见设计 §6 失败语义） */
  get strict(): boolean {
    return String(this.cfg.get('DEPLOY_CLOUD_DB_STRICT') ?? 'true').toLowerCase() !== 'false';
  }

  /**
   * 单次云库操作的**应用层硬超时**（默认 8s）。
   *
   * 为什么不能只靠驱动超时：实测（2026-10-08）公网链路被阻断时，mysql2 单次 connect
   * 会挂到 **31s** 才报错（`connectTimeout` 在「SYN 无响应/被拒」场景不生效），
   * 两次重试即 63s —— 发布任务会长时间卡住且失败反馈延迟。故在应用层再兜一层。
   */
  get queryTimeoutMs(): number {
    return Number(this.cfg.get('DEPLOY_CLOUD_DB_QUERY_TIMEOUT') || 8000);
  }

  /** 取连接（未启用返回 null；失败返回 null 并记 error，允许下次重试） */
  async getDataSource(): Promise<DataSource | null> {
    if (!this.enabled) return null;
    if (this.ds?.isInitialized) return this.ds;
    if (!this.initTask) {
      this.initTask = this.init()
        .catch((e: Error) => {
          this.logger.error(`云数据库（prod 真相源）连接失败：${e.message}`);
          return null;
        })
        .then((d) => {
          // 允许后续调用重试（公网偶发抖动不应永久降级）
          this.initTask = null;
          return d;
        });
    }
    return this.initTask;
  }

  private async init(): Promise<DataSource | null> {
    const host = this.cfg.get('DEPLOY_CLOUD_DB_HOST');
    const username = this.cfg.get('DEPLOY_CLOUD_DB_USER');
    const password = this.cfg.get('DEPLOY_CLOUD_DB_PASSWORD');
    const database = this.cfg.get('DEPLOY_CLOUD_DB_NAME') || 'web_system_deploy';
    const port = Number(this.cfg.get('DEPLOY_CLOUD_DB_PORT') || 3306);

    if (!host || !username || !password) {
      this.logger.error(
        '云数据库镜像写已启用但连接配置不全（DEPLOY_CLOUD_DB_HOST/USER/PASSWORD），' +
          'prod 指针将不会同步到云库 → 请补齐配置或设 DEPLOY_CLOUD_DB_ENABLED=false',
      );
      return null;
    }

    const ds = new DataSource({
      type: 'mysql',
      host,
      port,
      username,
      password,
      database,
      // ⚠️ P0：绝不能给 entities / synchronize。给 entities 会让 TypeORM 在需要时
      // 用本地实体元数据对齐（乃至 synchronize 时 DDL 变更）生产表。
      entities: [],
      synchronize: false,
      charset: 'utf8mb4',
      timezone: 'local',
      // 公网（南京 → 广州，实测单查询 ~36ms、握手 ~180ms）：放宽超时并保活
      extra: {
        connectTimeout: 10_000,
        enableKeepAlive: true,
        keepAliveInitialDelay: 10_000,
        connectionLimit: 3,
      },
    });
    // 建连同样要兜应用层超时：公网握手异常时会长时间挂起
    await withTimeout(
      ds.initialize(),
      this.queryTimeoutMs,
      `云数据库建连超时（>${this.queryTimeoutMs}ms）`,
    );
    this.ds = ds;
    this.logger.log(`云数据库（prod 真相源）已连接：${host}:${port}/${database}`);
    return ds;
  }

  /** 执行原生 SQL；瞬时错误（超时/连接断开）自动重试 1 次 */
  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
    let lastErr: Error | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const ds = await this.getDataSource();
      if (!ds) throw new Error('云数据库不可用（未启用或连接失败），prod 指针未同步');
      try {
        return (await withTimeout(
          ds.query(sql, params),
          this.queryTimeoutMs,
          `云数据库查询超时（>${this.queryTimeoutMs}ms）`,
        )) as T;
      } catch (e) {
        lastErr = e as Error;
        // 超时同样按瞬时错误处理：公网抖动重试一次即可恢复
        if (attempt === 2 || !isTransient(e)) break;
        this.logger.warn(`云数据库查询失败，重试 1 次：${lastErr.message}`);
        await sleep(500);
      }
    }
    throw lastErr ?? new Error('云数据库查询失败（未知原因）');
  }

  /** 连通性预检（发布前探活 / 运维排查用） */
  async ping(): Promise<{ ok: boolean; enabled: boolean; latencyMs?: number; error?: string }> {
    if (!this.enabled) return { ok: false, enabled: false, error: '未启用（DEPLOY_CLOUD_DB_ENABLED≠true）' };
    const t = Date.now();
    try {
      await this.query('SELECT 1');
      return { ok: true, enabled: true, latencyMs: Date.now() - t };
    } catch (e) {
      return { ok: false, enabled: true, latencyMs: Date.now() - t, error: (e as Error).message };
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.ds?.isInitialized) {
      await this.ds.destroy().catch(() => undefined);
      this.ds = null;
    }
  }
}

/** 公网场景的瞬时错误：超时、连接被断、握手丢失 —— 重试有意义 */
function isTransient(e: unknown): boolean {
  const code = String((e as { code?: string })?.code || '');
  if (['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'PROTOCOL_CONNECTION_LOST', 'EPIPE'].includes(code)) {
    return true;
  }
  // 应用层超时（withTimeout 抛的）：底层可能还在挂，重试一次通常能恢复
  return /超时/.test(String((e as Error)?.message || ''));
}

/** 应用层硬超时兜底：驱动超时在「SYN 无响应」场景不生效（实测挂 31s） */
function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(msg)), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
