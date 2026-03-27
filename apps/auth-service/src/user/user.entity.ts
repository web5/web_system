import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

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

  @Column({ nullable: true, length: 500 })
  avatar: string;

  @Column({ nullable: true, length: 100 })
  wechatOpenid: string;

  @Column({ nullable: true, length: 100 })
  wechatUnionid: string;

  @Column({ default: 'active' })
  status: 'active' | 'inactive' | 'banned';

  @Column('simple-json', { nullable: true })
  roles: string[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
