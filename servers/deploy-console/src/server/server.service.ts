import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeployServerEntity } from '../entities/deploy-server.entity';
import { DeployEnvServiceRouteEntity } from '../entities/deploy-env-service-route.entity';
import { ServerDto, EnvServiceRouteDto } from '../common/dto';
import { EnvironmentService } from '../environment/environment.service';
import { ModuleRegistryService } from '../module-registry/module-registry.service';

/**
 * 服务器组 + 环境服务路由服务。
 * - serverName 是「服务器组」：多台服务器共享同名（多副本/负载均衡）。
 * - 每个前端环境独立定义「服务名 → serverName」的路由。
 */
@Injectable()
export class ServerService {
  constructor(
    @InjectRepository(DeployServerEntity)
    private readonly serverRepo: Repository<DeployServerEntity>,
    @InjectRepository(DeployEnvServiceRouteEntity)
    private readonly routeRepo: Repository<DeployEnvServiceRouteEntity>,
    private readonly environmentService: EnvironmentService,
    private readonly moduleRegistry: ModuleRegistryService,
  ) {}

  // ---------- 服务器 ----------

  listServers(serverName?: string): Promise<DeployServerEntity[]> {
    const where: any = {};
    if (serverName) where.serverName = serverName;
    return this.serverRepo.find({ where, order: { serverName: 'ASC', host: 'ASC' } });
  }

  async createServer(dto: ServerDto): Promise<DeployServerEntity> {
    const exists = await this.serverRepo.findOne({
      where: { serverName: dto.serverName, host: dto.host },
    });
    if (exists) throw new BadRequestException(`服务器已存在: ${dto.serverName}@${dto.host}`);
    return this.serverRepo.save(this.serverRepo.create(dto));
  }

  async removeServer(id: string): Promise<{ ok: boolean }> {
    const s = await this.serverRepo.findOne({ where: { id } });
    if (!s) throw new NotFoundException(`服务器不存在: ${id}`);
    await this.serverRepo.remove(s);
    return { ok: true };
  }

  // ---------- 环境服务路由 ----------

  listRoutes(envId?: string): Promise<DeployEnvServiceRouteEntity[]> {
    const where: any = {};
    if (envId) where.envId = envId;
    return this.routeRepo.find({ where, order: { envId: 'ASC', serviceName: 'ASC' } });
  }

  async createRoute(dto: EnvServiceRouteDto): Promise<DeployEnvServiceRouteEntity> {
    const exists = await this.routeRepo.findOne({
      where: { envId: dto.envId, serviceName: dto.serviceName },
    });
    if (exists) {
      // 已存在则更新指向（每环境每服务一条路由）
      exists.serverName = dto.serverName;
      if (dto.port !== undefined) exists.port = dto.port;
      return this.routeRepo.save(exists);
    }
    return this.routeRepo.save(this.routeRepo.create(dto));
  }

  async removeRoute(id: string): Promise<{ ok: boolean }> {
    const r = await this.routeRepo.findOne({ where: { id } });
    if (!r) throw new NotFoundException(`路由不存在: ${id}`);
    await this.routeRepo.remove(r);
    return { ok: true };
  }

  // ---------- 解析（供 deploy.service 使用） ----------

  /**
   * 解析「环境 + 服务」指向的服务器组，返回该组下的全部服务器。
   * 无路由时返回空数组（调用方回退环境默认服务器）。
   */
  async resolveServers(envId: string, serviceName: string): Promise<DeployServerEntity[]> {
    const route = await this.routeRepo.findOne({ where: { envId, serviceName } });
    if (!route) return [];
    return this.serverRepo.find({ where: { serverName: route.serverName }, order: { host: 'ASC' } });
  }

  /** 查询「环境 + 服务」的路由记录（含 serverName / port） */
  async resolveRoute(envId: string, serviceName: string): Promise<DeployEnvServiceRouteEntity | null> {
    return this.routeRepo.findOne({ where: { envId, serviceName } });
  }

  /**
   * 解析环境默认服务器（约定 serverName = <env>-default 的第一台）。
   * 用于无显式路由时的回退，以及监控等「按环境取一台服务器」的场景。
   */
  async resolveEnvDefaultServer(envId: string): Promise<DeployServerEntity | null> {
    const servers = await this.serverRepo.find({
      where: { serverName: `${envId}-default` },
      order: { host: 'ASC' },
    });
    return servers[0] || null;
  }

  // ---------- 服务地址总览（供「服务管理」大表格） ----------

  /**
   * 聚合「服务 × 环境」的完整视图，供服务管理大表格使用。
   * 每行：服务名 + 环境 + 服务地址（environments.ports）+ 服务器组（env_service_routes）。
   */
  async getServiceOverview(): Promise<Array<{
    serviceName: string;
    serviceType: string;
    envId: string;
    address: string;
    serverName: string;
    port?: number;
  }>> {
    const [modules, environments, routes] = await Promise.all([
      this.moduleRegistry.list(),
      this.environmentService.list(),
      this.routeRepo.find(),
    ]);

    const backendModules = modules.filter((m: any) => m.type === 'backend');
    const routeMap = new Map<string, DeployEnvServiceRouteEntity>();
    for (const r of routes) {
      routeMap.set(`${r.envId}:${r.serviceName}`, r);
    }

    const rows: Array<{
      serviceName: string;
      serviceType: string;
      envId: string;
      address: string;
      serverName: string;
      port?: number;
    }> = [];

    for (const env of environments) {
      const ports = (env.ports || {}) as Record<string, string>;
      for (const m of backendModules) {
        const route = routeMap.get(`${env.id}:${m.key}`);
        rows.push({
          serviceName: m.key,
          serviceType: m.type,
          envId: env.id,
          address: ports[m.key] || '',
          serverName: route?.serverName || '',
          port: route?.port,
        });
      }
    }

    return rows;
  }
}
