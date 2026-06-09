import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * 用户实体 - 与 auth-service 共享同一张 users 表
 * 注意：修改此实体时需同步修改 auth-service 的 user.entity.ts
 */
@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 50 })
  username: string;

  @Column({ nullable: true, length: 100 })
  password: string;

  @Column({ unique: true, nullable: true, length: 100 })
  email: string;

  @Column({ nullable: true, length: 20 })
  phone: string;

  @Column({ nullable: true, length: 50 })
  nickname: string;

  @Column({ nullable: true, length: 500 })
  avatar: string;

  @Index()
  @Column({ nullable: true, length: 100 })
  wechatOpenid: string;

  @Column({ nullable: true, length: 100 })
  wechatUnionid: string;

  @Column({ default: 'active', length: 20 })
  status: 'active' | 'inactive' | 'banned';

  @Column('simple-json', { nullable: true })
  roles: string[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
