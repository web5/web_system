import { Injectable, Logger, NotFoundException, BadRequestException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { DeploySiteEntity } from '../entities/deploy-site.entity';
import { DeployEnvEntity } from '../entities/deploy-env.entity';
import { DeployAppEnvVersionEntity } from '../entities/deploy-app-env-version.entity';
import { DeployServiceEnvEntity } from '../entities/deploy-service-env.entity';
import { DeployServiceEntity } from '../entities/deploy-service.entity';
import { DeployHostEntity } from '../entities/deploy-host.entity';
import { CreateEnvDto, UpdateEnvDto, UpdateServiceRouteDto } from './dto';

/** 内置保留字（不可作为用户创建的自增 ID 冲突源） */
const BUILTIN_ENVS = ['dev', 'local', 'prod'] as const;
/** 运行时回退目标（FR-3.3 / Q1） */
const FALLBACK_ENV_ID = 'dev';

/** 内置站点种子（M2） */
const BUILTIN_SITES = [
  { key: 'local', host: 'local.kedouai.com', name: '本机站点', defaultEnvId: 'local', switchable: true },
  { key: 'dev', host: 'dev.kedouai.com', name: '开发站点', defaultEnvId: 'dev', switchable: true },
  { key: 'prod', host: 'portal.kedouai.com', name: '生产站点', defaultEnvId: 'prod', switchable: false },
] as const;

/** 内置环境种子（M3） */
const BUILTIN_ENV_ROWS = [
  { envId: 'dev', name: '主开发环境', siteKey: 'dev', isProd: false, sort: 1 },
  { envId: 'local', name: '本机', siteKey: 'local', isProd: false, sort: 1 },
  { envId: 'prod', name: '生产环境', siteKey: 'prod', isProd: true, sort: 1 },
] as const;

/**
 * 环境域服务（微前端加载维度）
 *
 * 设计依据：specs/deploy-console-domain-split/design.md v2 §2.2 / §4.1
 * - `envId` = 产物目录名；内置保留字 `dev`/`local`/`prod`；用户创建为**系统自增数字**
 * - `prod` 全局至多一条（isProd）
 * - 运行时传入的 envId 查不到 → **回退 dev**
 * - 删除环境前检查占用（该 envId 下有非空版本指针即阻断）
 * - 环境详情承载「后端服务指向」（deploy_service_envs）
 */
@Injectable()
export class EnvsService implements OnModuleInit {
  private readonly logger = new Logger(EnvsService.name);

  constructor(
    @InjectRepository(DeploySiteEntity)
    private readonly siteRepo: Repository<DeploySiteEntity>,
    @InjectRepository(DeployEnvEntity)
    private readonly envRepo: Repository<DeployEnvEntity>,
    @InjectRepository(DeployAppEnvVersionEntity)
    private readonly versionRepo: Repository<DeployAppEnvVersionEntity>,
    @InjectRepository(DeployServiceEnvEntity)
    private readonly serviceEnvRepo: Repository<DeployServiceEnvEntity>,
    @InjectRepository(DeployServiceEntity)
    private readonly serviceRepo: Repository<DeployServiceEntity>,
    @InjectRepository(DeployHostEntity)
    private readonly hostRepo: Repository<DeployHostEntity>,
  ) {}

  /** 启动时幂等种子：站点 + 内置环境（迁移脚本 M2/M3 的运行时等价物） */
  async onModuleInit(): Promise<void> {
    try {
      await this.ensureBuiltin();
    } catch (e) {
      this.logger.error(`内置站点/环境种子失败（忽略，不影响启动）：${(e as Error).message}`);
    }
  }

  async ensureBuiltin(): Promise<void> {
    for (const s of BUILTIN_SITES) {
      const exists = await this.siteRepo.findOne({ where: { key: s.key } });
      if (!exists) {
        await this.siteRepo.save(this.siteRepo.create({ ...s, enabled: true }));
        this.logger.log(`种子站点已创建：${s.key} (${s.host})`);
      }
    }
    for (const e of BUILTIN_ENV_ROWS) {
      const exists = await this.envRepo.findOne({ where: { envId: e.envId } });
      if (!exists) {
        await this.envRepo.save(this.envRepo.create({ ...e, builtin: true, enabled: true }));
        this.logger.log(`种子环境已创建：${e.envId} (${e.name})`);
      }
    }
  }

  // ==================== 站点 ====================

  listSites() {
    return this.siteRepo.find({ order: { key: 'ASC' } });
  }

  async getSite(key: string): Promise<DeploySiteEntity> {
    const site = await this.siteRepo.findOne({ where: { key } });
    if (!site) throw new NotFoundException(`站点不存在：${key}`);
    return site;
  }

  /** 按 Host 匹配站点（gateway manifest 用；本地调试可用 ?host= 覆盖） */
  async findSiteByHost(host: string): Promise<DeploySiteEntity | null> {
    const cleaned = String(host || '').split(':')[0].trim().toLowerCase();
    if (!cleaned) return null;
    const all = await this.siteRepo.find();
    return all.find((s) => s.host.toLowerCase() === cleaned) || null;
  }

  // ==================== 环境 ====================

  /** 列表（站点筛选 + 关键字搜索 + 分页，FR-3.1） */
  async listEnvs(query: { siteKey?: string; q?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
    const kw = (query.q || '').trim().toLowerCase();

    const qb = this.envRepo.createQueryBuilder('e');
    if (query.siteKey && query.siteKey !== 'all') {
      qb.andWhere('e.siteKey = :siteKey', { siteKey: query.siteKey });
    }
    if (kw) {
      qb.andWhere('(LOWER(e.envId) LIKE :kw OR LOWER(e.name) LIKE :kw)', { kw: `%${kw}%` });
    }
    qb.orderBy('e.siteKey', 'ASC').addOrderBy('e.sort', 'ASC').addOrderBy('e.envId', 'ASC');

    const [items, total] = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return { items, total, page, pageSize };
  }

  /** 环境是否存在（供跨域校验：流水线提交时校验 envId，替代硬编码白名单） */
  async existsEnv(envId: string): Promise<boolean> {
    if (!envId) return false;
    return (await this.envRepo.count({ where: { envId } })) > 0;
  }

  /** 全部启用环境（按站点 + 排序），供部署矩阵 / manifest 组装 */
  listEnvEntries(): Promise<DeployEnvEntity[]> {
    return this.envRepo.find({
      where: { enabled: true },
      order: { siteKey: 'ASC', sort: 'ASC', envId: 'ASC' },
    });
  }

  async getEnv(envId: string): Promise<DeployEnvEntity> {
    const env = await this.envRepo.findOne({ where: { envId } });
    if (!env) throw new NotFoundException(`环境不存在：${envId}`);
    return env;
  }

  /** 新建环境：envId 系统自增（用户不可填） */
  async createEnv(dto: CreateEnvDto): Promise<DeployEnvEntity> {
    const site = await this.getSite(dto.siteKey);
    if (site.key === 'prod') {
      throw new BadRequestException('生产站点不允许再创建环境（prod 唯一）');
    }
    const envId = await this.allocateEnvId();
    const sort = (await this.envRepo.count({ where: { siteKey: site.key } })) + 1;
    const saved = await this.envRepo.save(
      this.envRepo.create({
        envId,
        name: dto.name.trim(),
        siteKey: site.key,
        isProd: false,
        builtin: false,
        sort,
        enabled: true,
      }),
    );
    this.logger.log(`环境已创建：envId=${envId} (${saved.name}) site=${site.key}`);
    return saved;
  }

  /** 自增分配：取所有纯数字 envId 的最大值 + 1，从 1 开始 */
  private async allocateEnvId(): Promise<string> {
    const row = await this.envRepo
      .createQueryBuilder('e')
      .select('e.envId', 'envId')
      .where("e.envId REGEXP '^[0-9]+$'")
      .orderBy('CAST(e.envId AS UNSIGNED)', 'DESC')
      .limit(1)
      .getRawOne<{ envId: string }>();
    const next = row?.envId ? Number(row.envId) + 1 : 1;
    // 极端情况（历史脏数据）防碰撞
    let candidate = String(next);
    while (await this.envRepo.findOne({ where: { envId: candidate } })) {
      candidate = String(Number(candidate) + 1);
    }
    return candidate;
  }

  async updateEnv(envId: string, dto: UpdateEnvDto): Promise<DeployEnvEntity> {
    const env = await this.getEnv(envId);
    if (dto.name !== undefined) env.name = dto.name.trim();
    if (dto.sort !== undefined) env.sort = dto.sort;
    if (dto.enabled !== undefined) env.enabled = dto.enabled;
    return this.envRepo.save(env);
  }

  /** 删除前占用检查：返回占用该环境的应用清单（FR-3.5） */
  async findEnvOccupants(envId: string): Promise<string[]> {
    const rows = await this.versionRepo.find({
      where: { envId, currentVersion: Not(IsNull()) },
    });
    return rows.map((r) => r.appKey);
  }

  async removeEnv(envId: string): Promise<{ removed: boolean; occupants: string[] }> {
    const env = await this.getEnv(envId);
    if (env.builtin) {
      throw new BadRequestException(`内置环境 ${envId} 不可删除`);
    }
    const occupants = await this.findEnvOccupants(envId);
    if (occupants.length) {
      throw new BadRequestException(
        `仍有 ${occupants.length} 个应用在该环境有部署记录：${occupants.join('、')}。请先清理后再删除。`,
      );
    }
    await this.serviceEnvRepo.delete({ envId });
    await this.envRepo.delete({ envId });
    this.logger.warn(`环境已删除：${envId}`);
    return { removed: true, occupants: [] };
  }

  /**
   * 运行时解析 envId（**找不到回退 dev**，FR-3.3）
   * gateway / shell 侧据此决定加载哪个目录。
   */
  async resolveEnvId(candidate?: string): Promise<string> {
    const wanted = String(candidate || '').trim();
    if (wanted) {
      const hit = await this.envRepo.findOne({ where: { envId: wanted, enabled: true } });
      if (hit) return hit.envId;
    }
    const fallback = await this.envRepo.findOne({ where: { envId: FALLBACK_ENV_ID } });
    return fallback?.envId || FALLBACK_ENV_ID;
  }

  /** 站点下可切换的环境列表（供 manifest 的 envs 字段） */
  async listSiteEnvs(siteKey: string) {
    return this.envRepo.find({
      where: { siteKey, enabled: true },
      order: { sort: 'ASC', envId: 'ASC' },
    });
  }

  // ==================== 后端服务指向（环境详情） ====================

  /** 该环境下各服务的指向（含未被配置的服务，返回空指向占位） */
  async listServiceRoutes(envId: string) {
    const env = await this.getEnv(envId);
    const [services, routes] = await Promise.all([
      this.serviceRepo.find({ where: { enabled: true }, order: { key: 'ASC' } }),
      this.serviceEnvRepo.find({ where: { envId } }),
    ]);
    const byKey = new Map(routes.map((r) => [r.serviceKey, r]));
    // 主机组名 → 地址：一次性解析，避免 N+1
    const hostNames = [...new Set(routes.map((r) => r.hostName).filter((n): n is string => !!n))];
    const hosts = hostNames.length
      ? await this.hostRepo.find({ where: { name: In(hostNames) } })
      : [];
    const addrByName = new Map(hosts.filter((h) => h.enabled).map((h) => [h.name, h.host]));

    return {
      env,
      items: services.map((s) => {
        const r = byKey.get(s.key);
        const hostName = r?.hostName ?? null;
        // Q19：端口**不继承** defaultPort，未填即未配置（缺端口 = 配置错误，不静默回落）
        const port = r?.port ?? null;
        return {
          serviceKey: s.key,
          serviceName: s.name,
          kind: s.kind,
          /** 主机组名与端口**都齐**才算已配置 */
          configured: !!hostName && !!port,
          hostName,
          /** 主机组解析出的可解析地址（供前端展示「组名 ≠ 地址」） */
          hostAddress: hostName ? addrByName.get(hostName) ?? null : null,
          port,
          upstreamUrl: r?.upstreamUrl ?? null,
          replicas: r?.replicas ?? 1,
          runtime: r?.runtime ?? null,
          healthPath: r?.healthPath ?? s.healthPath,
          enabled: (r?.status ?? 'active') === 'active',
        };
      }),
    };
  }

  /**
   * 更新某服务在该环境的指向
   *
   * - `hostName` = 主机**组名**，必须在「主机管理」已登记且启用（Q17 方案 D / Q20：不登记就报错）
   * - `port` **必填**（Q19：不继承服务默认端口，按该环境实际启动端口填）
   */
  async updateServiceRoute(envId: string, serviceKey: string, dto: UpdateServiceRouteDto) {
    await this.getEnv(envId);
    const svc = await this.serviceRepo.findOne({ where: { key: serviceKey } });
    if (!svc) throw new NotFoundException(`服务不存在：${serviceKey}`);

    const hostName = dto.hostName?.trim();
    if (!hostName) {
      throw new BadRequestException('目标主机必填（不允许静默回落到本机）');
    }
    const host = await this.hostRepo.findOne({ where: { name: hostName } });
    if (!host) {
      throw new BadRequestException(
        `主机组 ${hostName} 未在「主机管理」登记，请先在「基础设施 → 主机管理」登记后再配置指向`,
      );
    }
    if (!host.enabled) {
      throw new BadRequestException(`主机组 ${hostName} 已停用，请先启用或换一个主机组`);
    }

    let row = await this.serviceEnvRepo.findOne({ where: { serviceKey, envId } });
    if (!row) {
      row = this.serviceEnvRepo.create({ serviceKey, envId, replicas: 1, status: 'active' });
    }
    row.hostName = hostName;
    // 端口必填：新建时必须给；已存在行若仍未填端口，本次也一并要求补齐
    const nextPort = dto.port ?? row.port;
    if (!nextPort) {
      throw new BadRequestException(
        `端口必填：请按 ${serviceKey} 在环境 ${envId} 的实际启动端口填写（不继承服务默认端口）`,
      );
    }
    if (dto.port !== undefined) row.port = dto.port;
    if (dto.upstreamUrl !== undefined) row.upstreamUrl = dto.upstreamUrl || null;
    if (dto.replicas !== undefined) row.replicas = dto.replicas;
    if (dto.runtime !== undefined) row.runtime = dto.runtime;
    if (dto.healthPath !== undefined) row.healthPath = dto.healthPath || null;
    if (dto.enabled !== undefined) row.status = dto.enabled ? 'active' : 'disabled';
    return this.serviceEnvRepo.save(row);
  }

  /** 内置保留字（供前端提示） */
  getBuiltinEnvIds(): readonly string[] {
    return BUILTIN_ENVS;
  }

  /** 批量按 envId 取（manifest 组装用） */
  async findEnvsByIds(ids: string[]) {
    if (!ids.length) return [];
    return this.envRepo.find({ where: { envId: In(ids) } });
  }
}
