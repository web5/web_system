import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeployCanaryRuleEntity } from '../entities/deploy-canary-rule.entity';

/**
 * 灰度规则服务。
 * - CRUD 规则
 * - matchUser(rule, req, ruleId)：判断请求是否命中灰度
 * - 命中预览 preview(rule, userId)：调试用
 *
 * 比例灰度用 FNV-1a 稳定 hash，保证同一用户对同一规则每次结果一致。
 */
@Injectable()
export class CanaryService {
  private readonly logger = new Logger(CanaryService.name);

  constructor(
    @InjectRepository(DeployCanaryRuleEntity)
    private readonly ruleRepo: Repository<DeployCanaryRuleEntity>,
  ) {}

  list(envId?: string, moduleKey?: string): Promise<DeployCanaryRuleEntity[]> {
    const where: any = {};
    if (envId) where.envId = envId;
    if (moduleKey) where.moduleKey = moduleKey;
    return this.ruleRepo.find({ where, order: { createdAt: 'DESC' } });
  }

  async get(id: string): Promise<DeployCanaryRuleEntity> {
    const r = await this.ruleRepo.findOne({ where: { id } });
    if (!r) throw new NotFoundException(`灰度规则不存在: ${id}`);
    return r;
  }

  create(data: Partial<DeployCanaryRuleEntity>): Promise<DeployCanaryRuleEntity> {
    return this.ruleRepo.save(this.ruleRepo.create(data));
  }

  async update(id: string, data: Partial<DeployCanaryRuleEntity>): Promise<DeployCanaryRuleEntity> {
    const r = await this.get(id);
    Object.assign(r, data);
    return this.ruleRepo.save(r);
  }

  async remove(id: string): Promise<void> {
    await this.ruleRepo.delete(id);
  }

  /** 判断请求是否命中灰度（供 gateway IndexHtmlService 调用） */
  matchUser(rule: DeployCanaryRuleEntity, req: any): boolean {
    const userId = this.extractUserId(req);
    return this.matchRule(rule.matchRule, userId, req, rule.id);
  }

  /** 命中预览：输入 userId，返回该用户对某规则是否命中 */
  preview(rule: DeployCanaryRuleEntity, userId: string): boolean {
    return this.matchRule(rule.matchRule, userId, { headers: {} }, rule.id);
  }

  /** 查某模块当前生效的灰度版本（命中即返回，未命中返回 null） */
  async resolveCanary(envId: string, moduleKey: string, req: any): Promise<string | null> {
    const rules = await this.ruleRepo.find({
      where: { envId, moduleKey, enabled: true },
      order: { createdAt: 'ASC' },
    });
    for (const rule of rules) {
      if (this.matchUser(rule, req)) return rule.canaryVersion;
    }
    return null;
  }

  private matchRule(matchRule: any, userId: string, req: any, ruleId: string): boolean {
    if (!matchRule || typeof matchRule !== 'object') return false;
    switch (matchRule.type) {
      case 'user-list':
        return Array.isArray(matchRule.userIds) && matchRule.userIds.includes(userId);
      case 'percent':
        if (!userId) return false;
        return this.hashUserId(userId + ':' + ruleId) % 100 < Number(matchRule.value || 0);
      case 'header':
        return Array.isArray(matchRule.values) && matchRule.values.includes(req?.headers?.[matchRule.key?.toLowerCase()]);
      default:
        return false;
    }
  }

  private extractUserId(req: any): string {
    return req?.user?.id || req?.headers?.['x-user-id'] || '';
  }

  /** FNV-1a 稳定 hash（同一输入永远同一数值） */
  private hashUserId(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return Math.abs(h >>> 0);
  }
}
