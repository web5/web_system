import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './user.entity';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  /**
   * 根据用户名查找用户
   */
  async findByUsername(username: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { username } });
  }

  /**
   * 根据 ID 查找用户
   */
  async findById(id: number): Promise<User | null> {
    return this.userRepository.findOne({ where: { id } });
  }

  /**
   * 根据微信 OpenID 查找用户
   */
  async findByWechatOpenid(openid: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { wechatOpenid: openid } });
  }

  /**
   * 根据邮箱查找用户
   */
  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { email } });
  }

  /**
   * 创建用户名密码用户
   */
  async create(data: {
    username: string;
    password: string;
    email?: string;
    phone?: string;
  }): Promise<User> {
    const existingUser = await this.findByUsername(data.username);
    if (existingUser) {
      throw new ConflictException('用户名已存在');
    }

    if (data.email) {
      const existingEmail = await this.findByEmail(data.email);
      if (existingEmail) {
        throw new ConflictException('邮箱已被注册');
      }
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);

    const user = this.userRepository.create({
      username: data.username,
      password: hashedPassword,
      email: data.email,
      phone: data.phone,
      roles: ['user'],
    });

    return this.userRepository.save(user);
  }

  /**
   * 创建微信用户
   */
  async createWechatUser(data: {
    openid: string;
    unionid?: string;
    nickname: string;
    avatar: string;
  }): Promise<User> {
    // 使用 openid 或 nickname 生成唯一用户名
    const username = `wx_${data.openid.substring(0, 10)}`;

    const user = this.userRepository.create({
      username,
      wechatOpenid: data.openid,
      wechatUnionid: data.unionid,
      avatar: data.avatar,
      roles: ['user'],
    });

    return this.userRepository.save(user);
  }

  /**
   * 更新用户信息
   */
  async update(id: number, data: Partial<User>): Promise<User> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    Object.assign(user, data);
    return this.userRepository.save(user);
  }

  /**
   * 删除用户
   */
  async delete(id: number): Promise<void> {
    const result = await this.userRepository.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException('用户不存在');
    }
  }

  /**
   * 更新用户状态
   */
  async updateStatus(id: number, status: 'active' | 'inactive' | 'banned'): Promise<User> {
    return this.update(id, { status });
  }
}
