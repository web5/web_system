import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { WecomConfigService } from './wecom.config';

/**
 * 企微自建应用 API 客户端（卡② T2-b）。
 *
 * 三件事：access_token 缓存（7200s，提前 5min 刷，并发加锁）、
 * OAuth code → userid、应用消息推送。
 *
 * 🔴 日志与错误**绝不打印** access_token / corpsecret；企微 errcode 可打。
 * 失败一律抛给调用方，由 notifier 决定吞掉（V11），此处不做降级。
 */

const QYAPI = 'https://qyapi.weixin.qq.com/cgi-bin';
/** 提前 5 分钟刷新（spec T2-b） */
const REFRESH_AHEAD_MS = 5 * 60 * 1000;

export type Fetcher = typeof globalThis.fetch;
/** 测试注入 token：不提供时用 globalThis.fetch（Nest 不会去解析 Function 依赖） */
export const WECOM_FETCHER = 'WECOM_FETCHER';

interface TokenResponse {
  errcode?: number;
  errmsg?: string;
  access_token?: string;
  expires_in?: number;
}

interface UserInfoResponse {
  errcode?: number;
  errmsg?: string;
  UserId?: string;
  userid?: string;
}

interface SendResponse {
  errcode?: number;
  errmsg?: string;
}

export interface WecomTextCard {
  title: string;
  description: string;
  url: string;
  btntxt?: string;
}

@Injectable()
export class WecomApiClient {
  private readonly logger = new Logger(WecomApiClient.name);
  private cached?: { token: string; expireAt: number };
  private inFlight?: Promise<string>;

  constructor(
    private readonly config: WecomConfigService,
    @Optional() @Inject(WECOM_FETCHER) private readonly fetcher?: Fetcher,
  ) {}

  private get fetch(): Fetcher {
    return this.fetcher ?? globalThis.fetch;
  }

  /** 并发加锁：同一时刻只有一个 gettoken 请求在飞，其余复用同一个 Promise */
  async getToken(nowMs: number = Date.now()): Promise<string> {
    if (this.cached && nowMs < this.cached.expireAt) return this.cached.token;
    if (this.inFlight) return this.inFlight;

    const { corpId, secret } = this.config.config;
    this.inFlight = (async () => {
      const url = `${QYAPI}/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(secret)}`;
      const res = await this.fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`企微 gettoken HTTP ${res.status}`);
      const body = (await res.json()) as TokenResponse;
      if (body.errcode !== 0 || !body.access_token) {
        throw new Error(`企微 gettoken 失败 errcode=${body.errcode ?? 'unknown'}`);
      }
      const ttlMs = (body.expires_in ?? 7200) * 1000;
      this.cached = {
        token: body.access_token,
        expireAt: Date.now() + Math.max(ttlMs - REFRESH_AHEAD_MS, 60_000),
      };
      return body.access_token;
    })();

    try {
      return await this.inFlight;
    } finally {
      this.inFlight = undefined;
    }
  }

  /** OAuth code → 企微成员 userid；非企业成员（openid 场景）返回 null */
  async getUserIdByCode(code: string): Promise<string | null> {
    const token = await this.getToken();
    const res = await this.fetch(
      `${QYAPI}/auth/getuserinfo?access_token=${encodeURIComponent(token)}&code=${encodeURIComponent(code)}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) throw new Error(`企微 getuserinfo HTTP ${res.status}`);
    const body = (await res.json()) as UserInfoResponse;
    if (body.errcode !== 0) throw new Error(`企微 getuserinfo 失败 errcode=${body.errcode ?? 'unknown'}`);
    return body.UserId || body.userid || null;
  }

  /** 应用消息（textcard）；touser 由调用方给（本期 '@all' = 应用可见范围） */
  async sendTextCard(touser: string, card: WecomTextCard): Promise<void> {
    const token = await this.getToken();
    const { agentId } = this.config.config;
    const res = await this.fetch(
      `${QYAPI}/message/send?access_token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          touser,
          msgtype: 'textcard',
          agentid: Number(agentId),
          textcard: {
            title: card.title,
            description: card.description,
            url: card.url,
            btntxt: card.btntxt ?? '去处理',
          },
          safe: 0,
          enable_id_trans: 0,
          enable_duplicate_check: 0,
        }),
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!res.ok) throw new Error(`企微 message/send HTTP ${res.status}`);
    const body = (await res.json()) as SendResponse;
    if (body.errcode !== 0) throw new Error(`企微 message/send 失败 errcode=${body.errcode ?? 'unknown'}`);
    this.logger.log(`企微待办已推送: ${card.title}`);
  }

  /** 仅测试用：清缓存（不触碰线上凭证） */
  clearCache(): void {
    this.cached = undefined;
    this.inFlight = undefined;
  }
}
