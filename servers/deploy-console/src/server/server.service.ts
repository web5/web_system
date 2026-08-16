import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeployServerEntity } from '../entities/deploy-server.entity';
import { DeployEnvServiceRouteEntity } from '../entities/deploy-env-service-route.entity';
import { ServerDto, EnvServiceRouteDto } from '../common/dto';

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
}
