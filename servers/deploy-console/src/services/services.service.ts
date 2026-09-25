import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { In, IsNull, Repository } from 'typeorm';
import { DeployServiceEntity } from '../entities/deploy-service.entity';
import { DeployServiceRouteEntity } from '../entities/deploy-service-route.entity';
import { DeployEndpointEntity } from '../entities/deploy-endpoint.entity';
import { DeployServiceEnvEntity } from '../entities/deploy-service-env.entity';
import { DeployEnvEntity } from '../entities/deploy-env.entity';
import { DeployHostEntity } from '../entities/deploy-host.entity';
// 仅用于种子导入（迁移 M4/M6 的运行时等价物，P4 正式迁移后移除依赖）
import { DeployModuleEntity } from '../entities/deploy-module.entity';
import { DeployEnvServiceRouteEntity } from '../entities/deploy-env-service-route.entity';
import {
  CreateServiceDto,
  ENDPOINT_AUTH_MODES,
  ENDPOINT_METHODS,
  EndpointDto,
  ImportEndpointsDto,
  ROUTE_AUTH_MODES,
  SERVICE_KINDS,
  ServiceRouteDto,
  UpdateServiceDto,
} from './dto';

/** 可"被补空"的接口字段（导入时只补这些，且仅当现有值为空） */
const FILLABLE_ENDPOINT_FIELDS = [
  'code',
  'summary',
  'authMode',
  'permissionCode',
  'rateLimitPerMin',
  'timeoutMs',
] as const;

/** 判定"空"：null/undefined/空串；authMode 的 inherit 视同未配置 */
function isEmptyValue(field: string, value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true;
  return field === 'authMode' && value === 'inherit';
}

/**
 * 服务域服务（API 网关）
 *
 * 设计依据：specs/deploy-console-domain-split/design.md v2 §2.3 / §4.3
 * - `key` 沿用旧 module key（不重命名）→ 流水线历史 `moduleKey` 零改造
 * - 转发规则（前缀级）与接口清单（方法+路径级）**分层**：改接口不影响转发行为（FR-6.6）
 * - 接口导入 **UPSERT 只补空字段**（FR-6.5，V8 判据）
 * - 服务 × 环境「指向」在本域**只读**，编辑入口在环境详情（Q104）
 */
@Injectable()
export class ServicesService implements OnModuleInit {
  private readonly logger = new Logger(ServicesService.name);

