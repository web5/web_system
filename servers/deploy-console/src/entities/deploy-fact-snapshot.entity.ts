import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

/** 事实类型：采的是什么 */
export type FactKind = 'version' | 'dir' | 'process' | 'port';

/**
 * 事实状态（采集后判定）。
 *
 * - `ok`：有期望且一致
 * - `drift`：有期望但**不一致** —— 这才是要告警的
 * - `missing`：期望有、线上没采到（目录不存在 / 进程不在 / 端口没监听）
 * - `unknown`：采到了，但**没人说过它应该是什么**（无期望态）—— 不算漂移，但不能假装 ok
 * - `error`：采集失败（SSH 错 / 超时 / 命令被拒），与漂移区分开：漂移是业务问题，error 是采集机制问题
 * - `skipped`：该环境未启用、该项未配置（如没登记服务），或**该事实对这个对象不适用**
 *   （典型：`shell` 这类 index.html 入口型产物压根没有 SystemJS 版本指针 ——
 *   首版把它报成缺失，结果是一条**永久假告警**，会把真漂移淹没，故改为判定不适用）
 */
export type FactStatus = 'ok' | 'drift' | 'missing' | 'unknown' | 'error' | 'skipped';

/** 需要人盯的状态（漂移清单的取数口径） */
export const FACT_ALERT_STATUSES: FactStatus[] = ['drift', 'missing', 'error'];

/**
 * 环境事实快照（Fact 层 v1，对应《console 建设方案》P0-6）。
 *
 * 一行 = 一个「事实」，不是一行一次采集：
 * 便于按对象（模块 / 服务）下钻与保留历史趋势，同批次用 `batchId` 串起来。
 *
 * 与既有巡检表的分工：
 * - `deploy_cleanup_scan`：远端**产物**的清理候选观测
 * - `config_deliveries`：配置的**期望态**（含目标机回执 hash）
 * - 本表：**线上真实态**的通用采集 + 与期望态的比对结论
 */
@Entity('deploy_fact_snapshots')
@Index(['envId', 'kind', 'targetKey'])
@Index(['batchId'])
@Index(['envId', 'status'])
export class DeployFactSnapshotEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 一次采集批次（同批次的事实一起看，才能还原"当时线上什么样"） */
  @Column({ type: 'varchar', length: 36, comment: '采集批次 ID' })
  batchId: string;

  @Column({ type: 'varchar', length: 64, comment: '环境 envId' })
  envId: string;

  @Column({ type: 'varchar', length: 16, comment: '事实类型 version/dir/process/port' })
  kind: FactKind;

  /** 对象标识：前端模块 key 或后端服务 key */
  @Column({ type: 'varchar', length: 128, comment: '对象 key（模块 / 服务）' })
  targetKey: string;

  /** 实际采集的主机（本机写 `local`）：漂移时第一件事就是确认"看的是哪台机器" */
  @Column({ type: 'varchar', length: 128, default: 'local', comment: '采集主机' })
  host: string;

  /** 期望态（平台认为应该是什么）；没有则 NULL → 状态记 unknown，不假装 ok */
  @Column({ type: 'varchar', length: 255, nullable: true, comment: '期望值' })
  expected?: string | null;

  /** 真实态（线上实际是什么）；采集失败为 NULL，状态记 error */
  @Column({ type: 'varchar', length: 255, nullable: true, comment: '实际值' })
  actual?: string | null;

  @Column({ type: 'varchar', length: 16, comment: 'ok/drift/missing/unknown/error/skipped' })
  status: FactStatus;

  /**
   * 明细（已脱敏）：进程状态 / 文件数 / 端口集合等。
   *
   * ⚠️ 硬约束：**不得**落 `pm2 jlist` 的 `pm2_env` 全量 —— 里面是进程环境变量
   * （可能含数据库口令），落库等于把密钥写进事实表。只放白名单字段。
   */
  @Column({ type: 'json', nullable: true, comment: '明细（脱敏后）' })
  detail?: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 16, default: 'schedule', comment: '触发来源 schedule/manual' })
  trigger: 'schedule' | 'manual';

  @Column({ type: 'datetime', precision: 6, default: () => 'CURRENT_TIMESTAMP(6)' })
  collectedAt: Date;
}
