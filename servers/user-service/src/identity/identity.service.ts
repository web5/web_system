import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { User } from '../user/user.entity';

/**
 * 统一外部身份层（卡① · docs/development/wecom-approval-identity-contract.md）。
 *
 * 只回答「这个外部 id 是谁」，**不回答「他能干什么」** —— 权限判定归各服务。
 * console 的审批白名单仍由 ApproverService 负责，本服务不参与放行决策。
 */

export type IdentityChannel = 'wecom' | 'mp' | 'oa';

export interface ResolveIdentityDto {
  channel: IdentityChannel;
  externalId: string;
  unionId?: string;
}

export interface BindIdentityDto {
  userId: string | number;
  channel: IdentityChannel;
  externalId: string;
  unionId?: string;
  operator?: string;
}

export interface UnbindIdentityDto {
  channel: IdentityChannel;
  externalId: string;
  operator?: string;
}

export interface ResolvedIdentity {
  userId: string;
  username: string;
  nickname?: string;
  roles: string[];
  systems: string[];
  mergedFrom?: { userId: string; username: string };
}

/** 账号合并链最大跳数：断链/环/异常深度都按解析失败处理，不抛 500 */
const MAX_MERGE_HOPS = 8;

/** 历史数据 roles/systems 可能是数组、JSON 字符串或逗号串，统一归一化 */
function normalizeList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // 非 JSON：按逗号串兜底
  }
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

@Injectable()
export class IdentityService {
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
  ) {}

  /**
   * 解析外部身份 → 系统用户。
   * 查无 / 停用 / 合并链异常一律返回 null（**不是 404、不抛异常**），
   * 便于调用方区分「没人绑」与「服务挂了」——后者在企微通道必须 fail-closed（spec V14）。
   */
  async resolve(dto: ResolveIdentityDto): Promise<ResolvedIdentity | null> {
    const column = this.columnOf(dto?.channel);
    if (!column || !dto?.externalId) return null;

    // R-c：精确命中优先；unionId 只在 externalId 未命中时兜底，绝不覆盖精确命中
    let user = await this.findByColumn(column, dto.externalId);
    if (!user && dto.unionId) {
      user = await this.findByColumn('unionid', dto.unionId);
    }
    if (!user) return null;

    const origin = { userId: String(user.id), username: user.username };
    let mergedFrom: ResolvedIdentity['mergedFrom'];

    // R-a：跟随账号合并（merged_to 非空 = 该账号已并入别的账号）
    const seen = new Set<string>([String(user.id)]);
    while (user.mergedTo != null) {
      const targetId = Number(user.mergedTo);
      if (!Number.isFinite(targetId) || seen.has(String(targetId)) || seen.size > MAX_MERGE_HOPS) {
        return null;
      }
      seen.add(String(targetId));
      const target = await this.repo.findOne({
        where: { id: targetId } as FindOptionsWhere<User>,
      });
      if (!target) return null;
      if (!mergedFrom) mergedFrom = origin;
      user = target;
    }

    // R-b：停用 / 封禁账号视为解析失败（合并跟随后再判，避免目标账号被停用时漏过）
    if (user.status !== 'active') return null;

    return {
      userId: String(user.id),
      username: user.username,
      ...(user.nickname ? { nickname: user.nickname } : {}),
      roles: normalizeList(user.roles),
      systems: normalizeList(user.systems),
      ...(mergedFrom ? { mergedFrom } : {}),
    };
  }

  /** 绑定：一期单人、一次性，走 internal 接口或命令；不提供管理页 */
  async bind(dto: BindIdentityDto): Promise<{ bound: boolean }> {
    const column = this.columnOf(dto?.channel);
    if (!column || !dto?.externalId || dto?.userId == null) {
      throw new BadRequestException('userId / channel / externalId 必填');
    }
    const existing = await this.findByColumn(column, dto.externalId);
    if (existing && String(existing.id) !== String(dto.userId)) {
      throw new ConflictException('该渠道身份已绑定其他账号');
    }
    const user = await this.repo.findOne({
      where: { id: Number(dto.userId) } as FindOptionsWhere<User>,
    });
    if (!user) throw new NotFoundException('用户不存在');

    Object.assign(user, { [column]: dto.externalId });
    if (dto.unionId) Object.assign(user, { unionid: dto.unionId });
    await this.repo.save(user);
    return { bound: true };
  }

  /** 解绑：operator 由调用方留痕，本服务一期不落审计表 */
  async unbind(dto: UnbindIdentityDto): Promise<void> {
    const column = this.columnOf(dto?.channel);
    if (!column || !dto?.externalId) {
      throw new BadRequestException('channel / externalId 必填');
    }
    const user = await this.findByColumn(column, dto.externalId);
    if (!user) return;
    Object.assign(user, { [column]: null });
    await this.repo.save(user);
  }

  private columnOf(channel: IdentityChannel): keyof User | null {
    switch (channel) {
      case 'wecom':
        return 'wecomUserid';
      case 'mp':
        return 'mpOpenid';
      case 'oa':
        return 'oaOpenid';
      default:
        return null;
    }
  }

  private async findByColumn(column: keyof User, value: string): Promise<User | null> {
    const where = { [column]: value } as unknown as FindOptionsWhere<User>;
    return this.repo.findOne({ where });
  }
}
