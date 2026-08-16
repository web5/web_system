import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { DeployModuleEntity } from '../entities/deploy-module.entity';
import { ModuleDto } from '../common/dto';

/**
 * 模块注册表服务。
 * - 启动时若空表，从 scripts/modules.json 种子导入（标记 builtin）
 * - CRUD：模块是一等公民，可动态增删（内置模块不可删）
 */
@Injectable()
export class ModuleRegistryService implements OnModuleInit {
  private readonly logger = new Logger(ModuleRegistryService.name);

  constructor(
    @InjectRepository(DeployModuleEntity)
    private readonly moduleRepo: Repository<DeployModuleEntity>,
  ) {}

  /** 仓库根目录（deploy-console 的上两级） */
  private getWebSystemDir(): string {
    return process.cwd().replace(/\/servers\/deploy-console.*$/, '');
  }

  async onModuleInit() {
    const count = await this.moduleRepo.count();
    if (count > 0) return;
    const file = join(this.getWebSystemDir(), 'scripts', 'modules.json');
    if (!existsSync(file)) {
      this.logger.warn('未找到 scripts/modules.json，跳过模块种子');
      return;
    }
    try {
      const seed = JSON.parse(readFileSync(file, 'utf-8')) as any[];
      const rows = seed.map((m) =>
        this.moduleRepo.create({
          key: m.key,
          name: m.name,
          type: m.type,
          dir: m.dir,
          pm2: m.pm2 ?? null,
          publicPath: m.publicPath ?? null,
          buildCmd: m.buildCmd ?? null,
          builtin: true,
          enabled: true,
        }),
      );
      await this.moduleRepo.save(rows);
      this.logger.log(`模块注册表种子导入完成: ${rows.length} 个模块`);
    } catch (e) {
      this.logger.error(`模块种子导入失败: ${e.message}`);
    }
  }

  list(): Promise<DeployModuleEntity[]> {
    return this.moduleRepo.find({ order: { key: 'ASC' } });
  }

  async get(key: string): Promise<DeployModuleEntity> {
    const m = await this.moduleRepo.findOne({ where: { key } });
    if (!m) throw new Error(`模块不存在: ${key}`);
    return m;
  }

  async create(dto: ModuleDto): Promise<DeployModuleEntity> {
    const exists = await this.moduleRepo.findOne({ where: { key: dto.key } });
    if (exists) throw new Error(`模块 key 已存在: ${dto.key}`);
    return this.moduleRepo.save(this.moduleRepo.create({ ...dto, builtin: false }));
  }

  async update(key: string, dto: Partial<ModuleDto>): Promise<DeployModuleEntity> {
    const m = await this.get(key);
    // key 不可改（版本/部署记录按 key 关联）
    const { key: _ignored, ...rest } = dto as any;
    Object.assign(m, rest);
    return this.moduleRepo.save(m);
  }

  async remove(key: string): Promise<void> {
    const m = await this.get(key);
    if (m.builtin) throw new Error(`内置模块不可删除: ${key}`);
    await this.moduleRepo.delete(m.id);
  }
}
