import { Injectable } from '@nestjs/common';

/**
 * 企微审批通道配置（卡② T2-a）。
 *
 * 设计要点（spec §5.2 / V12）：
 *  - `resolveWecomConfig` 是**纯函数**，便于单测「开关关闭时完全回到现状」；
 *  - 开关关闭 → 立即早退，不读取、不校验任何其它键（否则缺凭证的环境会因
 *    一个没启用的功能起不来，这本身就是回归破坏）；
 *  - 开关打开但缺 `CONSOLE_PUBLIC_BASE_URL` → **拒绝启动**，绝不生成 localhost 死链。
 *
 * 凭证来源：**配置中心 `config_items`（`layer=platform`，不下发、不落盘）**。
 * console 由 `src/bootstrap/load.ts` 的 `runBootstrap()` 在 Nest 启动前读库、解密、
 * 合并进 `process.env`，所以本文件只认 `process.env`，不自己读文件、不自己读库 ——
 * 单一来源，避免「文件一份、库一份」漂移。
 * 录入方式见 `scripts/import-wecom-env.ts`；本文件不出现任何明文、日志只打键名不打值。
 */

export type WecomMode = 'oauth' | 'signed-link';

export interface WecomConfig {
  enabled: boolean;
  mode: WecomMode;
  corpId: string;
  agentId: string;
  secret: string;
  /** 对外基址，已去掉尾部斜杠，如 https://dev.kedouai.com/console */
  publicBaseUrl: string;
  /** HMAC 密钥：优先 WECOM_APPROVE_TICKET_SECRET，oauth 模式回退 JWT_SECRET */
  ticketSecret: string;
  linkTtlSec: number;
  userServiceUrl: string;
  internalApiKey: string;
}

export class WecomConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WecomConfigError';
  }
}

export type EnvLike = Record<string, string | undefined>;

function str(env: EnvLike, key: string): string {
  return (env[key] ?? '').trim();
}

export function resolveWecomConfig(env: EnvLike = process.env): WecomConfig {
  const base: WecomConfig = {
    enabled: false,
    mode: 'oauth',
    corpId: '',
    agentId: '',
    secret: '',
    publicBaseUrl: '',
    ticketSecret: '',
    linkTtlSec: 900,
    userServiceUrl: 'http://127.0.0.1:6002',
    internalApiKey: '',
  };

  // V12：严格 '1' 才启用。开关关闭时不读取任何其它键、不抛任何错。
  if (str(env, 'WECOM_APPROVE_ENABLED') !== '1') return base;

  const mode: WecomMode =
    str(env, 'WECOM_APPROVE_MODE') === 'signed-link' ? 'signed-link' : 'oauth';
  const publicBaseUrl = str(env, 'CONSOLE_PUBLIC_BASE_URL').replace(/\/+$/, '');
  if (!publicBaseUrl) {
    throw new WecomConfigError(
      'WECOM_APPROVE_ENABLED=1 但缺少 CONSOLE_PUBLIC_BASE_URL，拒绝启用（否则会发出指向本机的死链）',
    );
  }

  const corpId = str(env, 'WECOM_CORP_ID');
  const agentId = str(env, 'WECOM_AGENT_ID');
  const secret = str(env, 'WECOM_SECRET');
  const ticketSecret = str(env, 'WECOM_APPROVE_TICKET_SECRET') || str(env, 'JWT_SECRET');

  if (mode === 'oauth' && (!corpId || !agentId || !secret)) {
    throw new WecomConfigError(
      'oauth 模式缺少 WECOM_CORP_ID / WECOM_AGENT_ID / WECOM_SECRET，拒绝启用',
    );
  }
  if (mode === 'signed-link' && !str(env, 'WECOM_APPROVE_TICKET_SECRET')) {
    throw new WecomConfigError('signed-link 模式缺少 WECOM_APPROVE_TICKET_SECRET，拒绝启用');
  }
  // state / 短令牌 HMAC 必须有密钥；oauth 模式回退同源 JWT_SECRET
  if (!ticketSecret) {
    throw new WecomConfigError(
      '缺少 HMAC 密钥（WECOM_APPROVE_TICKET_SECRET 或 JWT_SECRET），拒绝启用',
    );
  }

  const ttlRaw = Number(str(env, 'WECOM_LINK_TTL_SEC') || '900');
  const linkTtlSec = Number.isFinite(ttlRaw) && ttlRaw > 0 ? Math.floor(ttlRaw) : 900;

  return {
    enabled: true,
    mode,
    corpId,
    agentId,
    secret,
    publicBaseUrl,
    ticketSecret,
    linkTtlSec,
    userServiceUrl:
      (str(env, 'USER_SERVICE_URL') || 'http://127.0.0.1:6002').replace(/\/+$/, ''),
    internalApiKey: str(env, 'INTERNAL_API_KEY'),
  };
}

/** Nest 包装：模块内所有组件共用一份已自检的配置快照 */
@Injectable()
export class WecomConfigService {
  readonly config: WecomConfig;

  // 刻意**无构造参数**：Nest 会按 design:paramtypes 尝试注入 Object/Record，
  // 带默认值的 env 参数会让 DI 解析失败。单测请直接用 forTest / 测纯函数。
  constructor() {
    // 凭证已由 bootstrap 从配置中心合并进 process.env，这里只读环境
    this.config = resolveWecomConfig(process.env);
  }

  /** 仅测试/工具用：用给定 env 造一份配置快照（绕过构造函数，不产生启动日志） */
  static forTest(env: EnvLike): WecomConfigService {
    const svc = Object.create(WecomConfigService.prototype) as WecomConfigService;
    return Object.assign(svc, { config: resolveWecomConfig(env) });
  }

  get enabled(): boolean {
    return this.config.enabled;
  }
}
