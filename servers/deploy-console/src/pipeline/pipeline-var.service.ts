import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeployPipelineVarEntity } from '../entities/deploy-pipeline-var.entity';

export interface PipelineVarItem {
  id: string;
  key: string;
  /** 密钥值：对外一律掩码，不回显明文 */
  value: string;
  isSecret: boolean;
  description?: string;
  enabled: boolean;
  updatedBy?: string;
}

export interface UpsertPipelineVarSpec {
  key: string;
  value?: string;
  isSecret?: boolean;
  description?: string;
  enabled?: boolean;
}

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
export const PIPELINE_VAR_MASK = '********';

/**
 * 流水线变量服务。
 *
 * 变量属于**某一条流水线**（不是全局、也不是模板级），执行时按流水线 id 解析后注入节点脚本环境。
 */
@Injectable()
export class PipelineVarService {
  constructor(
    @InjectRepository(DeployPipelineVarEntity)
    private readonly repo: Repository<DeployPipelineVarEntity>,
  ) {}

  private genId(): string {
    return `pvar-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  private assertKey(key: string): string {
    const k = (key ?? '').trim();
    if (!KEY_RE.test(k)) {
      throw new BadRequestException(
        `变量键非法: ${key}（须匹配 ^[A-Za-z_][A-Za-z0-9_]{0,63}$）`,
      );
    }
    return k;
  }

  /** 对外视图：密钥值掩码 */
  private toItem(v: DeployPipelineVarEntity): PipelineVarItem {
    return {
      id: v.id,
      key: v.key,
      value: v.isSecret ? PIPELINE_VAR_MASK : v.value,
      isSecret: v.isSecret,
      description: v.description,
      enabled: v.enabled,
      updatedBy: v.updatedBy,
    };
  }

  async list(pipelineId: string): Promise<PipelineVarItem[]> {
    if (!pipelineId) throw new BadRequestException('pipelineId 必填');
    const rows = await this.repo.find({
      where: { pipelineId },
      order: { key: 'ASC' },
    });
    return rows.map((r) => this.toItem(r));
  }

  async create(
    pipelineId: string,
    spec: UpsertPipelineVarSpec,
    operator?: string,
  ): Promise<PipelineVarItem> {
    if (!pipelineId) throw new BadRequestException('pipelineId 必填');
    const key = this.assertKey(spec.key);
    const dup = await this.repo.findOne({ where: { pipelineId, key } });
    if (dup) throw new BadRequestException(`变量「${key}」已存在`);
    const now = Date.now();
    const row = this.repo.create({
      id: this.genId(),
      pipelineId,
      key,
      value: spec.value ?? '',
      isSecret: !!spec.isSecret,
      description: spec.description?.trim() || undefined,
      enabled: spec.enabled !== false,
      updatedBy: operator,
      createdAt: now,
      updatedAt: now,
    });
    return this.toItem(await this.repo.save(row));
  }

  async update(
    id: string,
    patch: Partial<UpsertPipelineVarSpec>,
    operator?: string,
  ): Promise<PipelineVarItem> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`变量不存在: ${id}`);
    if (patch.key !== undefined) {
      const key = this.assertKey(patch.key);
      if (key !== row.key) {
        const dup = await this.repo.findOne({
          where: { pipelineId: row.pipelineId, key },
        });
        if (dup) throw new BadRequestException(`变量「${key}」已存在`);
      }
      row.key = key;
    }
    // 密钥：值为空表示不更新（避免把掩码字符串写回覆盖真实密钥）
    if (patch.value !== undefined && !(row.isSecret && !patch.value)) {
      row.value = patch.value;
    }
    if (patch.isSecret !== undefined) row.isSecret = patch.isSecret;
    if (patch.description !== undefined) row.description = patch.description.trim() || undefined;
    if (patch.enabled !== undefined) row.enabled = patch.enabled;
    row.updatedBy = operator;
    row.updatedAt = Date.now();
    return this.toItem(await this.repo.save(row));
  }

  async remove(id: string): Promise<{ ok: true }> {
    await this.repo.delete(id);
    return { ok: true as const };
  }

  /**
   * 解析某条流水线的变量（执行前调用，注入节点脚本环境）。
   * 未启用的变量不注入；重名不可能（唯一约束），故直接铺平成 Record。
   */
  async resolve(pipelineId?: string | null): Promise<Record<string, string>> {
    if (!pipelineId) return {};
    const rows = await this.repo.find({ where: { pipelineId, enabled: true } });
    const out: Record<string, string> = {};
    for (const r of rows) out[r.key] = r.value;
    return out;
  }
}
