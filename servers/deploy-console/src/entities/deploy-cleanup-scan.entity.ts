import { Entity, PrimaryColumn, Column, Index } from 'typeorm';
import { AbstractEntity } from '@web-system/shared';

/**
 * 清理巡检留痕实体（诊断 #18 / #10 的观测配套）。
 *
 * 背景：`RetentionService`（数据保留）与 `RemoteArtifactCleanupService`（远端产物）
 * 都支持「只观测不删除」，但此前结果只在**响应与日志里** —— 关掉页面就没了。
 * 于是「这个开关到底会删什么」只能每次重跑，7 天对比更是无从谈起。
 *
 * 因此把每次巡检的结论落库：谁在什么时候、对哪个环境/组件、算出多少候选、
 * 其中多少因保护被留下、实际删了多少。删数据是不可逆的，观测记录本身必须可回溯。
 *
 * ⚠️ 与 `deploy_tasks` 的关系：这里**只记结论，不记过程**。
 * 真正的删除动作仍由各自的 service 执行，本表不参与控制流。
 */
@Entity('deploy_cleanup_scans')
export class DeployCleanupScanEntity extends AbstractEntity {
  @PrimaryColumn({ type: 'varchar', length: 64, comment: '巡检 ID（scan-${Date.now()}-${rand}）' })
  id: string;

  /**
   * 巡检类型：
   * - `retention`：数据保留（deploy_tasks / deploy_versions / audit_logs）
   * - `remote`：远端版本产物（<staticRoot>/static/modules/<key>/<env>/<commit>）
   */
  @Column({ type: 'varchar', length: 16, comment: '类型 retention/remote' })
  @Index()
  kind: string;

  /** 环境（dev / prod；retention 为库级巡检，记 '*'） */
  @Column({ type: 'varchar', length: 16, nullable: true, comment: '环境 dev/prod/*（* = 全库）' })
  @Index()
  env?: string;

  /** 组件（remote 为模块 key，多个用逗号连接；retention 为表名维度，记 '*'） */
  @Column({ type: 'varchar', length: 128, nullable: true, comment: '组件/模块 key，多个逗号连接' })
  component?: string;

  /** 结论状态：dry-run（只观测）| deleted（真删了）| skipped（配置非法/未启用）| error */
  @Column({ type: 'varchar', length: 16, comment: '状态 dry-run/deleted/skipped/error' })
  status: string;

  /** 是否只观测（true = 一条没删） */
  @Column({ type: 'boolean', default: true, comment: 'true=只观测未删除' })
  dryRun: boolean;

  /** 未执行/跳过的原因（如开关关闭、KEEP_DAYS 非法） */
  @Column({ type: 'varchar', length: 512, nullable: true, comment: '跳过原因' })
  reason?: string;

  /** 分维度汇总：retention 按表、remote 按模块 */
  @Column({ type: 'json', nullable: true, comment: '分维度汇总（表/模块 → 候选数、删除数、保护数）' })
  summary?: Array<{
    key: string;
    candidates: number;
    deleted?: number;
    protectedRows?: number;
    scanned?: number;
    note?: string;
  }>;

  /**
   * 候选清单（会被截断，见 `MAX_ITEMS`）。
   * 存它是为了回答「到底会删哪些」—— 只有数字的话，真出事时对不上号。
   */
  @Column({ type: 'json', nullable: true, comment: '候选清单（超上限截断）' })
  items?: string[];

  /** 候选数（冗余存一份，列表页排序/筛选不解析 JSON） */
  @Column({ type: 'int', default: 0, comment: '候选总数' })
  candidateCount: number;

  /** 实际删除数 */
  @Column({ type: 'int', default: 0, comment: '实际删除数' })
  deletedCount: number;

  /** 操作人（定时巡检为 system） */
  @Column({ type: 'varchar', length: 64, nullable: true, comment: '操作人' })
  operator?: string;

  /** 巡检时间（毫秒时间戳，业务时间） */
  @Column({ type: 'bigint', comment: '巡检时间（毫秒时间戳）' })
  @Index()
  scanTime: number;
}
