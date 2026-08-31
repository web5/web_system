import {
  Injectable,
  Logger,
  OnModuleInit,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PERMISSIONS, ROLE_PERMISSIONS } from '@web-system/types';
import { User } from '@web-system/shared';
import { PermissionEntity } from './entities/permission.entity';
import { RoleEntity } from './entities/role.entity';
import { RolePermissionEntity } from './entities/role-permission.entity';

/** 新建/编辑角色入参 */
export interface SaveRolePayload {
  code?: string;
  name: string;
  description?: string | null;
  /** 权限点 code 数组（全量覆盖） */
  permissions?: string[];
}

/**
 * RBAC 权限服务
 *
 * 数据模型：permissions（权限点）/ roles（角色）/ role_permissions（关联），
 * 用户-角色沿用 users.roles JSON 字段（一期不做 user_roles 表）。
 *
 * 权限点是「代码声明」的：启动时从 @web-system/types 的 PERMISSIONS 常量 seed，
 * 管理页只能勾选分配，不能凭空创建（避免 DB 与代码脱节）。
 * 内置角色（admin/editor/viewer）的权限以 ROLE_PERMISSIONS 为准，每次 seed 全量覆盖。
 */
@Injectable()
export class PermissionService implements OnModuleInit {
  private readonly logger = new Logger(PermissionService.name);

  /** 角色→权限解析的内存缓存（TTL 60s，单实例 PM2 部署足够） */
  private readonly permCache = new Map<string, { at: number; perms: string[] }>();
  private static readonly CACHE_TTL_MS = 60_000;

