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

  /** 角色列表，如 ['user','admin'] */
  @Column({ type: 'json', nullable: true, comment: '角色列表' })
  roles: string[];

  /** 个人每日变身次数限制，NULL 表示使用全局默认 */
  @Column({ type: 'int', nullable: true, name: 'daily_transform_limit', comment: '每日变身次数上限，NULL=全局默认' })
  dailyTransformLimit: number | null;
}