  constructor(
    @InjectRepository(DeployServiceEntity)
    private readonly serviceRepo: Repository<DeployServiceEntity>,
    @InjectRepository(DeployServiceRouteEntity)
    private readonly routeRepo: Repository<DeployServiceRouteEntity>,
    @InjectRepository(DeployEndpointEntity)
    private readonly endpointRepo: Repository<DeployEndpointEntity>,
    @InjectRepository(DeployServiceEnvEntity)
    private readonly serviceEnvRepo: Repository<DeployServiceEnvEntity>,
    @InjectRepository(DeployEnvEntity)
    private readonly envRepo: Repository<DeployEnvEntity>,
    @InjectRepository(DeployHostEntity)
    private readonly hostRepo: Repository<DeployHostEntity>,
    @InjectRepository(DeployModuleEntity)
    private readonly legacyModuleRepo: Repository<DeployModuleEntity>,
    @InjectRepository(DeployEnvServiceRouteEntity)
    private readonly legacyRouteRepo: Repository<DeployEnvServiceRouteEntity>,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureSeeded();
    } catch (e) {
      this.logger.error(`服务种子导入失败（忽略，不影响启动）：${(e as Error).message}`);
    }
  }

  /**
   * 幂等种子（迁移 M4-lite / M6-lite）：
   * ① 服务 ← 旧 `deploy_modules`（type=backend），旧表为空时回落 `scripts/modules.json`；
   * ② 服务×环境指向 ← 旧 `deploy_env_service_routes`（envId 原样平移）。
   * 只在新表为空时执行，绝不覆盖已有数据。
   */
  async ensureSeeded(): Promise<void> {
    if ((await this.serviceRepo.count()) === 0) {
      const rows = await this.collectSeedServices();
      for (const r of rows) {
        await this.serviceRepo.save(this.serviceRepo.create(r));
      }
      if (rows.length) this.logger.log(`服务种子导入完成：${rows.length} 个`);
    }

    if ((await this.serviceEnvRepo.count()) === 0) {
      const legacy = await this.legacyRouteRepo.find();
      for (const r of legacy) {
        await this.serviceEnvRepo.save(
          this.serviceEnvRepo.create({
            serviceKey: r.serviceName,
            envId: r.envId,
            hostName: r.serverName,
            port: r.port ?? null,
            replicas: 1,
            status: 'active',
          }),
        );
      }
      if (legacy.length) this.logger.log(`服务×环境指向种子导入完成：${legacy.length} 条`);
    }
  }

  /** 种子来源：旧表优先，其次 scripts/modules.json */
  private async collectSeedServices(): Promise<Partial<DeployServiceEntity>[]> {
    const legacy = await this.legacyModuleRepo.find({ where: { type: 'backend' } });
    if (legacy.length) {
      return legacy.map((m) => ({
        key: m.key,
        name: m.name,
        kind: m.key === 'mcp-gateway' ? ('mcp' as const) : ('nest' as const),
        repoDir: m.dir,
        pm2Name: m.pm2 ?? null,
        defaultPort: null,
        healthPath: '/health',
        unknownPolicy: 'allow' as const,
        deployChannel: m.key === 'deploy-console' ? ('legacy' as const) : ('managed' as const),
        description: m.description ?? null,
        builtin: true,
        enabled: true,
      }));
    }
    return this.readModulesJson()
      .filter((m: any) => m.type === 'backend')
      .map((m: any) => ({
        key: m.key,
        name: m.name,
        kind: m.key === 'mcp-gateway' ? ('mcp' as const) : ('nest' as const),
        repoDir: m.dir,
        pm2Name: m.pm2 ?? null,
        defaultPort: null,
        healthPath: '/health',
        unknownPolicy: 'allow' as const,
        deployChannel: m.key === 'deploy-console' ? ('legacy' as const) : ('managed' as const),
        description: null,
        builtin: true,
        enabled: true,
      }));
  }

  private readModulesJson(): any[] {
    const ws = this.configService.get<string>('WEB_SYSTEM_DIR');
    if (!ws) return [];
    const file = path.join(ws, 'scripts', 'modules.json');
    if (!fs.existsSync(file)) return [];
    try {
      return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch (e) {
      this.logger.warn(`scripts/modules.json 解析失败：${(e as Error).message}`);
      return [];
    }
  }

  getMeta() {
    return {
      kinds: SERVICE_KINDS,
      methods: ENDPOINT_METHODS,
      endpointAuthModes: ENDPOINT_AUTH_MODES,
      routeAuthModes: ROUTE_AUTH_MODES,
    };
  }

  // ==================== 服务 ====================

  /** 服务列表（含接口数 / 路由数 / 已配环境数，按服务批量取，避免 N+1） */
  async listServices(query: { q?: string; kind?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 50));
    const kw = (query.q || '').trim().toLowerCase();

    const qb = this.serviceRepo.createQueryBuilder('s').where('s.deletedAt IS NULL');
    if (query.kind && query.kind !== 'all') qb.andWhere('s.kind = :kind', { kind: query.kind });
    if (kw) {
      qb.andWhere('(LOWER(s.key) LIKE :kw OR LOWER(s.name) LIKE :kw)', { kw: `%${kw}%` });
    }
    qb.orderBy('s.key', 'ASC');

    const [items, total] = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    const keys = items.map((s) => s.key);
    const [routes, endpoints, envs] = keys.length
      ? await Promise.all([
          this.routeRepo.find({ where: keys.map((serviceKey) => ({ serviceKey })) }),
          this.endpointRepo.find({ where: keys.map((serviceKey) => ({ serviceKey })) }),
          this.serviceEnvRepo.find({ where: keys.map((serviceKey) => ({ serviceKey })) }),
        ])
      : [[], [], []];

    const group = <T extends { serviceKey: string }>(rows: T[]) => {
      const m = new Map<string, T[]>();
      for (const r of rows) {
        const list = m.get(r.serviceKey) || [];
        list.push(r);
        m.set(r.serviceKey, list);
      }
      return m;
    };
    const routeMap = group(routes);
    const endpointMap = group(endpoints);
    const envMap = group(envs);

    return {
      items: items.map((s) => ({
        ...s,
        routeCount: routeMap.get(s.key)?.length ?? 0,
        endpointCount: endpointMap.get(s.key)?.length ?? 0,
        // 已配置指向的环境（主机组与端口缺一不可，避免"看起来配了其实是空指向"）
        configuredEnvs: (envMap.get(s.key) || [])
          .filter((e) => !!e.hostName && !!e.port)
          .map((e) => e.envId),
      })),
      total,
      page,
      pageSize,
    };
  }

  async getService(key: string): Promise<DeployServiceEntity> {
    const svc = await this.serviceRepo.findOne({ where: { key, deletedAt: IsNull() } });
    if (!svc) throw new NotFoundException(`服务不存在或已删除：${key}`);
    return svc;
  }

  async getServiceDetail(key: string) {
    const svc = await this.getService(key);
    const [routes, endpoints, envs] = await Promise.all([
      this.routeRepo.find({ where: { serviceKey: key }, order: { priority: 'ASC', pathPrefix: 'ASC' } }),
      this.endpointRepo.find({
        where: { serviceKey: key },
        order: { pathPattern: 'ASC', method: 'ASC' },
      }),
      this.serviceEnvRepo.find({ where: { serviceKey: key }, order: { envId: 'ASC' } }),
    ]);
    return {
      ...svc,
      routes,
      endpoints,
      envs,
      endpointCount: endpoints.length,
      routeCount: routes.length,
    };
  }

  async createService(dto: CreateServiceDto): Promise<DeployServiceEntity> {
    const exists = await this.serviceRepo.findOne({ where: { key: dto.key } });
    if (exists) {
      throw new ConflictException(`服务 key 已存在：${dto.key}（key 创建后不可修改）`);
    }
    const saved = await this.serviceRepo.save(
      this.serviceRepo.create({
        key: dto.key,
        name: dto.name.trim(),
        kind: dto.kind ?? 'nest',
        repoDir: dto.repoDir.trim(),
        pm2Name: dto.pm2Name ?? `web-${dto.key}`,
        defaultPort: dto.defaultPort ?? null,
        healthPath: dto.healthPath ?? '/health',
        unknownPolicy: dto.unknownPolicy ?? 'allow',
        deployChannel: dto.deployChannel ?? 'managed',
        description: dto.description ?? null,
        builtin: false,
        enabled: true,
      }),
    );
    this.logger.log(`服务已创建：${saved.key}（kind=${saved.kind}）`);
    return saved;
  }

  async updateService(key: string, dto: UpdateServiceDto): Promise<DeployServiceEntity> {
    const svc = await this.getService(key);
    if (dto.name !== undefined) svc.name = dto.name.trim();
    if (dto.repoDir !== undefined) svc.repoDir = dto.repoDir.trim();
    if (dto.pm2Name !== undefined) svc.pm2Name = dto.pm2Name;
    if (dto.defaultPort !== undefined) svc.defaultPort = dto.defaultPort;
    if (dto.healthPath !== undefined) svc.healthPath = dto.healthPath;
    if (dto.unknownPolicy !== undefined) svc.unknownPolicy = dto.unknownPolicy;
    if (dto.deployChannel !== undefined) svc.deployChannel = dto.deployChannel;
    if (dto.description !== undefined) svc.description = dto.description || null;
    if (dto.enabled !== undefined) svc.enabled = dto.enabled;
    return this.serviceRepo.save(svc);
  }

  /** 软删除：仍被环境指向引用时阻断并列出环境（避免"删了服务还在转发"） */
  async removeService(key: string) {
    const svc = await this.getService(key);
    const bindings = await this.serviceEnvRepo.find({ where: { serviceKey: key } });
    const active = bindings.filter((b) => b.status === 'active' && !!b.hostName);
    if (active.length) {
      throw new BadRequestException(
        `服务 ${key} 仍被 ${active.length} 个环境指向：${active
          .map((b) => b.envId)
          .join('、')}。请先在环境详情解除指向。`,
      );
    }
    svc.deletedAt = new Date();
    svc.enabled = false;
    await this.serviceRepo.save(svc);
    this.logger.warn(`服务已软删除：${key}`);
    return { removed: true, softDeleted: true };
  }

  // ==================== 转发规则（前缀级） ====================

  listRoutes(serviceKey: string, envId?: string) {
    return this.getService(serviceKey).then(() =>
      this.routeRepo.find({
        where: { serviceKey, envId: envId ? envId : IsNull() },
        order: { priority: 'ASC', pathPrefix: 'ASC' },
      }),
    );
  }

  /** 前缀包含关系检测（返回告警而非阻断：包含关系合法但需要更高的优先级意识，FR-7.2） */
  private async prefixOverlaps(
    serviceKey: string,
    envId: string | null,
    pathPrefix: string,
    exceptId?: string,
  ) {
    const rows = await this.routeRepo.find({
      where: { serviceKey, envId: envId ? envId : IsNull() },
      order: { priority: 'ASC' },
    });
    return rows
      .filter(
        (r) =>
          r.id !== exceptId &&
          r.enabled &&
          r.pathPrefix !== pathPrefix &&
          (r.pathPrefix.startsWith(pathPrefix) || pathPrefix.startsWith(r.pathPrefix)),
      )
      .map((r) => ({
        pathPrefix: r.pathPrefix,
        priority: r.priority,
        // shorter = 本规则更宽（会先匹配）/ longer = 本规则更具体
        relation: r.pathPrefix.startsWith(pathPrefix) ? 'longer' : 'shorter',
      }));
  }

  private async assertRouteUnique(
    serviceKey: string,
    envId: string | null,
    pathPrefix: string,
    exceptId?: string,
  ) {
    const rows = await this.routeRepo.find({
      where: { serviceKey, envId: envId ? envId : IsNull() },
    });
    const dup = rows.find((r) => r.id !== exceptId && r.pathPrefix === pathPrefix);
    if (dup) {
      throw new ConflictException(
        `转发规则冲突：${envId ?? '全环境'} 下 ${pathPrefix} 已存在（优先级 ${dup.priority}）`,
      );
    }
  }

  async createRoute(serviceKey: string, dto: ServiceRouteDto) {
    await this.getService(serviceKey);
    if (dto.envId) await this.assertEnvExists(dto.envId);
    const envId = dto.envId ?? null;
    const pathPrefix = dto.pathPrefix.trim();
    await this.assertRouteUnique(serviceKey, envId, pathPrefix);

    const saved = await this.routeRepo.save(
      this.routeRepo.create({
        serviceKey,
        envId,
        pathPrefix,
        stripPrefix: dto.stripPrefix ?? null,
        rewriteTo: dto.rewriteTo ?? null,
        upstreamOverride: dto.upstreamOverride ?? null,
        timeoutMs: dto.timeoutMs ?? 30000,
        authMode: dto.authMode ?? 'passthrough',
        priority: dto.priority ?? 0,
        enabled: dto.enabled ?? true,
      }),
    );
    return { ...saved, warnings: await this.prefixOverlaps(serviceKey, envId, pathPrefix, saved.id) };
  }

  async updateRoute(serviceKey: string, id: string, dto: ServiceRouteDto) {
    await this.getService(serviceKey);
    const route = await this.routeRepo.findOne({ where: { id, serviceKey } });
    if (!route) throw new NotFoundException(`转发规则不存在：${id}`);

    if (dto.pathPrefix !== undefined && dto.pathPrefix.trim() !== route.pathPrefix) {
      await this.assertRouteUnique(serviceKey, route.envId ?? null, dto.pathPrefix.trim(), id);
      route.pathPrefix = dto.pathPrefix.trim();
    }
    if (dto.envId !== undefined) {
      if (dto.envId) await this.assertEnvExists(dto.envId);
      route.envId = dto.envId || null;
    }
    if (dto.stripPrefix !== undefined) route.stripPrefix = dto.stripPrefix || null;
    if (dto.rewriteTo !== undefined) route.rewriteTo = dto.rewriteTo || null;
    if (dto.upstreamOverride !== undefined) route.upstreamOverride = dto.upstreamOverride || null;
    if (dto.timeoutMs !== undefined) route.timeoutMs = dto.timeoutMs;
    if (dto.authMode !== undefined) route.authMode = dto.authMode;
    if (dto.priority !== undefined) route.priority = dto.priority;
    if (dto.enabled !== undefined) route.enabled = dto.enabled;

    const saved = await this.routeRepo.save(route);
    return {
      ...saved,
      warnings: await this.prefixOverlaps(serviceKey, saved.envId ?? null, saved.pathPrefix, saved.id),
    };
  }

  async removeRoute(serviceKey: string, id: string) {
    await this.getService(serviceKey);
    const res = await this.routeRepo.delete({ id, serviceKey });
    if (!res.affected) throw new NotFoundException(`转发规则不存在：${id}`);
    return { removed: true };
  }

  private async assertEnvExists(envId: string) {
    const env = await this.envRepo.findOne({ where: { envId } });
    if (!env) throw new BadRequestException(`环境不存在：${envId}`);
  }

  // ==================== 接口清单（方法 + 路径级） ====================

  async listEndpoints(
    serviceKey: string,
    query: { method?: string; q?: string; deprecated?: string; page?: number; pageSize?: number },
  ) {
    await this.getService(serviceKey);
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(500, Math.max(1, Number(query.pageSize) || 100));
    const kw = (query.q || '').trim().toLowerCase();

    const qb = this.endpointRepo
      .createQueryBuilder('e')
      .where('e.serviceKey = :serviceKey', { serviceKey });
    // 注意：前端"全部"传小写 all；大写 ALL 是**方法值本身**（匹配任意方法），二者语义不同
    if (query.method && query.method !== 'all') {
      qb.andWhere('e.method = :method', { method: query.method });
    }
    if (query.deprecated === '1') qb.andWhere('e.deprecated = :d', { d: true });
    if (query.deprecated === '0') qb.andWhere('e.deprecated = :d', { d: false });
    if (kw) {
      qb.andWhere(
        '(LOWER(e.pathPattern) LIKE :kw OR LOWER(COALESCE(e.code,\'\')) LIKE :kw OR LOWER(COALESCE(e.summary,\'\')) LIKE :kw)',
        { kw: `%${kw}%` },
      );
    }
    qb.orderBy('e.pathPattern', 'ASC').addOrderBy('e.method', 'ASC');

    const [items, total] = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    return { items, total, page, pageSize };
  }

  async createEndpoint(serviceKey: string, dto: EndpointDto) {
    await this.getService(serviceKey);
    const exists = await this.endpointRepo.findOne({
      where: { serviceKey, method: dto.method, pathPattern: dto.pathPattern.trim() },
    });
    if (exists) {
      throw new ConflictException(
        `接口已存在：${dto.method} ${dto.pathPattern}（同一服务下方法+路径唯一）`,
      );
    }
    return this.endpointRepo.save(this.endpointRepo.create(this.endpointPayload(serviceKey, dto, 'manual')));
  }

  async updateEndpoint(serviceKey: string, id: string, dto: Partial<EndpointDto>) {
    await this.getService(serviceKey);
    const row = await this.endpointRepo.findOne({ where: { id, serviceKey } });
    if (!row) throw new NotFoundException(`接口不存在：${id}`);
    if (dto.method !== undefined) row.method = dto.method;
    if (dto.pathPattern !== undefined) row.pathPattern = dto.pathPattern.trim();
    if (dto.code !== undefined) row.code = dto.code || null;
    if (dto.summary !== undefined) row.summary = dto.summary || null;
    if (dto.authMode !== undefined) row.authMode = dto.authMode;
    if (dto.permissionCode !== undefined) row.permissionCode = dto.permissionCode || null;
    if (dto.rateLimitPerMin !== undefined) row.rateLimitPerMin = dto.rateLimitPerMin;
    if (dto.timeoutMs !== undefined) row.timeoutMs = dto.timeoutMs;
    if (dto.deprecated !== undefined) row.deprecated = dto.deprecated;
    if (dto.enabled !== undefined) row.enabled = dto.enabled;
    // 人工改过 → 标记为 manual，后续导入不再视为"可补空"目标
    row.source = 'manual';
    return this.endpointRepo.save(row);
  }

  async removeEndpoint(serviceKey: string, id: string) {
    await this.getService(serviceKey);
    const res = await this.endpointRepo.delete({ id, serviceKey });
    if (!res.affected) throw new NotFoundException(`接口不存在：${id}`);
    return { removed: true };
  }

  private endpointPayload(
    serviceKey: string,
    dto: EndpointDto,
    source: 'manual' | 'openapi' | 'scan',
  ): Partial<DeployEndpointEntity> {
    return {
      serviceKey,
      method: dto.method,
      pathPattern: dto.pathPattern.trim(),
      code: dto.code ?? null,
      summary: dto.summary ?? null,
      authMode: dto.authMode ?? 'inherit',
      permissionCode: dto.permissionCode ?? null,
      rateLimitPerMin: dto.rateLimitPerMin ?? null,
      timeoutMs: dto.timeoutMs ?? null,
      deprecated: dto.deprecated ?? false,
      source,
      enabled: dto.enabled ?? true,
    };
  }

  /**
   * 批量导入（UPSERT **只补空字段**，FR-6.5 / V8）
   *
   * - 不存在 → 创建（source 标记来源）
   * - 已存在 → 仅把**为空的字段**补齐；**不覆盖**既有非空值、不改 `deprecated` / `enabled`
   * - 批内重复（同 method+path）→ 取首个，其余计入 skipped
   */
  async importEndpoints(serviceKey: string, dto: ImportEndpointsDto) {
    await this.getService(serviceKey);
    const source = dto.source ?? 'openapi';

    const dedup = new Map<string, EndpointDto>();
    let skipped = 0;
    for (const item of dto.items || []) {
      const k = `${item.method} ${item.pathPattern.trim()}`;
      if (dedup.has(k)) {
        skipped++;
        continue;
      }
      dedup.set(k, item);
    }

    let created = 0;
    let filled = 0;
    const details: { key: string; action: 'created' | 'filled' | 'skipped'; fields?: string[] }[] = [];

    for (const [k, item] of dedup) {
      const existing = await this.endpointRepo.findOne({
        where: { serviceKey, method: item.method, pathPattern: item.pathPattern.trim() },
      });
      if (!existing) {
        await this.endpointRepo.save(this.endpointRepo.create(this.endpointPayload(serviceKey, item, source)));
        created++;
        details.push({ key: k, action: 'created' });
        continue;
      }

      const fields: string[] = [];
      const incomingRec = item as unknown as Record<string, unknown>;
      const existingRec = existing as unknown as Record<string, unknown>;
      for (const f of FILLABLE_ENDPOINT_FIELDS) {
        const incoming = incomingRec[f];
        if (incoming === undefined || incoming === null || incoming === '') continue;
        if (isEmptyValue(f, existingRec[f])) {
          existingRec[f] = incoming;
          fields.push(f);
        }
      }
      if (fields.length) {
        // 保留原 source（人工维护过的仍是 manual）
        await this.endpointRepo.save(existing);
        filled++;
        details.push({ key: k, action: 'filled', fields });
      } else {
        skipped++;
        details.push({ key: k, action: 'skipped' });
      }
    }

    this.logger.log(
      `接口导入 ${serviceKey}（source=${source}）：新增 ${created} / 补空 ${filled} / 跳过 ${skipped}`,
    );
    return { total: (dto.items || []).length, created, filled, skipped, details };
  }

  // ==================== 服务 × 环境（只读） / 探活 ====================

  /** 各环境运行时与主机（**只读**；编辑入口在环境详情，Q104） */
  async listServiceEnvs(serviceKey: string) {
    const svc = await this.getService(serviceKey);
    const [envs, rows] = await Promise.all([
      this.envRepo.find({ where: { enabled: true }, order: { siteKey: 'ASC', sort: 'ASC' } }),
      this.serviceEnvRepo.find({ where: { serviceKey } }),
    ]);
    const byEnv = new Map(rows.map((r) => [r.envId, r]));
    const hostNames = [...new Set(rows.map((r) => r.hostName).filter((n): n is string => !!n))];
    const hosts = hostNames.length
      ? await this.hostRepo.find({ where: { name: In(hostNames) } })
      : [];
    const addrByName = new Map(hosts.filter((h) => h.enabled).map((h) => [h.name, h.host]));

    return {
      service: svc,
      items: envs.map((e) => {
        const r = byEnv.get(e.envId);
        const hostName = r?.hostName ?? null;
        // Q19：端口不继承 defaultPort，未填即未配置
        const port = r?.port ?? null;
        return {
          envId: e.envId,
          envName: e.name,
          siteKey: e.siteKey,
          isProd: e.isProd,
          configured: !!hostName && !!port,
          hostName,
          /** 主机组解析出的可解析地址（转发/探活实际用它） */
          hostAddress: hostName ? addrByName.get(hostName) ?? null : null,
          port,
          upstreamUrl: r?.upstreamUrl ?? null,
          replicas: r?.replicas ?? 1,
          runtime: r?.runtime ?? null,
          status: r?.status ?? 'unconfigured',
        };
      }),
    };
  }

  /**
   * 解析该服务在某环境的目标地址（网关与探活共用）。
   *
   * Q17 方案 D：`hostName` 只是主机**组名**，地址须查 `deploy_hosts.host`；
   * Q19：端口**不继承** `defaultPort`，缺端口即配置错误（fail-fast，不回落 80 端口）。
   */
  private async resolveUpstream(serviceKey: string, envId: string) {
    const svc = await this.getService(serviceKey);
    const row = await this.serviceEnvRepo.findOne({ where: { serviceKey, envId } });
    if (row?.upstreamUrl) return { url: row.upstreamUrl, row, svc };
    if (!row?.hostName) return { url: null, row, svc };

    const host = await this.hostRepo.findOne({ where: { name: row.hostName } });
    if (!host) {
      throw new BadRequestException(
        `主机组 ${row.hostName} 未在「主机管理」登记，无法解析 ${serviceKey} 在 ${envId} 的地址（不允许回落到本机）`,
      );
    }
    if (!host.enabled) {
      throw new BadRequestException(`主机组 ${row.hostName} 已停用，无法解析 ${serviceKey} 在 ${envId} 的地址`);
    }
    if (!row.port) {
      throw new BadRequestException(
        `服务 ${serviceKey} 在环境 ${envId} 未配置端口，无法解析上游地址（端口不继承服务默认值，请到「环境详情 → 后端服务指向」补齐）`,
      );
    }
    return { url: `http://${host.host}:${row.port}`, row, svc };
  }

  /**
   * 手动探活：GET <upstream><healthPath>（3s 超时）。
   * 未配置主机 → **明确报错**，不回落本机（B4）。
   */
  async probeHealth(serviceKey: string, envId: string) {
    const { url, svc, row } = await this.resolveUpstream(serviceKey, envId);
    if (!url) {
      throw new BadRequestException(
        `服务 ${serviceKey} 在环境 ${envId} 未配置目标主机，无法探活（不允许回落到本机）`,
      );
    }
    const target = `${url.replace(/\/+$/, '')}${row?.healthPath || svc.healthPath || '/health'}`;
    const started = Date.now();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const res = await fetch(target, { signal: ctrl.signal });
      clearTimeout(timer);
      return {
        ok: res.ok,
        status: res.status,
        target,
        latencyMs: Date.now() - started,
      };
    } catch (e) {
      return {
        ok: false,
        status: 0,
        target,
        latencyMs: Date.now() - started,
        error: (e as Error).message,
      };
    }
  }

}
