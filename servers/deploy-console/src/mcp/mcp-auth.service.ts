import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface McpKeyVerifyResult {
  valid: boolean;
  ownerId?: string;
  keyId?: string;
}

/**
 * MCP API Key 校验（复用 user-service 的每用户密钥体系）。
 *
 * 与 mcp-gateway 的 checkAuth 一致：调 user-service 内部接口 `/internal/keys/verify`
 * （受 INTERNAL_API_KEY 保护），拿到 `ownerId` 作为操作人写入审计日志，
 * 从而做到"MCP 发起的发布也能追溯到人"。
 */
@Injectable()
export class McpAuthService {
  private readonly logger = new Logger(McpAuthService.name);
  private readonly userServiceUrl: string;
  private readonly internalKey: string;
  /** ownerId 校验结果缓存（3s），避免同一次流水线内反复回查 */
  private readonly cache = new Map<string, { at: number; result: McpKeyVerifyResult }>();
  private readonly cacheTtlMs = 3000;

  constructor(private readonly configService: ConfigService) {
    this.userServiceUrl =
      this.configService.get<string>('USER_SERVICE_URL') || 'http://127.0.0.1:6002';
    this.internalKey = this.configService.get<string>('INTERNAL_API_KEY') || '';
  }

  async verifyKey(key: string): Promise<McpKeyVerifyResult> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.cacheTtlMs) return hit.result;

    let result: McpKeyVerifyResult = { valid: false };
    try {
      const resp = await fetch(`${this.userServiceUrl.replace(/\/$/, '')}/internal/keys/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-key': this.internalKey,
        },
        body: JSON.stringify({ key }),
        signal: AbortSignal.timeout(3000),
      });
      if (resp.ok) {
        const json = (await resp.json()) as {
          valid?: boolean;
          ownerId?: string | null;
          keyId?: string | null;
          data?: { valid?: boolean; ownerId?: string | null; keyId?: string | null };
        };
        // 兼容裸响应与全局拦截器包装
        const d = json?.data ?? json;
        result = {
          valid: !!d?.valid,
          ownerId: d?.ownerId ?? undefined,
          keyId: d?.keyId ?? undefined,
        };
      }
    } catch (e) {
      this.logger.warn(`MCP key 校验失败: ${(e as Error).message}`);
    }

    if (result.valid) this.cache.set(key, { at: Date.now(), result });
    return result;
  }
}
