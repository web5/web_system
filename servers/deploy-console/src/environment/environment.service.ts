import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not } from 'typeorm';
import { DeployEnvironmentEntity } from '../entities/deploy-environment.entity';
import { DeployModuleEntity } from '../entities/deploy-module.entity';
import { EnvironmentDto } from '../common/dto';

/** 迁移期保留的旧全局行标记（scripts/migrations/p5-module-env-ownership.mjs M3） */
const LEGACY_MODULE_KEY = '__legacy__';

/**
 * 环境服务 —— **环境归属模块（1:N）**。
 *
 * - 一个模块有多个环境，一个环境只属于一个模块（复合主键 `(module_key, id)`）。
 * - dev / prod 是「每模块各一份」的内置环境（builtin：不可删，地址可改）。
 * - 服务地址真相源是 `address`（单值）；`ports` 仅为迁移回滚期保留（双读回退）。
 *
 * 设计见 specs/module-env-ownership/design.md。
 */
@Injectable()
export class EnvironmentService implements OnModuleInit {
  private readonly logger = new Logger(EnvironmentService.name);

  constructor(
    @InjectRepository(DeployEnvironmentEntity)
    private readonly envRepo: Repository<DeployEnvironmentEntity>,
    @InjectRepository(DeployModuleEntity)
    private readonly moduleRepo: Repository<DeployModuleEntity>,
  ) {}

  /**
   * 启动时：为每个已注册模块补齐 dev / prod 内置环境（幂等）。
   * 若检测到未迁移的旧全局行（module_key IS NULL），只告警不阻断——迁移脚本先跑。
   */
  async onModuleInit() {
    const legacy = await this.envRepo.count({ where: { moduleKey: IsNull() } });
    if (legacy > 0) {
      this.logger.warn(
        `检测到 ${legacy} 条未迁移的旧全局环境行（module_key IS NULL），请先执行 scripts/migrations/p5-module-env-ownership.mjs`,
      );
      return;
    }
    const modules = await this.moduleRepo.find();
    for (const m of modules) {
      try {
        await this.ensureModuleEnvs(m.key);
      } catch (e: any) {
        this.logger.error(`为模块 ${m.key} 补环境失败: ${e?.message}`);
      }
    }
  }

  // ---------- 内置环境默认值（仅 backend 模块有服务地址） ----------
  private defaultDevAddress(moduleKey: string, type: string): string | undefined {
    if (type !== 'backend') return undefined;
    const map: Record<string, string> = {
      gateway: '127.0.0.1:6000',
      'auth-service': '127.0.0.1:6001',
      'user-service': '127.0.0.1:6002',
      'ai-service': '127.0.0.1:6003',
      'system-service': '127.0.0.1:6004',
      'todo-service': '127.0.0.1:6005',
      'mcp-gateway': '127.0.0.1:6006',
      'content-hub': '127.0.0.1:6007',
      'upload-service': '127.0.0.1:6008',
      'deploy-console': '127.0.0.1:6200',
    };
    return map[moduleKey];
  }

  private defaultProdAddress(moduleKey: string, type: string): string | undefined {
    if (type !== 'backend') return undefined;
    const map: Record<string, string> = {
      gateway: 'kedouai.com:3000',
      'auth-service': 'kedouai.com:3001',
      'user-service': 'kedouai.com:3002',
      'ai-service': 'kedouai.com:3003',
      'system-service': 'kedouai.com:3004',
      'mcp-gateway': '127.0.0.1:6006',
    };
    return map[moduleKey];
  }

  /**
   * 为模块补齐 dev / prod 内置环境（幂等，缺哪条补哪条）。
   * 新建模块、或历史模块从未初始化过环境时调用。
   */
  async ensureModuleEnvs(moduleKey: string): Promise<DeployEnvironmentEntity[]> {
    const m = await this.moduleRepo.findOne({ where: { key: moduleKey } });
    if (!m) throw new NotFoundException(`模块不存在: ${moduleKey}`);

    const existing = await this.envRepo.find({ where: { moduleKey } });
    const has = (id: string) => existing.some((e) => e.id === id);
    const created: DeployEnvironmentEntity[] = [];

    const seeds: Array<{ id: string; name: string; publicUrl: string; address?: string }> = [
      {
        id: 'dev',
        name: '开发环境',
        publicUrl: 'https://dev.kedouai.com',
        address: this.defaultDevAddress(m.key, m.type),
      },
      {
        id: 'prod',
        name: '生产环境',
        publicUrl: 'https://kedouai.com',
        address: this.defaultProdAddress(m.key, m.type),
      },
    ];

    for (const s of seeds) {
      if (has(s.id)) continue;
      const e = new DeployEnvironmentEntity();
      e.moduleKey = moduleKey;
      e.id = s.id;
      e.name = s.name;
      e.publicUrl = s.publicUrl;
      e.address = s.address;
      e.builtin = true;
      created.push(await this.envRepo.save(e));
    }
    if (created.length) {
      this.logger.log(`模块 ${moduleKey} 补建内置环境: ${created.map((e) => e.id).join(', ')}`);
    }
    return created;
  }

