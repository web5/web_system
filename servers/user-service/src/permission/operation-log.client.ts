import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** 上报参数（与 system-service `POST /internal/logs` 对齐） */
export interface OperationLogInput {
  operator: string;
  type: string;
  target?: string;
  ip?: string;
}

/**
 * 操作日志上报客户端（→ system-service `POST /internal/logs`，`x-internal-key`）。
 *
 * 背景：权限同步的动作发生在 user-service，但审计表 `operation_logs` 与 admin
 * 「操作日志」页归 system-service。跨服务上报而不是直连对方的库，保持服务边界。
 *
 * 契约：**上报失败只告警，绝不抛错**——审计不可用不该阻断业务本身。
 */
@Injectable()
export class OperationLogClient {
  private readonly logger = new Logger(OperationLogClient.name);

  constructor(private readonly config: ConfigService) {}

  async write(input: OperationLogInput): Promise<void> {
    const base = (this.config.get<string>('SYSTEM_SERVICE_URL') || 'http://127.0.0.1:6004').replace(
      /\/+$/,
      '',
    );
    const key = this.config.get<string>('INTERNAL_API_KEY') || '';
    if (!key) {
      this.logger.warn('INTERNAL_API_KEY 未配置，跳过操作日志上报');
      return;
    }
    try {
      const res = await fetch(`${base}/internal/logs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-key': key,
        },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      this.logger.warn(`操作日志上报失败（不阻断业务）: ${(e as Error).message}`);
    }
  }
}
