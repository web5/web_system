import * as http from 'http';
import * as https from 'https';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** 一次通知的结果（便于测试与审计留痕） */
export interface GatewayNotifyResult {
  ok: boolean;
  reason: 'notified' | 'not-configured' | 'failed';
  url?: string;
  message?: string;
}

/**
 * gateway 版本缓存失效通知（诊断 #16）。
 *
 * 为什么需要：`IndexHtmlService.versionCache`（TTL 10s）决定 gateway 加载哪个版本目录，
 * 而版本指针由控制台写 —— gateway 感知不到变更，不通知就是「部署了但页面最多 10s 后才变」。
 *
 * 为什么抽成独立服务：此前这段逻辑**只存在于 `DeployService` 内部**，
 * 于是只有「走 deploy.service 的那条发布路径」会通知；UI 切换/回滚、
 * `internal/release/pointer` 这些同样改指针的入口全都不通知（诊断 #16）。
 * 抽出来后由「改指针」的各个入口各自调用，通知才跟得住真相。
 *
 * 失败语义：**只告警不抛错** —— 指针已经写成功了，通知失败最多是缓存晚 10s 失效，
 * 绝不能把一次成功的发布判成失败。
 */
@Injectable()
export class GatewayCacheService {
  private readonly logger = new Logger(GatewayCacheService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * gateway 内部地址按环境取值：
   * `GATEWAY_INTERNAL_URL_<ENV>` → `GATEWAY_INTERNAL_URL`（兼容旧单值配置）。
   *
   * 为什么要按环境：跨环境只能通知一个 gateway 是历史设计（单值），
   * 而 dev/prod 各有一个 gateway —— 发 prod 却去刷 dev 的缓存，等于没刷。
   */
  urlFor(envId?: string): string {
    if (envId) {
      const perEnv =
        this.configService.get<string>(`GATEWAY_INTERNAL_URL_${envId.toUpperCase()}`) || '';
      if (perEnv.trim()) return perEnv.trim();
    }
    return (this.configService.get<string>('GATEWAY_INTERNAL_URL') || '').trim();
  }

  /** 服务键同样按环境取值，回落通用键 */
  private keyFor(envId?: string): string {
    if (envId) {
      const perEnv =
        this.configService.get<string>(`GATEWAY_SERVICE_KEY_${envId.toUpperCase()}`) || '';
      if (perEnv.trim()) return perEnv.trim();
    }
    return (
      this.configService.get<string>('GATEWAY_SERVICE_KEY') ||
      this.configService.get<string>('FINNEWS_SERVICE_KEY') ||
      ''
    );
  }

  /**
   * 通知 gateway 立即失效版本缓存（best-effort，永不抛错）。
   * @returns 结果对象（调用方可选地写进日志/审计）
   */
  async notifyVersionChange(input: {
    env: string;
    moduleKey: string;
    version: string;
    reason?: string;
    /**
     * 显式传入的服务键：调用方若已有「配置中心优先」的取值链（如 DeployService），
     * 传进来即可，避免两套凭据逻辑各走各的。不传则按环境取配置。
     */
    serviceKey?: string;
  }): Promise<GatewayNotifyResult> {
    const base = this.urlFor(input.env);
    const key = input.serviceKey?.trim() || this.keyFor(input.env);
    const reason = input.reason ?? '版本指针变更';
    const url = base ? `${base.replace(/\/+$/, '')}/api/internal/gateway/reload` : '';
    if (!url || !key) {
      this.logger.warn(
        `未配置 GATEWAY_INTERNAL_URL${input.env ? `_${input.env.toUpperCase()}` : ''} / ` +
          `GATEWAY_SERVICE_KEY，跳过 gateway 缓存刷新（${reason}；最多 10s 后自然生效）`,
      );
      return { ok: false, reason: 'not-configured' };
    }
    try {
      await this.postNoBody(url, key);
      this.logger.log(
        `已通知 gateway 刷新缓存（${reason}）：${input.env}/${input.moduleKey} -> ${input.version}`,
      );
      return { ok: true, reason: 'notified', url };
    } catch (e) {
      this.logger.warn(
        `gateway 缓存刷新失败（${reason}）：${(e as Error).message}（最多 10s 后自然生效）`,
      );
      return { ok: false, reason: 'failed', url, message: (e as Error).message };
    }
  }

  /**
   * 发一个无 body 的 POST（仅用 Node `http`/`https`，**刻意不用全局 fetch**）。
   * 为什么不用 fetch：Node 的 fetch 走 undici，按 WHATWG 规范**拒连「bad port」**，
   * 而本地 gateway 端口 6000 正在黑名单里 → 一律表现为 `fetch failed`（与网络无关，极易误判）。
   */
  private postNoBody(urlStr: string, serviceKey: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let u: URL;
      try {
        u = new URL(urlStr);
      } catch {
        reject(new Error(`URL 非法：${urlStr}`));
        return;
      }
      const client = u.protocol === 'https:' ? https : http;
      const req = client.request(
        {
          method: 'POST',
          hostname: u.hostname,
          port: u.port || (u.protocol === 'https:' ? 443 : 80),
          path: `${u.pathname}${u.search}`,
          headers: { 'x-service-key': serviceKey, 'content-length': 0 },
        },
        (res) => {
          const code = res.statusCode || 0;
          res.resume();
          if (code >= 200 && code < 300) resolve();
          else reject(new Error(`HTTP ${code}`));
        },
      );
      req.on('error', reject);
      req.setTimeout(5000, () => req.destroy(new Error('gateway 通知超时（5s）')));
      req.end();
    });
  }
}
