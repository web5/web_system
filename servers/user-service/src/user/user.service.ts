import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { hasSystem, isAppSystem } from '@web-system/shared';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from './user.entity';

/** bcrypt 哈希轮数（与 auth-service 保持一致） */
const BCRYPT_ROUNDS = 10;

/** 该用户当前是否持有超管角色（roles 可能是数组或逗号串，历史数据形态不一） */
function hasSuperAdminRole(roles: unknown): boolean {
  const list = Array.isArray(roles)
    ? roles
    : typeof roles === 'string'
      ? roles.split(',')
      : [];
  return list.map((r) => String(r).trim()).includes('super_admin');
}

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  /**
   * 用户列表。
   *
   * @param system 按归属系统过滤（IAM 一期）：`portal` / `admin` / `deploy`；
   *   不传 = **全部**；传 `all` 也是全部。
   *   为什么默认全部而不是默认 admin：既有调用方（admin 用户管理页、MCP）不能因为
   *   这次改动就少看到数据；隔离由**调用方显式传 system** 触发，
   *   后续前端适配后再把默认值收紧。
   */
  async findAll(page: number = 1, pageSize: number = 10, keyword?: string, system?: string) {
    const pageNum = Number(page) || 1;
    const pageSizeNum = Number(pageSize) || 10;
    const trimmedKeyword = keyword?.trim();

    const [users, total] = await this.userRepository.findAndCount({
      skip: (pageNum - 1) * pageSizeNum,
      take: pageSizeNum,
      order: { createdAt: 'DESC' },
      where: trimmedKeyword
        ? [
            { username: ILike(`%${trimmedKeyword}%`) },
            { email: ILike(`%${trimmedKeyword}%`) },
            { phone: ILike(`%${trimmedKeyword}%`) },
          ]
        : undefined,
    });
    // systems 是 JSON 列，跨库（MySQL/Postgres）可靠的做法是在应用层过滤
    const filtered =
      system && system !== 'all' && isAppSystem(system)
        ? users.filter((u) => hasSystem(u, system))
        : users;
    const safeUsers = filtered.map((u) => {
      const { password: _pwd, ...rest } = JSON.parse(JSON.stringify(u));
      return rest;
    });
    return {
      list: safeUsers,
      // 过滤发生在分页之后，故 total 以过滤后的行数为准，避免页码算错
      total: system && system !== 'all' && isAppSystem(system) ? filtered.length : total,
      page: pageNum,
      pageSize: pageSizeNum,
    };
  }

  async findById(id: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id: Number(id) } });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return user;
  }

  async findOne(id: string): Promise<Omit<User, 'password'>> {
    const user = await this.findById(id);
    const { password: _pwd, ...safeUser } = JSON.parse(JSON.stringify(user));
    return safeUser;
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { username } });
  }

  async create(userData: Partial<User>): Promise<User> {
    const data = { ...userData };
    // 统一哈希：admin 用户管理「新增用户」若带密码，落库前必须 bcrypt 哈希，
    // 否则登录端 bcrypt.compare 永远失败（历史隐患：此处曾直接存明文）。
    if (data.password) {
      data.password = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    }
    const user = this.userRepository.create(data);
    return this.userRepository.save(user);
  }

  async update(id: string, userData: Partial<User>): Promise<User> {
    const user = await this.findById(id);
    // 防剥权（2026-10-29）：前端下拉曾不认识 super_admin，编辑保存会把超管静默降级。
    // 这里是最后一道门：超管角色只能保留；真要摘除由其他超管在数据库层面操作。
    if (
      hasSuperAdminRole((user as any).roles) &&
      (userData as any).roles !== undefined &&
      !hasSuperAdminRole((userData as any).roles)
    ) {
      throw new BadRequestException('不允许移除用户的 super_admin 角色：请先由其他超级管理员在数据库层面操作');
    }
    const { preferences, password, ...rest } = userData;
    Object.assign(user, rest);
    if (password) {
      // 改密：哈希 + 令牌版本 +1，作废该用户所有旧会话（token_version 机制）
      user.password = await bcrypt.hash(password, BCRYPT_ROUNDS);
      user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    }
    if (preferences !== undefined) {
      // 界面偏好按「浅合并」写入：保留本次未提交的键，避免将来新增偏好项被整体覆盖。
      // 口径：specs/radius-style-dual/page-spec-pref-sync.md §3.2
      user.preferences = { ...(user.preferences ?? {}), ...preferences };
    }
    return this.userRepository.save(user);
  }

  /**
   * 个人中心：修改自己的密码。
   * 校验旧密码正确后才允许改，改后令牌版本 +1（作废其它会话）。
   */
  async changeOwnPassword(userId: string, oldPassword: string, newPassword: string): Promise<void> {
    const user = await this.findById(userId);
    const valid = user.password ? await bcrypt.compare(oldPassword, user.password) : false;
    if (!valid) {
      throw new BadRequestException('旧密码不正确');
    }
    user.password = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    await this.userRepository.save(user);
  }

  /**
   * 用户管理：管理员重置任意用户密码（无需旧密码）。
   * 改后令牌版本 +1（作废被重置账号的所有旧会话）。
   */
  async resetPassword(id: string, newPassword: string): Promise<void> {
    const user = await this.findById(id);
    user.password = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    await this.userRepository.save(user);
  }

  async remove(id: string): Promise<void> {
    const user = await this.findById(id);
    // 超管账号不允许删除：删光超管会让后台权限体系失去管理入口
    if (hasSuperAdminRole((user as any).roles)) {
      throw new BadRequestException('不允许删除超级管理员账号：请先由其他超级管理员在数据库层面操作');
    }
    await this.userRepository.remove(user);
  }
}