  /** 列表：按模块、按环境 id（跨模块）或全量 */
  async list(opts?: { moduleKey?: string; id?: string }): Promise<DeployEnvironmentEntity[]> {
    // 默认排除迁移期保留的旧全局行（module_key='__legacy__'）
    const where: any = { moduleKey: Not(LEGACY_MODULE_KEY) };
    if (opts?.moduleKey) where.moduleKey = opts.moduleKey;
    if (opts?.id) where.id = opts.id;
    return this.envRepo.find({
      where,
      order: { moduleKey: 'ASC', builtin: 'DESC', id: 'ASC' },
    });
  }

  /**
   * 环境字典（跨模块去重，按 id 聚合）—— 供审计/通知等纯筛选下拉使用。
   * 迁移期：若新数据尚未就绪（表为空），回退为旧全局行。
   */
  async dict(): Promise<
    Array<{ id: string; name: string; publicUrl?: string; builtin: boolean; moduleCount: number }>
  > {
    const rows = await this.list();
    const map = new Map<
      string,
      { id: string; name: string; publicUrl?: string; builtin: boolean; moduleCount: number }
    >();
    for (const e of rows) {
      const hit = map.get(e.id);
      if (hit) {
        hit.moduleCount += 1;
        continue;
      }
      map.set(e.id, {
        id: e.id,
        name: e.name,
        publicUrl: e.publicUrl,
        builtin: e.builtin,
        moduleCount: 1,
      });
    }
    return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  async get(moduleKey: string, id: string): Promise<DeployEnvironmentEntity> {
    const e = await this.envRepo.findOne({ where: { moduleKey, id } });
    if (!e) throw new NotFoundException(`环境不存在: ${moduleKey}/${id}`);
    return e;
  }

  async create(moduleKey: string, dto: EnvironmentDto): Promise<DeployEnvironmentEntity> {
    const m = await this.moduleRepo.findOne({ where: { key: moduleKey } });
    if (!m) throw new NotFoundException(`模块不存在: ${moduleKey}`);

    const exists = await this.envRepo.findOne({ where: { moduleKey, id: dto.id } });
    if (exists) throw new BadRequestException(`环境已存在: ${moduleKey}/${dto.id}`);

    const e = new DeployEnvironmentEntity();
    e.moduleKey = moduleKey;
    e.id = dto.id;
    e.name = dto.name;
    e.publicUrl = dto.publicUrl;
    e.address = dto.address;
    e.serverName = dto.serverName;
    e.port = dto.port;
    e.builtin = false;

    // copyFrom：复制本模块已有环境的地址/服务器组/公网地址作初值
    if (dto.copyFrom) {
      const base = await this.envRepo.findOne({ where: { moduleKey, id: dto.copyFrom } });
      if (base) {
        e.address = e.address ?? base.address;
        e.serverName = e.serverName ?? base.serverName;
        e.port = e.port ?? base.port;
        e.publicUrl = e.publicUrl ?? base.publicUrl;
      }
    }
    return this.envRepo.save(e);
  }

  async update(
    moduleKey: string,
    id: string,
    dto: Partial<EnvironmentDto>,
  ): Promise<DeployEnvironmentEntity> {
    const e = await this.get(moduleKey, id);
    if (dto.name !== undefined) e.name = dto.name;
    if (dto.publicUrl !== undefined) e.publicUrl = dto.publicUrl;
    if (dto.address !== undefined) e.address = dto.address;
    if (dto.serverName !== undefined) e.serverName = dto.serverName;
    if (dto.port !== undefined) e.port = dto.port;
    // builtin 不可被改为 false（地址等字段仍可改）
    return this.envRepo.save(e);
  }

  /** 删除前统计关联记录（本期不做物理级联，只如实返回供前端二次确认） */
  async stats(moduleKey: string, id: string) {
    const q = async (sql: string, params: any[]) =>
      Number((await this.envRepo.query(sql, params))?.[0]?.c ?? 0);
    const [deployments, routes, canaryRules, versions] = await Promise.all([
      q('SELECT COUNT(*) c FROM deploy_deployments WHERE env_id=? AND module_key=?', [id, moduleKey]),
      q('SELECT COUNT(*) c FROM deploy_env_service_routes WHERE env_id=? AND service_name=?', [
        id,
        moduleKey,
      ]),
      q('SELECT COUNT(*) c FROM deploy_canary_rules WHERE env_id=? AND module_key=?', [
        id,
        moduleKey,
      ]),
      q('SELECT COUNT(*) c FROM deploy_versions WHERE env=? AND component=?', [id, moduleKey]),
    ]);
    return { deployments, routes, canaryRules, versions };
  }

  async remove(moduleKey: string, id: string): Promise<{ ok: boolean; cascade: any }> {
    const e = await this.get(moduleKey, id);
    if (e.builtin) throw new BadRequestException(`内置环境 ${id} 不可删除`);
    const cascade = await this.stats(moduleKey, id);
    await this.envRepo.remove(e);
    return { ok: true, cascade };
  }

  /**
   * 解析某模块在某环境的服务地址（监控/部署统一入口）。
   * 双读：address 优先，回退旧 ports[moduleKey]（迁移回滚期）。
   */
  async resolveAddress(moduleKey: string, envId: string): Promise<string | undefined> {
    const e = await this.envRepo.findOne({ where: { moduleKey, id: envId } });
    if (!e) return undefined;
    return e.address || e.ports?.[moduleKey] || undefined;
  }
}
