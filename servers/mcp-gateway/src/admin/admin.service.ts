import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { callApi, HttpModuleConfig, HttpToolDef } from '@web-system/mcp-core';
import { McpModuleEntity } from '../mcp/entities/mcp-module.entity';
import { McpToolEntity } from '../mcp/entities/mcp-tool.entity';
import { McpService } from '../mcp/mcp.service';

export interface CreateModuleDto {
  name: string;
  description?: string;
  base_url: string;
  timeout?: number;
  auth_type?: string;
  auth_config?: Record<string, string>;
  tools: HttpToolDef[];
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @InjectRepository(McpModuleEntity)
    private readonly moduleRepo: Repository<McpModuleEntity>,
    @InjectRepository(McpToolEntity)
    private readonly toolRepo: Repository<McpToolEntity>,
    private readonly mcpService: McpService,
  ) {}

  async list(): Promise<McpModuleEntity[]> {
    return this.moduleRepo.find({ relations: ['tools'] });
  }

  async create(dto: CreateModuleDto): Promise<McpModuleEntity> {
    const module = this.moduleRepo.create({
      name: dto.name,
      description: dto.description ?? '',
      base_url: dto.base_url,
      timeout: dto.timeout ?? 30,
      auth_type: dto.auth_type ?? '',
      auth_config: dto.auth_config ?? null,
      enabled: 1,
      tools: (dto.tools ?? []).map((t) =>
        this.toolRepo.create({
          name: t.name,
          description: t.description ?? '',
          method: t.method ?? 'GET',
          path: t.path ?? '/',
          params: t.params ?? [],
        }),
      ),
    });
    const saved = await this.moduleRepo.save(module);
    return saved;
  }

  async update(id: number, dto: CreateModuleDto): Promise<void> {
    await this.moduleRepo.update(id, {
      name: dto.name,
      description: dto.description ?? '',
      base_url: dto.base_url,
      timeout: dto.timeout ?? 30,
      auth_type: dto.auth_type ?? '',
      auth_config: dto.auth_config ?? null,
    });
    // 工具：先删后插
    await this.toolRepo.delete({ module_id: id });
    for (const t of dto.tools ?? []) {
      await this.toolRepo.save(
        this.toolRepo.create({
          module_id: id,
          name: t.name,
          description: t.description ?? '',
          method: t.method ?? 'GET',
          path: t.path ?? '/',
          params: t.params ?? [],
        }),
      );
    }
  }

  async remove(id: number): Promise<void> {
    await this.moduleRepo.delete(id);
  }

  async toggle(id: number, enabled: boolean): Promise<void> {
    await this.moduleRepo.update(id, { enabled: enabled ? 1 : 0 });
  }

  /** 调试验证：直接调用后台 HTTP API */
  async debug(dto: {
    base_url: string;
    timeout?: number;
    auth?: Record<string, string>;
    method: string;
    path: string;
    params?: Record<string, unknown>;
  }): Promise<unknown> {
    const config: HttpModuleConfig = {
      base_url: dto.base_url,
      timeout: dto.timeout ?? 30,
      auth: dto.auth,
      tools: [],
    };
    const toolDef: HttpToolDef = { name: 'debug', method: dto.method as any, path: dto.path };
    return callApi(config, toolDef, dto.params ?? {});
  }
}
