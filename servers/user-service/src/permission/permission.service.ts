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
import { OperationLogClient } from './operation-log.client';

/** seed 结果（供同步接口回传，便于确认"到底补了什么"） */
export interface SeedResult {
  permissionsAdded: number;
  permissionsUpdated: number;
  rolesAdded: number;
  rolePermissionsCovered: number;
}

/**
 * 代码声明（`packages/types`）与 DB 的差异快照，供 admin 角色权限页提示"未同步"。
 *
 * 自定义角色不出现在这里 —— 其权限本就由人在页面维护，没有"代码声明"可对比。
 */
export interface PermissionDiff {
  /** 代码有、DB 没有（加了权限码但没同步） */
  permissionsMissingInDb: string[];
  /** DB 有、代码没有（代码删了但库里残留） */
  permissionsExtraInDb: string[];
  /** 内置角色权限差异 */
  roles: Array<{ code: string; missingInDb: string[]; extraInDb: string[] }>;
  /** 是否存在任何差异（前端据此决定是否提示） */
  hasDiff: boolean;
}

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
    // 操作日志上报（跨服务 → system-service /internal/logs；失败不阻断）
    private readonly opLogs: OperationLogClient,
  ) {}

  // ────────────────────────── seed ──────────────────────────

  async onModuleInit(): Promise<void> {
    await this.seed();
  }

  /**
   * 权限点 + 内置角色 seed（幂等：upsert）。
   *
   * 调用时机：① 服务启动（onModuleInit）；② `POST /admin/permissions/sync`
   * （人工/流水线触发）——后者用于"加了新权限码但没重启本服务"的场景：
   * 后端各服务鉴权读代码常量、前端菜单读本表，不同步就会出现"接口通但菜单不出现"。
   */
  async seed(): Promise<SeedResult> {
    const result: SeedResult = {
      permissionsAdded: 0,
      permissionsUpdated: 0,
      rolesAdded: 0,
      rolePermissionsCovered: 0,
    };

    // 1. 权限点 upsert（代码声明为准）
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
          result.permissionsUpdated++;
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
        result.permissionsAdded++;
      }
    }

    // 2. 内置角色 + 角色权限（ROLE_PERMISSIONS 为准，全量覆盖）
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
        result.rolesAdded++;
      }
      await this.rpRepo.delete({ roleCode: code });
      for (const p of perms) {
        await this.rpRepo.save(this.rpRepo.create({ roleCode: code, permissionCode: p }));
        result.rolePermissionsCovered++;
      }
    }

    // 缓存必须清：否则同步后 60s 内仍解析到旧权限集合
    this.permCache.clear();
    this.logger.log(
      `权限 seed 完成：新增权限点 ${result.permissionsAdded} 个、更新 ${result.permissionsUpdated} 个、` +
        `新增角色 ${result.rolesAdded} 个、覆盖角色权限 ${result.rolePermissionsCovered} 条`,
    );
    return result;
  }

  /**
   * 同步 + 审计（admin 页面按钮 / 脚本 / 发布流水线共用的主动入口）。
   *
   * 与 `seed()` 的区别：`seed()` 在服务启动时静默补齐（不写日志，否则每次重启都留一条），
   * 本方法用于"有人或有流程主动触发"的场景，同步完成后落一条操作日志。
   * 审计写失败只告警，不影响同步结果（见 OperationLogClient）。
   */
  async syncAndAudit(operator: string, source: string): Promise<SeedResult> {
    const result = await this.seed();
    await this.opLogs.write({
      operator,
      type: 'sync_permission',
      target:
        `权限同步（${source}）：新增 ${result.permissionsAdded}、更新 ${result.permissionsUpdated}、` +
        `新增角色 ${result.rolesAdded}、覆盖角色权限 ${result.rolePermissionsCovered}`,
    });
    return result;
  }

  /**
   * 代码声明 vs DB 的差异快照（只读，不写库）。
   *
   * 用于 admin「角色权限」页提示"代码已加权限码、数据库还没同步"——
   * 这种状态下后端接口能过（鉴权读代码常量），前端菜单却不出现（读 DB）。
   */
  async diff(): Promise<PermissionDiff> {
    const codeCodes = new Set(Object.keys(PERMISSIONS));
    const dbCodes = new Set((await this.permRepo.find()).map((r) => r.code));

    const dbByRole = new Map<string, Set<string>>();
    for (const rp of await this.rpRepo.find()) {
      const set = dbByRole.get(rp.roleCode) ?? new Set<string>();
      set.add(rp.permissionCode);
      dbByRole.set(rp.roleCode, set);
    }

    const roles = Object.entries(ROLE_PERMISSIONS)
      .map(([code, perms]) => {
        const inDb = dbByRole.get(code) ?? new Set<string>();
        const expected = new Set(perms);
        return {
          code,
          missingInDb: perms.filter((p) => !inDb.has(p)),
          extraInDb: [...inDb].filter((p) => !expected.has(p)),
        };
      })
      .filter((r) => r.missingInDb.length > 0 || r.extraInDb.length > 0);

    const permissionsMissingInDb = [...codeCodes].filter((c) => !dbCodes.has(c));
    const permissionsExtraInDb = [...dbCodes].filter((c) => !codeCodes.has(c));

    return {
      permissionsMissingInDb,
      permissionsExtraInDb,
      roles,
      hasDiff:
        permissionsMissingInDb.length > 0 || permissionsExtraInDb.length > 0 || roles.length > 0,
    };
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
   * 当前登录用户权限码
   * - super_admin：代码级特判全量（不依赖 role_permissions 表，避免 seed 时序差异）
   * - 其余角色（含 admin/editor/viewer/自定义）：按 role_permissions 表解析；
   *   admin 的内置权限由 seed 覆盖为 ROLE_PERMISSIONS.admin（不含 database:query），
   *   与各服务 PermissionsGuard 的常量语义保持一致
   */
  async getMyPermissions(user: { roles?: string[] }): Promise<string[]> {
    const roles = user?.roles?.length ? user.roles : [];
    if (roles.includes('super_admin')) return Object.keys(PERMISSIONS);
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
