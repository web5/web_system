import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
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
   * 根据小程序 openid 查找用户
   */
  async findByMpOpenid(openid: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { mpOpenid: openid } });
  }

  /**
   * 根据公众号 openid 查找用户
   */
  async findByOaOpenid(openid: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { oaOpenid: openid } });
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
   * 创建小程序用户（独立创建，不尝试合并）
   */
  async createMpUser(data: {
    mpOpenid: string;
    nickname: string;
    avatar: string;
  }): Promise<User> {
    const username = `wx_${data.mpOpenid.substring(0, 10)}`;
    const user = this.userRepository.create({
      username,
      mpOpenid: data.mpOpenid,
      nickname: data.nickname,
      avatar: data.avatar,
      roles: ['user'],
    });
    return this.userRepository.save(user);
  }

  /**
   * 创建公众号用户（独立创建，不尝试合并）
   */
  async createOaUser(data: {
    oaOpenid: string;
    nickname: string;
    avatar: string;
  }): Promise<User> {
    const username = `wx_${data.oaOpenid.substring(0, 10)}`;
    const user = this.userRepository.create({
      username,
      oaOpenid: data.oaOpenid,
      nickname: data.nickname,
      avatar: data.avatar,
      roles: ['user'],
    });
    return this.userRepository.save(user);
  }

  /**
   * 绑定小程序 openid 到已有用户（个人中心）
   * @throws 如果该 openid 已被其他用户绑定
   */
  async bindMpOpenid(userId: number, mpOpenid: string): Promise<User> {
    const existing = await this.findByMpOpenid(mpOpenid);
    if (existing && existing.id !== userId) {
      throw new BadRequestException('该微信小程序账号已被其他用户绑定');
    }
    return this.update(userId, { mpOpenid });
  }

  /**
   * 绑定公众号 openid 到已有用户（个人中心）
   * @throws 如果该 openid 已被其他用户绑定
   */
  async bindOaOpenid(userId: number, oaOpenid: string): Promise<User> {
    const existing = await this.findByOaOpenid(oaOpenid);
    if (existing && existing.id !== userId) {
      throw new BadRequestException('该微信公众号账号已被其他用户绑定');
    }
    return this.update(userId, { oaOpenid });
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
