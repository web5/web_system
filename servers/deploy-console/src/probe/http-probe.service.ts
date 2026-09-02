import { Injectable, Logger } from '@nestjs/common';
import * as http from 'http';
import * as https from 'https';

export interface HttpProbeResult {
  ok: boolean;
  status: number;
  /** GET 且响应体可 JSON.parse 时有值（状态码与 JSON 解析分开判定：产物文件不是 JSON 不代表不可访问） */
  json?: unknown;
}

/**
 * HTTP 探活工具（V6 平台逻辑收敛：tool-catalog `probe` 分类工具的执行体）。
 *
 * 使用方：
 * - verify 内置步骤 —— gateway manifest 版本断言、静态产物 HEAD 探活
 * - backend 健康探活 —— 127.0.0.1:<PORT> 端口真实可服务性检查
 *
 * 注意：这里**不能用 fetch** —— Node 的 fetch(undici) 会拦截 6000 等端口
 * （X11 等被列入 bad port 名单），导致访问 gateway 直接失败。统一用 http/https 模块。
 */
@Injectable()
export class HttpProbeService {
  private readonly logger = new Logger(HttpProbeService.name);

  /** 简单 GET/HEAD 请求（JSON 解析与状态码分开判定）。失败/超时返回 ok=false，不抛错。 */
  request(
    url: string,
    method: 'GET' | 'HEAD' = 'GET',
    timeoutMs = 10_000,
  ): Promise<HttpProbeResult> {
    return new Promise((resolve) => {
      const lib = url.startsWith('https') ? https : http;
      const req = lib.request(url, { method, timeout: timeoutMs }, (res) => {
        const status = res.statusCode ?? 0;
        const ok = status >= 200 && status < 300;

        if (method === 'HEAD') {
          res.resume();
          res.on('end', () => resolve({ ok, status }));
          return;
        }

        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let json: unknown;
          try {
            json = JSON.parse(data);
          } catch {
            json = undefined;
          }
          resolve({ ok, status, json });
        });
      });
      req.on('error', () => resolve({ ok: false, status: 0 }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, status: 0 });
      });
      req.end();
    });
  }

  /** 产物可访问性检查（HEAD，避免下载整个产物） */
  async headOk(url: string, timeoutMs = 10_000): Promise<boolean> {
    const res = await this.request(url, 'HEAD', timeoutMs);
    return res.ok;
  }

  /** GET JSON；非 2xx / 响应体非 JSON / 网络失败 → null（调用方按 null 处理，不抛错） */
  async getJson<T>(url: string, timeoutMs = 10_000): Promise<T | null> {
    const res = await this.request(url, 'GET', timeoutMs);
    return res.ok ? ((res.json as T | undefined) ?? null) : null;
  }

  /**
   * 查询 gateway 模块清单（verify 阶段断言版本是否生效）。
   * 兼容两种响应：裸 {modules:[...]} 与全局拦截器包装 {code,data:{modules:[...]}}
   */
  async fetchGatewayManifest(
    gatewayBaseUrl: string,
  ): Promise<{ modules?: Array<{ name?: string; key?: string; version?: string }> } | null> {
    const res = await this.request(`${gatewayBaseUrl}/__manifest__`, 'GET');
    if (!res.ok || !res.json) {
      this.logger.warn(`查询 manifest 失败: HTTP ${res.status}`);
      return null;
    }
    const data = (res.json as { data?: unknown })?.data ?? res.json;
    return (data ?? null) as { modules?: Array<{ name?: string; key?: string; version?: string }> } | null;
  }
}