  constructor(
    @InjectRepository(PermissionEntity)
    private readonly permRepo: Repository<PermissionEntity>,
    @InjectRepository(RoleEntity)
    private readonly roleRepo: Repository<RoleEntity>,
    @InjectRepository(RolePermissionEntity)
    private readonly rpRepo: Repository<RolePermissionEntity>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  // ────────────────────────── seed ──────────────────────────

  async onModuleInit(): Promise<void> {
    await this.seed();
  }

  /** 权限点 + 内置角色 seed（幂等：upsert） */
  async seed(): Promise<void> {
    // 1. 权限点 upsert（代码声明为准）
    let permCount = 0;
    for (const [code, def] of Object.entries(PERMISSIONS)) {
      const exists = await this.permRepo.findOne({ where: { code } });
      if (exists) {
        if (
          exists.name !== def.name ||
          exists.grp !== def.group ||
          exists.type !== (def.type ?? 'action')
        ) {
          await this.permRepo.update(code, {
            name: def.name,
            grp: def.group,
            type: def.type ?? 'action',
          });
        }
      } else {
        await this.permRepo.save(
          this.permRepo.create({
            code,
            name: def.name,
            grp: def.group,
            type: def.type ?? 'action',
          }),
        );
        permCount++;
      }
    }

    // 2. 内置角色 + 角色权限（ROLE_PERMISSIONS 为准，全量覆盖）
    let roleCount = 0;
    for (const [code, perms] of Object.entries(ROLE_PERMISSIONS)) {
      const role = await this.roleRepo.findOne({ where: { code } });
      if (role) {
        if (role.name !== code) {
          await this.roleRepo.update(code, { name: code });
        }
      } else {
        await this.roleRepo.save(
          this.roleRepo.create({
            code,
            name: code,
            description: null,
            isSystem: true,
          }),
        );
        roleCount++;
      }
      await this.rpRepo.delete({ roleCode: code });
      for (const p of perms) {
        await this.rpRepo.save(this.rpRepo.create({ roleCode: code, permissionCode: p }));
      }
    }

    if (permCount || roleCount) {
      this.logger.log(`权限 seed 完成：新增权限点 ${permCount} 个、内置角色 ${roleCount} 个`);
    }
  }

  // ──────────────────────── 权限点查询 ────────────────────────

  /** 权限点全量（按 group 分组，供配置页渲染权限树） */
  async listPermissions() {
    const rows = await this.permRepo.find({ order: { grp: 'ASC', sort: 'ASC', code: 'ASC' } });
    const grouped = new Map<string, PermissionEntity[]>();
    for (const r of rows) {
      const list = grouped.get(r.grp) || [];
      list.push(r);
      grouped.set(r.grp, list);
    }
    return Array.from(grouped.entries()).map(([group, permissions]) => ({
      group,
      permissions: permissions.map((p) => ({
        code: p.code,
        name: p.name,
        type: p.type,
      })),
    }));
  }

  // ──────────────────────── 角色 CRUD ────────────────────────

  /** 角色列表（含各自权限码） */
  async listRoles() {
    const roles = await this.roleRepo.find({ order: { isSystem: 'DESC', code: 'ASC' } });
    const rps = await this.rpRepo.find();
    const byRole = new Map<string, string[]>();
    for (const rp of rps) {
      const list = byRole.get(rp.roleCode) || [];
      list.push(rp.permissionCode);
      byRole.set(rp.roleCode, list);
    }
    return roles.map((r) => ({
      code: r.code,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      permissions: byRole.get(r.code) || [],
    }));
  }

  /** 新建角色（含权限分配） */
  async createRole(payload: SaveRolePayload) {
    const code = payload.code?.trim() || '';
    if (!/^[a-z][a-z0-9_-]{1,63}$/.test(code)) {
      throw new BadRequestException('角色 code 需为小写字母开头的短横线/下划线标识符');
    }
    const exists = await this.roleRepo.findOne({ where: { code } });
    if (exists) throw new BadRequestException(`角色 ${code} 已存在`);
    await this.validatePerms(payload.permissions || []);

    await this.roleRepo.save(
      this.roleRepo.create({
        code,
        name: payload.name,
        description: payload.description ?? null,
        isSystem: false,
      }),
    );
    await this.replaceRolePerms(code, payload.permissions || []);
    this.clearCache();
    this.logger.log(`角色 ${code} 已创建`);
    return { code };
  }

  /** 更新角色（含权限全量覆盖） */
  async updateRole(code: string, payload: SaveRolePayload) {
    const role = await this.roleRepo.findOne({ where: { code } });
    if (!role) throw new NotFoundException(`角色 ${code} 不存在`);
    await this.validatePerms(payload.permissions || []);

    await this.roleRepo.update(code, {
      name: payload.name,
      description: payload.description ?? null,
    });
    await this.replaceRolePerms(code, payload.permissions || []);
    this.clearCache();
    this.logger.log(`角色 ${code} 已更新（权限 ${payload.permissions?.length ?? 0} 项）`);
    return { code };
  }

  /** 删除角色（内置拒绝；被用户引用拒绝） */
  async deleteRole(code: string) {
    const role = await this.roleRepo.findOne({ where: { code } });
    if (!role) throw new NotFoundException(`角色 ${code} 不存在`);
    if (role.isSystem) throw new BadRequestException('内置角色不可删除');

    const used = await this.userRepo
      .createQueryBuilder('u')
      .where('u.roles LIKE :pattern', { pattern: `%"${code}"%` })
      .getCount();
    if (used > 0) {
      throw new BadRequestException(`角色 ${code} 已被 ${used} 个用户使用，无法删除`);
    }

    await this.rpRepo.delete({ roleCode: code });
    await this.roleRepo.delete(code);
    this.clearCache();
    this.logger.log(`角色 ${code} 已删除`);
    return { ok: true };
  }

  // ──────────────────────── 权限解析 ────────────────────────

  /**
   * 当前登录用户权限码（admin 特判全量）
   * @param user req.user（auth-service verify 返回，含 roles）
   */
  async getMyPermissions(user: { roles?: string[] }): Promise<string[]> {
    const roles = user?.roles?.length ? user.roles : [];
    if (roles.includes('admin')) return Object.keys(PERMISSIONS);
    return this.getPermissionsForRoles(roles);
  }

  /** 按角色列表解析权限码集合（内部接口 + 各服务 PermissionGuard 调用，60s 缓存） */
  async getPermissionsForRoles(roles: string[]): Promise<string[]> {
    if (!roles?.length) return [];
    const sorted = [...new Set(roles)].sort();
    const cacheKey = sorted.join(',');
    const cached = this.permCache.get(cacheKey);
    if (cached && Date.now() - cached.at < PermissionService.CACHE_TTL_MS) {
      return cached.perms;
    }

    const rows = await this.rpRepo
      .createQueryBuilder('rp')
      .innerJoin(PermissionEntity, 'p', 'p.code = rp.permission_code')
      .where('rp.role_code IN (:...roles)', { roles: sorted })
      .select('DISTINCT p.code', 'code')
      .getRawMany<{ code: string }>();
    const perms = rows.map((r) => r.code);
    this.permCache.set(cacheKey, { at: Date.now(), perms });
    return perms;
  }

  /** 角色/权限变更后清缓存（改权限 60s 内全局生效的上限已由 TTL 保证） */
  clearCache(): void {
    this.permCache.clear();
  }

  // ──────────────────────── 私有 ────────────────────────

  /** 校验权限码都存在（防止写入不存在的权限点） */
  private async validatePerms(codes: string[]): Promise<void> {
    if (!codes?.length) return;
    const rows = await this.permRepo.find({ where: codes.map((c) => ({ code: c })) });
    const found = new Set(rows.map((r) => r.code));
    const missing = codes.filter((c) => !found.has(c));
    if (missing.length) {
      throw new BadRequestException(`权限点不存在: ${missing.join(', ')}`);
    }
  }

  /** 全量覆盖某角色的权限关联 */
  private async replaceRolePerms(code: string, permissions: string[]): Promise<void> {
    await this.rpRepo.delete({ roleCode: code });
    for (const p of permissions) {
      await this.rpRepo.save(this.rpRepo.create({ roleCode: code, permissionCode: p }));
    }
  }
}
