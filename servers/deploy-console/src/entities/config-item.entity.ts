import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  Unique,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/** 配置作用域（优先级由低到高，后者覆盖前者） */
export const CONFIG_SCOPES = ['global', 'env', 'module'] as const;
export type ConfigScope = (typeof CONFIG_SCOPES)[number];

/**
 * 配置层（2026-10-10 引入，对应「平台边界与配置中心」设计 P0-1）。
 *
 * 为什么要这一维：此前「哪些键能下发、谁能消费」由代码常量 `RESERVED_LOCAL_KEYS`
 * 决定，平台每加一类能力都要改代码重新发布。改为数据维度后，**新增能力只要落一条
 * 带 layer 的配置行**，收发策略即得，不必再动代码。
 *
 * | 层 | 语义 | 能否下发到服务 `.env.generated` | 谁来消费 |
 * |---|---|---|---|
 * | `bootstrap` | 引导键：DB / Redis / 主密钥来源 | ❌ 永不（鸡生蛋：读配置中心前它就得在） | 进程环境 / `.env.bootstrap` |
 * | `infra` | 基础设施：端口 / 路径 / 主机 / TTL | ✅（下发前建议校验连通性） | 服务进程 |
 * | `app` | 应用业务配置与密钥（**默认层**） | ✅ | 服务进程 |
 * | `platform` | 平台自身行为（`PLATFORM_*`） | ❌ | console **进程内拉取**，不落盘 |
 */
export const CONFIG_LAYERS = ['bootstrap', 'infra', 'app', 'platform'] as const;
export type ConfigLayer = (typeof CONFIG_LAYERS)[number];

/** 值类型（保存时按此校验口径，避免"配了个不像端口的 PORT"静默生效） */
export const CONFIG_VALUE_TYPES = ['string', 'number', 'bool', 'json', 'port', 'path'] as const;
export type ConfigValueType = (typeof CONFIG_VALUE_TYPES)[number];

/**
 * 生效方式（当前仅作声明与提示用，**不改变现有"下发后重启生效"行为**）。
 * `immediate` 是后续热更新能力的约定位，先落字段避免将来再改表。
 */
export const CONFIG_APPLY_MODES = ['restart', 'immediate', 'manual'] as const;
export type ConfigApplyMode = (typeof CONFIG_APPLY_MODES)[number];

/**
 * 配置项。
 *
 * 三级作用域：
 * - `global`：全局默认（`envId=''`、`moduleKey=''`）
 * - `env`   ：环境级（`envId` 有值、`moduleKey=''`）
 * - `module`：模块级（`envId` 与 `moduleKey` 均有值）
 *
 * **为什么用空串而不是 NULL 表示"不适用"**：MySQL 唯一索引中 NULL 互不相等，
 * 用 NULL 会让同一条全局配置被重复插入多次，唯一约束形同虚设。
 *
 * 密钥（`isSecret`）的 value 存密文，格式 `iv:authTag:ciphertext`（均 base64），
 * 明文永不落库、永不回显。
 */
@Entity('config_items')
@Unique(['scope', 'envId', 'moduleKey', 'key'])
export class ConfigItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 16, comment: '作用域 global/env/module' })
  scope: string;

  @Column({ type: 'varchar', length: 64, default: '', comment: "环境 ID（global 时为 ''）" })
  @Index()
  envId: string;

  @Column({ type: 'varchar', length: 64, default: '', comment: "模块 key（非 module 时为 ''）" })
  @Index()
  moduleKey: string;

  @Column({ type: 'varchar', length: 128, comment: '配置键' })
  key: string;

  /** 明文值；isSecret 时为 `iv:authTag:ciphertext` 密文 */
  @Column({ type: 'text', comment: '配置值（密钥为密文）' })
  value: string;

  @Column({ type: 'boolean', default: false, comment: '是否密钥（加密存储、页面掩码）' })
  isSecret: boolean;

  @Column({ type: 'boolean', default: true, comment: '是否启用' })
  enabled: boolean;

  /**
   * 配置层（2026-10-10 新增）：bootstrap / infra / app / platform，语义见 {@link CONFIG_LAYERS}。
   *
   * ⚠️ 存量兼容：`synchronize` 加列时存量行会被填成默认值 `app`，而其中混杂着
   * `MYSQL_*` 这类**必须从 bootstrap 层读、永不下发**的键。故：
   * ① 迁移脚本 `scripts/config-layer-backfill.sql` 必须按保留键名单回填 layer；
   * ② 下发判定同时保留 `isReservedLocalKey()` 兜底（双保险）——即使没回填，行为也不变。
   * 缺任何一条都会把 DB 密码写进服务的 `.env.generated`。
   */
  @Column({ type: 'varchar', length: 16, default: 'app', comment: '层 bootstrap/infra/app/platform' })
  @Index()
  layer: string;

  @Column({ type: 'varchar', length: 16, default: 'string', comment: '值类型 string/number/bool/json/port/path' })
  valueType: string;

  @Column({ type: 'varchar', length: 16, default: 'restart', comment: '生效方式 restart/immediate/manual' })
  applyMode: string;

  /** 是否允许下发到服务进程；`false` = 只存在于配置中心，供进程内拉取或人工查阅 */
  @Column({ type: 'boolean', default: true, comment: '是否可下发（false=仅进程内/人工消费）' })
  deliverable: boolean;

  /**
   * 校验规则（JSON）：`{ pattern?, enum?: string[], min?: number, max?: number }`。
   * 空 = 不校验。保存时由 `validateConfigValue` 统一把关，出错即时 400而非运行期炸。
   */
  @Column({ type: 'json', nullable: true, comment: '校验规则 {pattern?,enum?,min?,max?}' })
  validators?: { pattern?: string; enum?: string[]; min?: number; max?: number } | null;

  /**
   * 加密该值所用的主密钥代次（2026-10-10 新增，为密钥轮换预留）。
   * 当前恒为 `1`；将来轮换时新写入的项用新代次，据此可分批重加密、且能判断"还有多少项待轮换"。
   */
  @Column({ type: 'int', default: 1, comment: '主密钥代次（密钥轮换用，当前恒为 1）' })
  keyVersion: number;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: '说明' })
  description?: string;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '最后编辑人' })
  updatedBy?: string;

  @CreateDateColumn({ type: 'datetime', precision: 6, comment: '创建时间' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6, comment: '更新时间' })
  updatedAt: Date;
}
