import { Entity, PrimaryColumn, Column, Index } from 'typeorm';

/**
 * 审批单状态。
 *
 * `cancelled` 与 `rejected` **不是同义词**：
 *  - `rejected` = 有人看过并**否决**（reviewer 是决策者，comment 是判断理由）
 *  - `cancelled` = 这单**不再有决策对象**（流水线实例已丢失 / 流程作废），
 *    不代表任何人的判断，不触发恢复也不触发终止
 * 之所以必须独立，是因为把孤儿单塞进 `rejected` 会污染「驳回率」这类基于
 * 人工否决的统计口径。
 */
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

/**
 * 发布审批单（prod 门禁的留痕记录）。
 *
 * 与 deploy_pipelines 一对一关联：prod 提交被阻断时流水线进入
 * `pending-approval`，审批单独立记录提交人/审批人/意见/时间，满足
 * 「未审批的 prod 发布提交应被阻断并留记录」的验收。
 *
 * 时间戳用 bigint（毫秒），与 deploy_pipelines.startTime 对齐，便于排序。
 */
@Entity('deploy_approvals')
export class DeployApprovalEntity {
  @PrimaryColumn({ type: 'varchar', length: 64, comment: '审批单 ID（${Date.now()}-${rand}）' })
  id: string;

  @Column({ type: 'varchar', length: 64, comment: '关联流水线 ID' })
  @Index()
  pipelineId: string;

  /**
   * 审批节点 key（P0：审批从「发布前置门禁」升级为**节点**，design D8）。
   *
   * - 为空 = 流水线级门禁单（历史语义：提交即阻断，一条流水线至多一张）；
   * - 非空 = 节点级审批单，同一 `(pipelineId, nodeKey)` 至多一张 pending，
   *   批准后引擎**从该节点之后继续**（已完成的节点不重跑）。
   *
   * 节点 key 同时是「挂起态恢复锚点」：实例 `stage` 记的是当前节点，
   * 故服务重启后也能据此续跑，无需额外列。
   */
  @Column({ type: 'varchar', length: 32, nullable: true, comment: '审批节点 key（空=流水线级门禁）' })
  @Index()
  nodeKey?: string;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '审批节点展示名（如「发布确认」）' })
  nodeLabel?: string;

  @Column({ type: 'varchar', length: 16, comment: '环境' })
  @Index()
  env: string;

  @Column({ type: 'varchar', length: 64, comment: '模块 key' })
  @Index()
  moduleKey: string;

  @Column({ type: 'varchar', length: 16, default: 'direct', comment: '模式 direct/grayscale' })
  mode: string;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '来源 Git 分支' })
  gitBranch?: string;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '目标 commit（短哈希）' })
  commitId?: string;

  /** 提交人（发起发布请求的人） */
  @Column({ type: 'varchar', length: 64, comment: '提交人' })
  operator: string;

  @Column({ type: 'varchar', length: 16, default: 'pending', comment: '状态 pending/approved/rejected/cancelled' })
  @Index()
  status: ApprovalStatus;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '审批人' })
  reviewer?: string;

  @Column({ type: 'text', nullable: true, comment: '审批意见' })
  comment?: string;

  @Column({ type: 'bigint', nullable: true, comment: '审批时间（毫秒）' })
  reviewedAt?: number;

  @Column({ type: 'bigint', comment: '提交时间（毫秒）' })
  createdAt: number;

  /**
   * 审批来源通道（卡② · deploy_approvals 加 3 列）。
   * 历史行由 DB DEFAULT 'console' 回填。
   *
   * 过期（`expiresAt`）与换会话次数（`wecomSessionCount`）是 2026-11-06
   * 鉴权时效收口时补的两列，见 tech-design-wecom-approval-lifecycle.md。
   */
  @Column({
    type: 'varchar', length: 16, default: 'console', name: 'channel',
    comment: '审批来源通道 console/mcp/wecom',
  })
  channel: string;

  /** 审批人外部身份 ID（企微 userid）；console/MCP 通道为空 */
  @Column({
    type: 'varchar', length: 64, nullable: true, name: 'identity_external_id',
    comment: '审批人外部身份 ID（企微 userid）',
  })
  identityExternalId?: string | null;

  /** 审批来源 IP（异常追溯用） */
  @Column({
    type: 'varchar', length: 64, nullable: true, name: 'source_ip',
    comment: '审批来源 IP',
  })
  sourceIp?: string | null;

  /**
   * 企微通道**最近一次**换平台会话的时间（毫秒）。非空 = 该单换过至少一次。
   *
   * 只用于展示与排障（「最后一次是什么时候换的」），**不再承担拦截语义** ——
   * 一次性已经放开为「≤3 次」，次数判定见 `wecomSessionCount`。
   */
  @Column({
    type: 'bigint', nullable: true, name: 'wecom_session_issued_at',
    comment: '企微换平台会话最近一次时间（毫秒）',
  })
  wecomSessionIssuedAt?: number | null;

  /**
   * 企微通道换平台会话的**已用次数**（上限见 `WecomSessionService.MAX_EXCHANGES`）。
   *
   * 🔴 为什么从「一次性」放开成「有限次」：一次性把「手滑关掉页面 / 换个设备再看」
   * 全部变成死路，而票据本身只有 15 分钟写窗口、会话只有 30 分钟 ——
   * 真正的风险不是「换了几次」，而是「票据被反复兑换成长会话」。
   * 3 次既能覆盖人的正常重试，又把滥用面钉死在 3 个 30 分钟窗口内。
   *
   * 🔴 次数由 DB 原子更新保证：
   * `UPDATE ... SET wecom_session_count = wecom_session_count + 1
   *   WHERE id = ? AND wecom_session_count < 3`，
   * affectedRows=0 即用尽 → 拒绝。**不先查后写**，并发两次只会有一次成功。
   */
  @Column({
    type: 'int', default: 0, name: 'wecom_session_count',
    comment: '企微换平台会话已用次数（上限 3）',
  })
  wecomSessionCount: number;

  /**
   * 审批单超时作废时刻（毫秒）。NULL = 不过期。
   *
   * 🔴 只对新单写入（`createdAt + APPROVAL_TTL_MS`），**历史单不回填** ——
   * 回填会上线瞬间把一批在途 pending 单按「已过期」清掉。
   *
   * 作废由 `ApprovalExpiryService` 定时扫描，走 `PipelineService.cancel`
   * （内含 CAS + 流水线联动 + 双审计），**不另写一套作废 SQL**。
   */
  @Column({
    type: 'bigint', nullable: true, name: 'expires_at',
    comment: '审批单超时作废时刻（毫秒；NULL=不过期）',
  })
  @Index()
  expiresAt?: number | null;
}
