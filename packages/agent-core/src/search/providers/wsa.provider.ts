/**
 * 腾讯云联网搜索 API（Web Search API，WSA）Provider。
 * 接口域名：wsa.tencentcloudapi.com / API 版本 2025-05-08 / Action=SearchPro
 * 采用腾讯云 API 3.0 标准 TC3-HMAC-SHA256 签名（手写实现，保持 agent-core 零运行时依赖）。
 * 需配置：TENCENT_SECRET_ID / TENCENT_SECRET_KEY。
 */
import { SearchProvider, SearchResult } from '../provider.interface';

const WSA_HOST = 'wsa.tencentcloudapi.com';
const WSA_SERVICE = 'wsa';
const WSA_VERSION = '2025-05-08';
const WSA_ACTION = 'SearchPro';

/** SHA256 摘要（Node 内置 crypto） */
function sha256Hex(data: string): string {
  const { createHash } = require('crypto') as typeof import('crypto');
  return createHash('sha256').update(data, 'utf-8').digest('hex');
}

/** HMAC-SHA256（Node 内置 crypto） */
function hmacSha256(key: Buffer | string, data: string): Buffer {
  const { createHmac } = require('crypto') as typeof import('crypto');
  return createHmac('sha256', key).update(data, 'utf-8').digest();
}

/** 腾讯云 TC3-HMAC-SHA256 签名，返回用于 X-TC-Signature 的签名串 */
function tc3Signature(
  secretId: string,
  secretKey: string,
  service: string,
  host: string,
  action: string,
  version: string,
  payload: string,
  now: Date,
): string {
  const time = Math.floor(now.getTime() / 1000);
  const date = now.toISOString().slice(0, 10); // YYYY-MM-DD

  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`;
  const signedHeaders = 'content-type;host;x-tc-action';

  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    sha256Hex(payload),
  ].join('\n');

  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = ['TC3-HMAC-SHA256', time, credentialScope, sha256Hex(canonicalRequest)].join('\n');

  const secretDate = hmacSha256('TC3' + secretKey, date);
  const secretService = hmacSha256(secretDate, service);
  const secretSigning = hmacSha256(secretService, 'tc3_request');
  const signature = hmacSha256(secretSigning, stringToSign).toString('hex');

  return `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

export class WsaSearchProvider implements SearchProvider {
  readonly id = 'wsa';
  readonly name = '腾讯云联网搜索';

  private getSecretId(): string {
    return process.env.TENCENT_SECRET_ID ?? '';
  }

  private getSecretKey(): string {
    return process.env.TENCENT_SECRET_KEY ?? '';
  }

  isAvailable(): boolean {
    return !!this.getSecretId().trim() && !!this.getSecretKey().trim();
  }

  async search(query: string, limit = 5): Promise<SearchResult[]> {
    const secretId = this.getSecretId().trim();
    const secretKey = this.getSecretKey().trim();
    if (!secretId || !secretKey) {
      throw new Error('腾讯云搜索未配置：请设置 TENCENT_SECRET_ID 和 TENCENT_SECRET_KEY');
    }

    // 注意：不要传 Mode 参数——轻量版(lite)不支持 Mode，传了会报 "illegal Mode"。
    // Mode 仅标准版/尊享版可用，省略后对所有版本兼容（返回自然结果，条数由服务端控制）。
    const payload = JSON.stringify({ Query: query });
    const now = new Date();

    const authorization = tc3Signature(
      secretId,
      secretKey,
      WSA_SERVICE,
      WSA_HOST,
      WSA_ACTION,
      WSA_VERSION,
      payload,
      now,
    );

    const resp = await fetch(`https://${WSA_HOST}/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Host: WSA_HOST,
        'X-TC-Action': WSA_ACTION,
        'X-TC-Version': WSA_VERSION,
        'X-TC-Timestamp': String(Math.floor(now.getTime() / 1000)),
        Authorization: authorization,
        'User-Agent': 'kedou-agent/0.1',
      },
      body: payload,
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      throw new Error(`腾讯云搜索请求失败: HTTP ${resp.status} ${errBody.slice(0, 300)}`);
    }

    const data = await resp.json();
    // 响应结构为 { Response: { Pages: [...] } }，错误在 Response.Error
    const body = data?.Response ?? data;
    if (body?.Error) {
      throw new Error(`腾讯云搜索错误: ${body.Error.Code ?? ''} ${body.Error.Message ?? ''}`.trim());
    }

    const pages: unknown[] = body?.Pages ?? [];
    const results: SearchResult[] = [];
    for (const raw of pages) {
      // Pages 元素是 JSON 字符串
      let item: Record<string, unknown>;
      try {
        item = typeof raw === 'string' ? (JSON.parse(raw) as Record<string, unknown>) : (raw as Record<string, unknown>);
      } catch {
        continue;
      }
      const title = String(item.title ?? '').trim();
      const url = String(item.url ?? '').trim();
      if (!title && !url) continue;
      results.push({
        title: title || url,
        url,
        snippet: String(item.passage ?? item.content ?? ''),
        date: item.date ? String(item.date) : undefined,
        source: String(item.site ?? 'wsa'),
      });
      if (results.length >= limit) break;
    }
    return results;
  }
}
