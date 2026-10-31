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

/**
 * `auth_config` 的「保持原值」哨兵。
 *
 * 为什么需要：列表接口已不再下发 `auth_config` 明文（见 admin.controller 的脱敏），
 * 前端编辑模块时手里没有明文密钥。若 PUT 时必须回传完整 `auth_config`，前端只能
 * ①回传 `"***"` 之类的占位符（会把真密钥写成 `"***"`，等于毁掉配置）；
 * ②先 GET 一次拿明文（又把密钥下发回浏览器，脱敏作废）。
 * 故约定：传 `'__KEEP__'` 与「不传」等价 —— 服务端保留库里的原值。
 */
export const AUTH_CONFIG_KEEP = '__KEEP__';

/** 局部更新：只提交要改的字段，未提交的字段一律保留库中原值 */
export interface UpdateModuleDto extends Partial<Omit<CreateModuleDto, 'auth_config'>> {
  auth_config?: Record<string, string> | null | typeof AUTH_CONFIG_KEEP;
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
      enabled: true,
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

  /**
   * 更新模块（**局部更新语义：未提供的字段保留库中原值**）
   *
   * 🔴 2026-10-31 修的是线上事故：旧实现无条件写 `dto.auth_type ?? ''` / `dto.auth_config ?? null`，
   * 前端只提交部分字段（例如只改 description）就会把鉴权配置清空。prod 的 `paper` 模块
   * 就是这样变成 `auth_type=''`、`auth_config=null` 的 —— 网关转发不带 Authorization，
   * content-hub 直接 401。工具同理：旧实现无条件「先删后插」，不传 tools 就把工具清空。
   *
   * 「未提供」的唯一判据是 `undefined`；`null` 视为**显式清空**（`auth_config: null` 有语义）。
   * `auth_config` 额外接受 `'__KEEP__'` 哨兵（等价于未提供），原因见 AUTH_CONFIG_KEEP 注释。
   */
  async update(id: number, dto: UpdateModuleDto): Promise<void> {
    const existing = await this.moduleRepo.findOne({ where: { id } });
    if (!existing) {
      // 与改动前等价：旧实现 `moduleRepo.update(id, ...)` 对不存在的行也只是更新 0 行。
      // 这里提前返回，避免「拿不到原值却硬写默认值」把不存在的行写成半截数据。
      this.logger.warn(`更新模块跳过：模块不存在 id=${id}`);
      return;
    }

    const keepAuthConfig =
      dto.auth_config === undefined || dto.auth_config === AUTH_CONFIG_KEEP;

    await this.moduleRepo.update(id, {
      name: dto.name ?? existing.name,
      description: dto.description ?? existing.description,
      base_url: dto.base_url ?? existing.base_url,
      timeout: dto.timeout ?? existing.timeout,
      auth_type: dto.auth_type ?? existing.auth_type,
      auth_config: keepAuthConfig
        ? existing.auth_config
        : (dto.auth_config as Record<string, string> | null),
    });

    // 工具：只有显式提交了 tools 才「先删后插」，否则原工具原样保留
    if (dto.tools === undefined) {
      return;
    }
    await this.toolRepo.delete({ module_id: id });
    for (const t of dto.tools) {
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
    await this.moduleRepo.update(id, { enabled });
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
