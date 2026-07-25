import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

/**
 * 最小化的 User 实体，仅用于 TypeORM 外键关联
 * 实际用户数据在 auth-service/user-service 中管理
 */
@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ nullable: true })
  username: string;
}
