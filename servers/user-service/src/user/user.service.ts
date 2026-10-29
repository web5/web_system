import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { hasSystem, isAppSystem } from '@web-system/shared';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { User } from './user.entity';

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
    const user = this.userRepository.create(userData);
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
    const { preferences, ...rest } = userData;
    Object.assign(user, rest);
    if (preferences !== undefined) {
      // 界面偏好按「浅合并」写入：保留本次未提交的键，避免将来新增偏好项被整体覆盖。
      // 口径：specs/radius-style-dual/page-spec-pref-sync.md §3.2
      user.preferences = { ...(user.preferences ?? {}), ...preferences };
    }
    return this.userRepository.save(user);
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
