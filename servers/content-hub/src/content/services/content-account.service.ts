import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ContentAccountEntity } from '../entities/content-account.entity';
import { AccountCredentialService } from './account-credential.service';

/** 微信开放接口的响应最窄形状（只取探活用得到的字段） */
interface WxTokenResponse {
  access_token?: string;
  errcode?: number;
  errmsg?: string;
}
interface WxBasicInfoResponse {
  nick_name?: string;
  errcode?: number;
}

/** 连通性检测结果（返回给 admin；**永不包含凭据明文**） */
export interface AccountProbeResult {
  status: 'ok' | 'warn' | 'err';
  message: string;
  latency_ms: number;
  checked_at: string;
}

/**
 * 自媒体账号的读侧服务（列表 / 按平台筛选）
 *
 * 🔴 对外一律**只回掩码**：`credentials_enc` 不得出现在任何响应里。
 *    写操作中已接入「连通性检测」（probe，只读凭据 + 换 token，不落任何平台侧数据）；
 *    新增 / 编辑 / 删除 / 启停不在本轮范围，凭据录入仍走 seed 脚本（凭据不出服务器）。
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
      account_type: r.account_type,
      capabilities: r.capabilities,
      last_checked_at: r.last_checked_at,
      last_check_status: r.last_check_status,
      enabled: r.enabled,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
  }

  /**
   * 发布时解析「这条内容算在哪个账号头上」——只取编码与主体类型，不碰凭据。
   *
   * 当前阶段一个平台一个账号（绑定关系是下轮的事：管线侧选账号）。
   * 查不到账号时返回 null，调用方按「未登记账号」处理（前端沿用原有状态显示，
   * 不会因为没有账号就把成文判成失败）。
   */
  async resolveForPublish(
    platform: string,
  ): Promise<{ account_code: string; account_type: string } | null> {
    const row = await this.repo.findOne({
      where: { platform, enabled: true },
      order: { id: 'ASC' },
      select: ['code', 'account_type'],
    });
    if (!row) return null;
    return { account_code: row.code, account_type: row.account_type ?? 'personal' };
  }

  // ── 连通性检测（2026-10-24）──

  /**
   * 连通性检测：解密凭据 → 换 stable_token → 回填 last_check_* 并返回结论。
   *
   * 设计口径：
   * - **只探活不写平台**：用 stable_token 换取凭证即证明 AppID/AppSecret 有效，
   *   不调用任何会改变公众号数据的接口。
   * - **warn ≠ err**：40164（IP 不在白名单）说明凭据本身是对的、只是这台机器被拒，
   *   归为 warn——运营该去后台加白名单，而不是重录凭据。
   * - 检测失败也要**落库**（last_check_status=err），列表里的「未检测/失败」才有据可查。
   * - 检测成功后尽力回填 `identity`（公众号昵称，getaccountbasicinfo）；未认证号可能
   *   无权限，失败静默忽略——昵称是锦上添花，不是检测结论。
   */
  async probe(id: number): Promise<AccountProbeResult> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new BadRequestException(`账号不存在：${id}`);

    const started = Date.now();
    let status: AccountProbeResult['status'] = 'err';
    let message: string;

    if (!row.credentials_enc) {
      message = '未录入凭据：先由服务端 seed 脚本录入，再检测';
    } else if (row.platform !== 'wechat_mp') {
      message = `平台 ${row.platform} 暂不支持连通性检测`;
    } else {
      try {
        const cred = this.credential.decrypt<{
          app_id?: string;
          app_secret?: string;
        }>(row.credentials_enc);
        if (!cred.app_id || !cred.app_secret) {
          message = '凭据内容不完整：缺 app_id / app_secret';
        } else {
          const tokenRes = await this.wechatStableToken(
            cred.app_id,
            cred.app_secret,
          );
          if (tokenRes.access_token) {
            status = 'ok';
            message = `凭据有效（stable_token ${Date.now() - started}ms）`;
            try {
              const info = await this.wechatAccountBasicInfo(
                tokenRes.access_token,
              );
              if (info?.nick_name && info.nick_name !== row.identity) {
                row.identity = info.nick_name;
                this.logger.log(`[probe] #${id} 主体标识回填：${info.nick_name}`);
              }
            } catch {
              // 昵称拿不到不影响结论
            }
          } else {
            const code = tokenRes.errcode ?? -1;
            if (code === 40164) {
              status = 'warn';
              message =
                '凭据有效，但本机 IP 不在公众号 IP 白名单内（后台「设置与开发→基本配置→IP白名单」加入后再测）';
            } else if (code === 40013) {
              message = 'AppID 无效（微信 40013）';
            } else if (code === 40125 || code === 40101) {
              message = 'AppSecret 无效或已在后台重置（微信 40125）';
            } else {
              message = `微信返回 ${code}：${tokenRes.errmsg ?? '未知错误'}`;
            }
          }
        }
      } catch (e) {
        message = `检测请求失败：${(e as Error).message}`;
      }
    }

    const checkedAt = new Date();
    row.last_checked_at = checkedAt;
    row.last_check_status = status;
    await this.repo.save(row);
    this.logger.log(`[probe] #${id} ${row.platform}/${row.code} → ${status}：${message}`);
    return {
      status,
      message,
      latency_ms: Date.now() - started,
      checked_at: checkedAt.toISOString(),
    };
  }

  /** 微信 stable_token（与 WechatMpClient 同一入口），带超时防探活挂死 */
  private async wechatStableToken(
    appId: string,
    appSecret: string,
    timeoutMs = 8000,
  ): Promise<WxTokenResponse> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch('https://api.weixin.qq.com/cgi-bin/stable_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credential',
          appid: appId,
          secret: appSecret,
        }),
        signal: ctrl.signal,
      });
      return (await res.json()) as WxTokenResponse;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 公众号基础信息（仅用于回填昵称，尽力而为） */
  private async wechatAccountBasicInfo(
    accessToken: string,
    timeoutMs = 5000,
  ): Promise<WxBasicInfoResponse> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(
        `https://api.weixin.qq.com/cgi-bin/account/getaccountbasicinfo?access_token=${encodeURIComponent(accessToken)}`,
        { signal: ctrl.signal },
      );
      return (await res.json()) as WxBasicInfoResponse;
    } finally {
      clearTimeout(timer);
    }
  }
}
