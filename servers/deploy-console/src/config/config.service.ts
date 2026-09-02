import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigItemEntity, CONFIG_SCOPES, ConfigScope } from '../entities/config-item.entity';
import { ConfigSnapshotEntity } from '../entities/config-snapshot.entity';
import { decryptSecret, encryptSecret, SECRET_MASK } from './config-crypto';

export type ResolvedConfig = Record<string, string>;

export interface UpsertConfigDto {
  scope: ConfigScope;
  envId?: string;
  moduleKey?: string;
  key: string;
  value: string;
  isSecret?: boolean;
  description?: string;
}

/** 作用域优先级：数字越大越优先（后者覆盖前者） */
const SCOPE_PRIORITY: Record<string, number> = { global: 0, env: 1, module: 2 };

/**
 * 配置中心服务。
 *
 * 三级作用域：全局默认 → 环境级 → 模块级，后者覆盖前者；
 * 密钥以 AES-256-GCM 加密落库，页面只回显掩码；
 * 配置与发布版本快照关联，回滚版本时配置同步回退。
 */
@Injectable()
export class ConfigService {
  private readonly logger = new Logger(ConfigService.name);

  constructor(
    @InjectRepository(ConfigItemEntity)
    private readonly repo: Repository<ConfigItemEntity>,
    @InjectRepository(ConfigSnapshotEntity)
    private readonly snapshotRepo: Repository<ConfigSnapshotEntity>,
  ) {}

  /** 列出配置项：密钥自动掩码，不给前端明文 */
  async list(scope?: ConfigScope, envId?: string, moduleKey?: string) {
    const where: Record<string, unknown> = {};
    if (scope) where.scope = scope;
    if (envId !== undefined) where.envId = envId;
    if (moduleKey !== undefined) where.moduleKey = moduleKey;

    const rows = await this.repo.find({ where, order: { scope: 'ASC', key: 'ASC' } });
    return rows.map((r) => ({
      id: r.id,
      scope: r.scope,
      envId: r.envId,
      moduleKey: r.moduleKey,
      key: r.key,
      value: r.isSecret ? SECRET_MASK : r.value,
      isSecret: r.isSecret,
      enabled: r.enabled,
      description: r.description,
      updatedBy: r.updatedBy,
      updatedAt: r.updatedAt,
    }));
  }

  /**
   * 解析某「环境 × 模块」的生效配置：global → env → module 依次覆盖。
   *
   * ⚠️ 返回的密钥是**明文**，仅供发布/重启时注入进程，**严禁返回给前端或写进日志**。
   */
  async resolve(envId: string, moduleKey: string): Promise<ResolvedConfig> {
    const rows = await this.repo.find({
      where: [
        { scope: 'global', enabled: true },
        { scope: 'env', envId, enabled: true },
        { scope: 'module', envId, moduleKey, enabled: true },
      ],
    });
    rows.sort((a, b) => (SCOPE_PRIORITY[a.scope] ?? 0) - (SCOPE_PRIORITY[b.scope] ?? 0));

    const out: ResolvedConfig = {};
    for (const r of rows) {
      out[r.key] = r.isSecret ? decryptSecret(r.value) : r.value;
    }
    return out;
  }

  /** 新增或更新配置项（密钥加密存储） */
  async upsert(dto: UpsertConfigDto, updatedBy?: string): Promise<ConfigItemEntity> {
    if (!CONFIG_SCOPES.includes(dto.scope)) {
      throw new BadRequestException(`作用域必须是 ${CONFIG_SCOPES.join(' / ')} 之一`);
    }
    if (!dto.key?.trim()) throw new BadRequestException('配置键不能为空');
    if (dto.value === undefined || dto.value === null) {
      throw new BadRequestException('配置值不能为空');
    }
    // 防止把页面回显的掩码当成真实值写回
    if (dto.isSecret && dto.value === SECRET_MASK) {
      throw new BadRequestException('密钥值不能是掩码，请重新输入真实值');
    }

    const envId = dto.scope === 'global' ? '' : (dto.envId ?? '');
    const moduleKey = dto.scope === 'module' ? (dto.moduleKey ?? '') : '';
    if (dto.scope === 'env' && !envId) {
      throw new BadRequestException('环境级配置必须指定 envId');
    }
    if (dto.scope === 'module' && (!envId || !moduleKey)) {
      throw new BadRequestException('模块级配置必须同时指定 envId 与 moduleKey');
    }

    let row = await this.repo.findOne({
      where: { scope: dto.scope, envId, moduleKey, key: dto.key },
    });
    if (!row) {
      row = this.repo.create({ scope: dto.scope, envId, moduleKey, key: dto.key });
    }
    row.value = dto.isSecret ? encryptSecret(dto.value) : dto.value;
    row.isSecret = !!dto.isSecret;
    row.enabled = true;
    row.description = dto.description;
    row.updatedBy = updatedBy;
    return this.repo.save(row);
  }

  /**
   * 按 id 查配置项（**不含值**，供删除前审计留痕使用）。
   * 刻意不返回 value：删除审计只需记录"删了哪个键"，无需触碰值（更不碰密钥明文）。
   */
  async findById(id: string) {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) return null;
    return {
      id: row.id,
      scope: row.scope,
      envId: row.envId,
      moduleKey: row.moduleKey,
      key: row.key,
      isSecret: row.isSecret,
    };
  }

  async remove(id: string): Promise<void> {
    await this.repo.delete(id);
  }

  /** 生成配置快照（与发布版本关联，供回滚时同步回退） */
  async snapshot(
    envId: string,
    moduleKey: string,
    versionTag: string,
    createdBy?: string,
  ): Promise<ConfigSnapshotEntity> {
    const rows = await this.repo.find({
      where: [
        { scope: 'global', enabled: true },
        { scope: 'env', envId, enabled: true },
        { scope: 'module', envId, moduleKey, enabled: true },
      ],
    });
    rows.sort((a, b) => (SCOPE_PRIORITY[a.scope] ?? 0) - (SCOPE_PRIORITY[b.scope] ?? 0));

    const payload: ConfigSnapshotEntity['payload'] = {};
    for (const r of rows) {
      // 密钥在此仍是密文，快照不落明文
      payload[r.key] = { value: r.value, isSecret: r.isSecret, source: r.scope };
    }
    return this.snapshotRepo.save(
      this.snapshotRepo.create({ envId, moduleKey, versionTag, payload, createdBy }),
    );
  }

  /** 回滚配置：把快照内容写回模块级配置（覆盖当前值） */
  async restore(
    envId: string,
    moduleKey: string,
    versionTag: string,
    updatedBy?: string,
  ): Promise<number> {
    const snap = await this.snapshotRepo.findOne({ where: { envId, moduleKey, versionTag } });
    if (!snap) {
      this.logger.warn(`无配置快照可回滚: ${envId}/${moduleKey}@${versionTag}`);
      return 0;
    }
    let n = 0;
    for (const [key, item] of Object.entries(snap.payload ?? {})) {
      let row = await this.repo.findOne({ where: { scope: 'module', envId, moduleKey, key } });
      if (!row) row = this.repo.create({ scope: 'module', envId, moduleKey, key });
      row.value = item.value;
      row.isSecret = item.isSecret;
      row.enabled = true;
      row.updatedBy = updatedBy;
      await this.repo.save(row);
      n++;
    }
    return n;
  }
}
