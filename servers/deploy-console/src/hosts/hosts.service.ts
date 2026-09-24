import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { DeployHostEntity } from '../entities/deploy-host.entity';
import { DeployServiceEnvEntity } from '../entities/deploy-service-env.entity';
import { CreateHostDto, UpdateHostDto } from './dto';

/**
 * 主机（组）管理 —— 服务环境指向的**唯一地址来源**
 *
 * 设计依据：specs/deploy-console-domain-split/page-spec.md §9.4（Q17 方案 D）
 * - `name` = 主机**组名**，被 `deploy_service_envs.host_name` 引用（同组可多台 = 多副本）
 * - `host` = 可解析地址（IP/域名）：**转发上游与 SSH 发布都取它**，IP 只在此一处维护
 * - 组名是引用键：创建后不可改（改名 = 断引用）
 */
@Injectable()
export class HostsService {
  private readonly logger = new Logger(HostsService.name);

  constructor(
    @InjectRepository(DeployHostEntity)
    private readonly hostRepo: Repository<DeployHostEntity>,
    @InjectRepository(DeployServiceEnvEntity)
    private readonly serviceEnvRepo: Repository<DeployServiceEnvEntity>,
  ) {}

  /** 列表（默认全部；`enabledOnly=true` 供下拉只出可用主机） */
  list(enabledOnly = false): Promise<DeployHostEntity[]> {
    return this.hostRepo.find({
      where: enabledOnly ? { enabled: true } : {},
      order: { name: 'ASC', host: 'ASC' },
    });
  }

  async get(name: string): Promise<DeployHostEntity> {
    const host = await this.hostRepo.findOne({ where: { name } });
    if (!host) throw new NotFoundException(`主机组不存在：${name}`);
    return host;
  }

  /** 按组名解析可解析地址（转发/探活共用；未登记或停用 → 抛错，绝不回落本机） */
  async resolveAddress(name: string): Promise<string> {
    const host = await this.hostRepo.findOne({ where: { name } });
    if (!host) {
      throw new BadRequestException(
        `主机组 ${name} 未在「主机管理」登记，无法解析转发地址（不允许回落到本机）`,
      );
    }
    if (!host.enabled) {
      throw new BadRequestException(`主机组 ${name} 已停用，无法解析转发地址`);
    }
    return host.host;
  }

  /**
   * 某环境涉及的主机（去重、仅启用，并按归属控制台过滤）
   *
   * 口径（docs/development/console-monitor-followups.md §4.4 b2）：
   * 主机是环境的真相源 —— 环境↔主机的关联在 `deploy_service_envs.hostName`，
   * `managedBy` 为 NULL 表示所有控制台可见，否则仅该控制台实例（CONSOLE_INSTANCE）可管。
   * 不传 consoleInstance 时不做归属过滤（内部/迁移用途）。
   */
  async resolveEnvHosts(envId: string, consoleInstance?: string): Promise<DeployHostEntity[]> {
    const rows = await this.serviceEnvRepo.find({ where: { envId } });
    const hostNames = [...new Set(rows.map((r) => r.hostName).filter((n): n is string => !!n))];
    if (!hostNames.length) return [];
    const hosts = await this.hostRepo.find({ where: { name: In(hostNames), enabled: true } });
    if (!consoleInstance) return hosts;
    return hosts.filter((h) => !h.managedBy || h.managedBy === consoleInstance);
  }

  /**
   * 解析「服务 × 环境」落在哪台主机（发布/探活共用；未登记或停用 → null，由调用方决定回退）
   */
  async resolveHostForService(
    envId: string,
    serviceKey: string,
  ): Promise<DeployHostEntity | null> {
    const row = await this.serviceEnvRepo.findOne({ where: { envId, serviceKey } });
    if (!row?.hostName) return null;
    const host = await this.hostRepo.findOne({ where: { name: row.hostName, enabled: true } });
    return host || null;
  }

  /**
   * 当前控制台可管的环境 id 集合（= 有主机落脚点的环境，按 managedBy 过滤后）。
   * 顺序按环境字典由调用方决定，这里只返回可管集合。
   */
  async listManagedEnvIds(consoleInstance: string): Promise<string[]> {
    const rows = await this.serviceEnvRepo.find();
    const hostNames = [...new Set(rows.map((r) => r.hostName).filter((n): n is string => !!n))];
    if (!hostNames.length) return [];
    const hosts = await this.hostRepo.find({ where: { name: In(hostNames), enabled: true } });
    const allowed = new Set(
      hosts.filter((h) => !h.managedBy || h.managedBy === consoleInstance).map((h) => h.name),
    );
    const envIds = new Set(
      rows.filter((r) => !!r.hostName && allowed.has(r.hostName)).map((r) => r.envId),
    );
    return [...envIds];
  }

  async create(dto: CreateHostDto): Promise<DeployHostEntity> {
    const exists = await this.hostRepo.findOne({ where: { name: dto.name, host: dto.host } });
    if (exists) {
      throw new BadRequestException(`主机 ${dto.name}/${dto.host} 已存在`);
    }
    const saved = await this.hostRepo.save(
      this.hostRepo.create({
        name: dto.name,
        host: dto.host,
        sshUser: dto.sshUser,
        sshKeyPath: dto.sshKeyPath || null,
        remoteDir: dto.remoteDir,
        runtime: dto.runtime || 'pm2',
        scope: dto.scope || 'cloud',
        managedBy: dto.managedBy?.trim() || null,
        enabled: dto.enabled ?? true,
      }),
    );
    this.logger.log(`主机组已创建：${saved.name} → ${saved.host}`);
    return saved;
  }

  async update(name: string, dto: UpdateHostDto): Promise<DeployHostEntity> {
    const host = await this.get(name);
    if (dto.host !== undefined) host.host = dto.host;
    if (dto.sshUser !== undefined) host.sshUser = dto.sshUser;
    if (dto.sshKeyPath !== undefined) host.sshKeyPath = dto.sshKeyPath || null;
    if (dto.remoteDir !== undefined) host.remoteDir = dto.remoteDir;
    if (dto.runtime !== undefined) host.runtime = dto.runtime;
    if (dto.scope !== undefined) host.scope = dto.scope;
    if (dto.managedBy !== undefined) host.managedBy = dto.managedBy?.trim() || null;
    if (dto.enabled !== undefined) host.enabled = dto.enabled;
    const saved = await this.hostRepo.save(host);
    this.logger.log(`主机组已更新：${saved.name} → ${saved.host}`);
    return saved;
  }

  /** 删除前占用检查：仍被服务环境引用 → 阻断并列出引用方 */
  async findOccupants(name: string): Promise<string[]> {
    const rows = await this.serviceEnvRepo.find({ where: { hostName: name } });
    return rows.map((r) => `${r.serviceKey}@${r.envId}`);
  }

  async remove(name: string): Promise<{ removed: boolean; occupants: string[] }> {
    const host = await this.get(name);
    const occupants = await this.findOccupants(name);
    if (occupants.length) {
      throw new BadRequestException(
        `主机组 ${name} 仍被 ${occupants.length} 个服务指向引用：${occupants.join('、')}。请先改指向后再删除。`,
      );
    }
    await this.hostRepo.remove(host);
    this.logger.warn(`主机组已删除：${name}（${host.host}）`);
    return { removed: true, occupants: [] };
  }
}
