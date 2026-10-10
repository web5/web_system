import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
} from 'typeorm';

/**
 * 配置变更历史（2026-10-10 引入，对应「平台边界与配置中心」设计 P0-2）。
 *
 * 解决什么：此前配置中心只有「当前值」和「发布时快照」，缺**单键变更历史** ——
 * 出现「这个值什么时候被谁改过 / 改之前是多少」时只能翻提交历史或干脆无证可查，
 * 也无法做单键回滚（只能整组回退到某个版本快照）。
 *
 * 为什么明文只存非密钥、且密钥存的是密文：
 * - 目的是**可回滚与可追溯**，不是再复制一份明文；
 * - 密钥行的 `beforeValue` / `afterValue` 存的是 `config_items.value` 里的**密文**
 *   （`iv:tag:data`），回滚时原样写回即可，**全程不需要解密**，明文零暴露面。
 *
 * ⚠️ 与 `config_snapshots` 分工：快照是**发布版本维度的全量切片**（跟着版本走），
 * 本表是**键值维度的增量流水**（跟着每次保存走）。两者不可互相替代。
 */
@Entity('config_revisions')
@Index(['scope', 'envId', 'moduleKey', 'key'])
export class ConfigRevisionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * 关联的配置项 id。
   *
   * ⚠️ 刻意**不做外键约束**：配置项被删除后，历史仍必须能查（"删了谁、删之前是什么"）。
   * 因此下面冗余了 scope/envId/moduleKey/key 四个字段。
   */
  @Column({ type: 'varchar', length: 64, comment: '关联 config_items.id（无外键，删后仍需可查）' })
  @Index()
  itemId: string;

  @Column({ type: 'varchar', length: 16, comment: '作用域 global/env/module' })
  scope: string;

  @Column({ type: 'varchar', length: 64, default: '', comment: '环境 ID' })
  envId: string;

  @Column({ type: 'varchar', length: 64, default: '', comment: '模块 key' })
  moduleKey: string;

  @Column({ type: 'varchar', length: 128, comment: '配置键' })
  key: string;

  /** create（新建）/ update（改值）/ delete（删除） */
  @Column({ type: 'varchar', length: 16, comment: '变更类型 create/update/delete' })
  action: string;

  /** 变更前的值；密钥为密文，`delete` 时有值，`create` 时为 null */
  @Column({ type: 'text', nullable: true, comment: '变更前的值（密钥为密文，明文永不入表）' })
  beforeValue?: string | null;

  /** 变更后的值；密钥为密文，`delete` 时为 null */
  @Column({ type: 'text', nullable: true, comment: '变更后的值（密钥为密文）' })
  afterValue?: string | null;

  @Column({ type: 'boolean', default: false, comment: '是否密钥（决定 before/after 存的是密文）' })
  isSecret: boolean;

  /**
   * 值指纹：sha256 前 12 位 hex。**密钥与非密钥口径一致**（都对要存的那个值做 hash），
   * 因此页面可以安全地展示"变了 / 没变"并做 diff 提示，而不必触碰明文。
   */
  @Column({ type: 'varchar', length: 16, nullable: true, comment: '变更前值指纹（sha256 前 12 位）' })
  beforeFingerprint?: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true, comment: '变更后值指纹（sha256 前 12 位）' })
  afterFingerprint?: string | null;

  /** 变更原因/说明（可选；prod 密钥变更建议必填，便于事后复盘） */
  @Column({ type: 'varchar', length: 255, nullable: true, comment: '变更原因' })
  reason?: string | null;

  /** 关联的审批单 id（将来 prod 密钥变更走审批时用；当前恒为空） */
  @Column({ type: 'varchar', length: 64, nullable: true, comment: '关联审批单 id' })
  approvalId?: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '操作人' })
  changedBy?: string;

  @CreateDateColumn({ type: 'datetime', precision: 6, comment: '变更时间' })
  createdAt: Date;
}
