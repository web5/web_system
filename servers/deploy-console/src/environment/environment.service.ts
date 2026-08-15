import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeployEnvironmentEntity } from '../entities/deploy-environment.entity';
import { EnvironmentDto } from '../common/dto';

/**
 * 环境注册表服务。
 * - 管理 dev/prod（builtin，不可删）与自定义环境的增删改查。
 * - 后端模块端口映射（ports）存于此，监控/部署统一读取，实现「不同环境指向不同端口」。
 * - 启动时若表为空，从 .env 自动种子注入 dev/prod。
 */
@Injectable()
export class EnvironmentService {
  private readonly logger = new Logger(EnvironmentService.name);

  constructor(
    @InjectRepository(DeployEnvironmentEntity)
    private readonly envRepo: Repository<DeployEnvironmentEntity>,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 启动时种子：若表为空，注入 dev/prod（含各自端口映射）
   */
  async onModuleInit() {
    const count = await this.envRepo.count();
    if (count > 0) return;
    this.logger.log('环境表为空，自动种子注入 dev/prod ...');
    await this.seedDev();
    await this.seedProd();
  }

  private defaultPortsDev(): Record<string, number> {
    return {
      gateway: 6000,
      'auth-service': 6001,
      'user-service': 6002,
      'ai-service': 6003,
      'system-service': 6004,
      'todo-service': 6005,
      'mcp-gateway': 6006,
      finnews: 6007,
      'upload-service': 6008,
    };
  }

  private defaultPortsProd(): Record<string, number> {
    return {
      gateway: 3000,
      'auth-service': 3001,
      'user-service': 3002,
      'ai-service': 3003,
      'system-service': 3004,
      'mcp-gateway': 6006,
    };
  }

  private async seedDev() {
    const e = new DeployEnvironmentEntity();
    e.id = 'dev';
    e.name = '开发环境';
    e.host = this.configService.get('DEV_SERVER') || '175.27.189.123';
    e.sshUser = this.configService.get('DEV_USER') || 'ubuntu';
    e.sshKeyPath = this.configService.get('DEV_KEY') || '~/.ssh/id_ed25519_servers';
    e.remoteDir = '/data/web_system';
    e.publicUrl = 'https://dev.kedouai.com';
    e.ports = this.defaultPortsDev();
    e.builtin = true;
    await this.envRepo.save(e);
  }

  private async seedProd() {
    const e = new DeployEnvironmentEntity();
    e.id = 'prod';
    e.name = '生产环境';
    e.host = this.configService.get('PROD_SERVER') || '106.52.176.246';
    e.sshUser = this.configService.get('PROD_USER') || 'root';
    e.sshKeyPath = this.configService.get('PROD_KEY') || '~/.ssh/id_ed25519_servers';
    e.remoteDir = '/data/web_system';
    e.publicUrl = 'https://portal.kedouai.com';
    e.ports = this.defaultPortsProd();
    e.builtin = true;
    await this.envRepo.save(e);
  }

  async list(): Promise<DeployEnvironmentEntity[]> {
    return this.envRepo.find({ order: { builtin: 'DESC', id: 'ASC' } });
  }

  async get(id: string): Promise<DeployEnvironmentEntity> {
    const e = await this.envRepo.findOne({ where: { id } });
    if (!e) throw new NotFoundException(`环境不存在: ${id}`);
    return e;
  }

  async create(dto: EnvironmentDto): Promise<DeployEnvironmentEntity> {
    const exists = await this.envRepo.findOne({ where: { id: dto.id } });
    if (exists) throw new BadRequestException(`环境 ID 已存在: ${dto.id}`);
    const e = new DeployEnvironmentEntity();
    e.id = dto.id;
    e.name = dto.name;
    e.host = dto.host;
    e.sshUser = dto.sshUser;
    e.sshKeyPath = dto.sshKeyPath || '~/.ssh/id_ed25519_servers';
    e.remoteDir = dto.remoteDir;
    e.publicUrl = dto.publicUrl;
    e.ports = dto.ports || {};
    e.builtin = false;
    return this.envRepo.save(e);
  }

  async update(id: string, dto: Partial<EnvironmentDto>): Promise<DeployEnvironmentEntity> {
    const e = await this.get(id);
    if (dto.name !== undefined) e.name = dto.name;
    if (dto.host !== undefined) e.host = dto.host;
    if (dto.sshUser !== undefined) e.sshUser = dto.sshUser;
    if (dto.sshKeyPath !== undefined) e.sshKeyPath = dto.sshKeyPath;
    if (dto.remoteDir !== undefined) e.remoteDir = dto.remoteDir;
    if (dto.publicUrl !== undefined) e.publicUrl = dto.publicUrl;
    if (dto.ports !== undefined) e.ports = dto.ports;
    // builtin 不可被改为 false（仍可被改端口等）
    return this.envRepo.save(e);
  }

  async remove(id: string): Promise<{ ok: boolean }> {
    const e = await this.get(id);
    if (e.builtin) throw new BadRequestException(`内置环境 ${id} 不可删除`);
    await this.envRepo.remove(e);
    return { ok: true };
  }
}
