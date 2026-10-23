import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ContentAccountEntity } from '../entities/content-account.entity';
import { AccountCredentialService } from './account-credential.service';

/**
 * 自媒体账号的读侧服务（列表 / 按平台筛选）
 *
 * 🔴 对外一律**只回掩码**：`credentials_enc` 不得出现在任何响应里。
 *    写操作（新增 / 编辑 / 删除 / 连通性检测 / 启停）不在本轮范围，
 *    页面当前是"只读注册表"，凭据录入靠 seed 脚本（凭据不出服务器）。
 */
@Injectable()
export class ContentAccountService {
  private readonly logger = new Logger(ContentAccountService.name);

  constructor(
    @InjectRepository(ContentAccountEntity)
    private readonly repo: Repository<ContentAccountEntity>,
    private readonly credential: AccountCredentialService,
  ) {}

  /**
   * 账号列表（默认按平台 + 编码排序，软删除的不出）
   * @param platform 平台筛选，空则全平台
   */
  async list(platform?: string) {
    const where = platform ? { platform } : {};
    const rows = await this.repo.find({
      where,
      order: { platform: 'ASC', code: 'ASC' },
    });
    return rows.map((r) => ({
      id: Number(r.id),
      platform: r.platform,
      code: r.code,
      name: r.name,
      identity: r.identity,
      // 只有掩码：密文本身不进响应
      credentials_mask: r.credentials_mask,
      has_credentials: !!r.credentials_enc,
      capabilities: r.capabilities,
      last_checked_at: r.last_checked_at,
      last_check_status: r.last_check_status,
      enabled: r.enabled,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
  }
}
