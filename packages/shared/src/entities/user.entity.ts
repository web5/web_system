import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';
import { BigIntEntity } from './abstract.entity';

/**
 * 统一用户实体（权威定义，单一来源）。
 * 取代 auth-service / user-service / todo-service 中重复的本地定义。
 * 各服务统一 import { User } from '@web-system/shared'。
 *
 * 物理表名：users（snake_case 由命名策略保证列名，如 mp_openid / oa_openid）。
 * 可空字段的 TS 类型沿用原定义（string，非 string|null），以兼容现有 DTO 返回类型。
 */
/** 圆角风格三档（口径：specs/radius-style-dual/page-spec.md） */
export type UiRadiusStyle = 'soft' | 'crisp' | 'sharp';

/** 界面偏好档位白名单（服务端校验与两端取值共用，禁止各写一份） */
export const UI_RADIUS_STYLES: UiRadiusStyle[] = ['soft', 'crisp', 'sharp'];

/**
 * 界面偏好（跟账号走）。
 *
 * 同步范围：portal / 小程序（用户端）；admin 系为内部工具，保持各端本地独立。
 * 口径：specs/radius-style-dual/page-spec-pref-sync.md
 */
export interface UserPreferences {
  /** 圆角风格：soft 柔和（默认）/ crisp 清爽 / sharp 直角 */
  radiusStyle?: UiRadiusStyle;
}

/**
 * 手机号唯一索引（具名 uk_users_phone）。
 *
 * 为什么必须具名且与迁移一致：迁移 0014_mp 建的是 `ADD UNIQUE KEY uk_users_phone`，
 * 若这里改用 `@Column({ unique: true })`，TypeORM 会另起一个哈希名 IDX_xxx，
 * synchronize 判定为「索引不匹配」→ 反复 DROP/BUILD 抖动。
 *
 * 为什么必须登记：不在实体里的索引会被 synchronize 按实体元数据反向 DROP
 * （synchronize 以实体为准对齐 schema，不认手工 DDL）。
 */
@Index('uk_users_phone', ['phone'], { unique: true })
@Entity('users')
export class User extends BigIntEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true, comment: '用户 ID' })
  id: number;

  @Column({ type: 'varchar', length: 50, unique: true, comment: '登录用户名' })
  username: string;

  @Column({ type: 'varchar', length: 100, nullable: true, comment: '密码哈希（NULL 表示未设置）' })
  password: string;

  @Column({ type: 'varchar', length: 100, unique: true, nullable: true, comment: '邮箱' })
  email: string;

  /** 手机号。唯一索引见类级 @Index('uk_users_phone')，此处不再重复声明 unique */
  @Column({ type: 'varchar', length: 20, nullable: true, comment: '手机号' })
  phone: string;

  @Column({ type: 'varchar', length: 50, nullable: true, comment: '昵称' })
  nickname: string;

  @Column({ type: 'varchar', length: 500, nullable: true, comment: '头像 URL' })
  avatar: string;

  /** 性别：male 男性 / female 女性 / unknown 未知 */
  @Column({ type: 'varchar', length: 10, default: 'unknown', comment: '性别 male/female/unknown' })
  gender: 'male' | 'female' | 'unknown';

  /** 小程序 openid */
  @Index()
  @Column({ type: 'varchar', length: 100, nullable: true, name: 'mp_openid', comment: '微信小程序 openid' })
  mpOpenid: string;

  /** 公众号 openid */
  @Index()
  @Column({ type: 'varchar', length: 100, nullable: true, name: 'oa_openid', comment: '微信公众号 openid' })
  oaOpenid: string;

  /** 状态：active 正常 / inactive 未激活 / banned 封禁 */
  @Column({ type: 'varchar', length: 20, default: 'active', comment: '状态 active/inactive/banned' })
  status: 'active' | 'inactive' | 'banned';

  /**
   * 合并到的目标账号 id（非空表示该账号已被合并弃用）。
   *
   * 由 migrations/0014_mp_account_phone_email.sql 建立。读写方是 auth-service 的
   * 裸 SQL（account.service.ts:218/258），**不在实体里登记就会被 synchronize 反向
   * DROP** —— synchronize 以实体元数据为准对齐 schema，不认手工 DDL：
   * 跑迁移补上 → 服务重启 synchronize=true → 又 DROP 掉，来回抖动。
   *
   * 受影响的服务：user-service（手写清单）/ auth-service、todo-service（glob 扫描），
   * 三者都连 web_system 库。dev/prod 为 NODE_ENV=production（synchronize=false）不受影响；
   * 本机为 development，本字段登记后 synchronize 会自动补齐（此前本机该列一直缺失）。
   *
   * 类型：与 id 保持一致用 number；注意 mysql 驱动对 bigint 实际返回 string。
   */
  @Column({
    type: 'bigint',
    unsigned: true,
    nullable: true,
    name: 'merged_to',
    comment: '合并到的目标账号 id（非空表示该账号已被合并弃用）',
  })
  mergedTo: number | null;

  /** 角色列表，如 ['user','admin'] */
  @Column({ type: 'json', nullable: true, comment: '角色列表' })
  roles: string[];

  /**
   * 归属系统（IAM 一期）：portal（C 端）/ admin（运营）/ deploy（运维）。
   *
   * 为什么需要：users 表里 C 端用户与运营、运维用户混存，只靠 roles 挡不住
   * 「给 C 端账号授运维权限」。登录、授权、用户列表三处都按它过滤。
   * 多值 —— 一个用户可以跨系统（如 admin 兼运维）。
   * 判定与回填规则见 `packages/shared/src/user-systems.ts`（唯一真相源）。
   */
  @Column({ type: 'json', nullable: true, comment: '归属系统：portal/admin/deploy' })
  systems?: string[] | null;

  /** 个人每日变身次数限制，NULL 表示使用全局默认 */
  @Column({ type: 'int', nullable: true, name: 'daily_transform_limit', comment: '每日变身次数上限，NULL=全局默认' })
  dailyTransformLimit: number | null;

  /**
   * 界面偏好（跟账号走）：当前仅圆角风格。
   *
   * 生产环境 `synchronize: false`，新增列不会自动创建，需手工 DDL：
   * `ALTER TABLE users ADD COLUMN preferences json NULL COMMENT '界面偏好（跟账号走）';`
   * 口径：specs/radius-style-dual/page-spec-pref-sync.md §9
   */
  @Column({ type: 'json', nullable: true, comment: '界面偏好（跟账号走）' })
  preferences?: UserPreferences | null;
}
