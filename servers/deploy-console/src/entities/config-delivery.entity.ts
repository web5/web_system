import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
} from 'typeorm';

/**
 * 配置下发记录（2026-10-10 引入，对应「平台边界与配置中心」设计 P0-3）。
 *
 * 解决什么：此前 `.env.generated` 由流水线脚本 `curl` 取走即完，**平台侧不知道发给了谁、
 * 内容是什么、目标机实际有没有落到这个内容**。于是出现两类查不出来的故障：
 * ① 配了但没生效（脚本没跑 / 被 204 跳过）；② 目标机文件内容与配置中心不一致（人工改过）。
 *
 * 本表记录的语义：
 * - 一行 = 一次**成功返回内容**的下发（含谁取的、取了多少键、内容 hash）；
 * - `result='empty'` 的也会记（没有 module 级条目 → 脚本保留现状），否则"为什么没下发"同样无证可查；
 * - 目标机回执写在同一行的 `reported_*` 字段上，据此算 `drift`（期望 hash vs 实际 hash）。
 *
 * 与漂移检测的关系：本表提供**期望态**，目标机上报提供**实际态**，比对即告警依据。
 */
@Entity('config_deliveries')
@Index(['envId', 'moduleKey'])
export class ConfigDeliveryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64, comment: '环境 ID' })
  @Index()
  envId: string;

  @Column({ type: 'varchar', length: 64, comment: '模块 / 服务 key' })
  moduleKey: string;

  /**
   * 取配置的来源 IP（由 `InternalGuardService` 透出）。
   * 记 IP 不记主机名：**排障时"哪台机器取走了 DB 密码"是第一手信息**，且内网 IP 敏感度低。
   */
  @Column({ type: 'varchar', length: 64, nullable: true, comment: '来源 IP' })
  host?: string | null;

  /** 下发的键数量（只记数量，**键名与值一律不入库** —— 本表只为对账服务） */
  @Column({ type: 'int', default: 0, comment: '下发的键数量' })
  keyCount: number;

  /**
   * 下发内容指纹：sha256（对**渲染后的整个文件内容**）。
   * 为什么不逐键 hash：目标机拿到的是最终文件，比对单位必须与交付单位一致。
   */
  @Column({ type: 'varchar', length: 64, nullable: true, comment: '下发内容 sha256' })
  contentHash?: string | null;

  /** delivered（有内容）/ empty（无可下发键，脚本保留现状） */
  @Column({ type: 'varchar', length: 16, comment: '结果 delivered/empty' })
  result: string;

  /**
   * `result='empty'` 时的原因：`no-module-scope`（该服务没声明要配置）/
   * `no-deliverable-key`（有 module 级条目但全是不可下发的键）。
   *
   * 为什么必须记：脚本拿到 204 会**静默保留目标机现状**，表现为"配了没生效"。
   * 没有这个区分时，排查只能靠猜；有了它，一眼能分辨是"没到这里"还是"被层过滤了"。
   */
  @Column({ type: 'varchar', length: 32, nullable: true, comment: '空下发原因 no-module-scope/no-deliverable-key' })
  emptyReason?: string | null;

  /** 发布运行实例 id（脚本侧 `RUN_ID`），为空表示非流水线来源（人工/服务自拉） */
  @Column({ type: 'varchar', length: 64, nullable: true, comment: '关联发布运行 id' })
  runId?: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '取配置方标识' })
  dispatchedBy?: string | null;

  // ── 以下为目标机回执 ──

  /** 目标机上报的实际文件 hash；`reported_*` 三个字段构成 drift 判定所需的最小集 */
  @Column({ type: 'varchar', length: 64, nullable: true, comment: '目标机上报的实际内容 sha256' })
  reportedHash?: string | null;

  @Column({ type: 'datetime', precision: 6, nullable: true, comment: '目标机上回报时间' })
  reportedAt?: Date | null;

  /**
   * 是否漂移：`reported_hash` 与最近一次下发不一致。
   * 由上报接口写入，**不参与实时查询过滤**（每次下发都可能变化），仅作为排障与巡检的快照判断。
   */
  @Column({ type: 'boolean', default: false, comment: '是否漂移（实际 hash ≠ 下发 hash）' })
  drift: boolean;

  @CreateDateColumn({ type: 'datetime', precision: 6, comment: '下发时间' })
  createdAt: Date;
}
