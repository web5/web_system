import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationLogEntity } from '../entities/notification-log.entity';

export type NotifyStatus = 'success' | 'failed' | 'warn';

export interface NotifyEntry {
  event: string;
  env: string;
  moduleKey: string;
  versionTag?: string;
  status: NotifyStatus;
  detail: string;
  operator?: string;
}

/** 通用 Webhook 与企业微信的超时（5s）：宁可丢通知，也不能阻塞发布主流程 */
const DISPATCH_TIMEOUT_MS = 5000;

/**
 * 拼通知正文（纯函数，便于单测）。
 * 企业微信 markdown 用，通用 Webhook 则透传结构化 JSON。
 */
export function formatNotifyText(e: NotifyEntry): string {
  const icon = e.status === 'success' ? '✅' : e.status === 'failed' ? '❌' : '⚠️';
  const lines = [
    `### ${icon} ${e.event}`,
    `> 环境：${e.env}`,
    `> 模块：${e.moduleKey}`,
  ];
  if (e.versionTag) lines.push(`> 版本：${e.versionTag}`);
  if (e.operator) lines.push(`> 操作人：${e.operator}`);
  lines.push(`> ${e.detail}`);
  return lines.join('\n');
}

/**
 * 通知中心。
 *
 * 通道（均为可选，通过环境变量配置）：
 * - `NOTIFY_WEBHOOK_URL`：通用 Webhook，POST 结构化 JSON；
 * - `NOTIFY_WECOM_URL`：企业微信机器人，POST markdown。
 *
 * **铁律：通知是"尽力而为"，任何失败（无通道/超时/推送失败）都不得抛错、不得阻塞发布。**
 * 送达结果写回 `delivery`，供运维发现"通道没配/推不出去"。
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectRepository(NotificationLogEntity)
    private readonly repo: Repository<NotificationLogEntity>,
    private readonly configService: ConfigService,
  ) {}

  /** 通道配置状态（供运维确认是否已接通） */
  channels(): { webhook: string | null; wecom: string | null } {
    return {
      webhook: this.configService.get<string>('NOTIFY_WEBHOOK_URL') || null,
      wecom: this.configService.get<string>('NOTIFY_WECOM_URL') || null,
    };
  }

  /**
   * 统一事件入口：写站内记录 + 异步分发到已配置通道。
   * 同步部分只做 DB 写入（也容错），分发在后台执行。
   */
  async notify(entry: NotifyEntry): Promise<void> {
    let logId: string | null = null;
    try {
      const row = await this.repo.save(
        this.repo.create({ ...entry, delivery: {} }),
      );
      logId = row.id;
    } catch (e) {
      this.logger.warn(`写入通知记录失败: ${(e as Error).message}`);
    }

    void this.dispatch(entry, logId);
  }

  /** 历史查询（站内） */
  list(limit = 50): Promise<NotificationLogEntity[]> {
    const safeLimit = Number.isFinite(Number(limit)) && Number(limit) > 0
      ? Math.min(Number(limit), 200)
      : 50;
    return this.repo.find({
      order: { createdAt: 'DESC' },
      take: safeLimit,
    });
  }

  private async dispatch(entry: NotifyEntry, logId: string | null): Promise<void> {
    const delivery: Record<string, string> = {};
    const { webhook, wecom } = this.channels();

    if (webhook) {
      delivery.webhook = await this.safePost(webhook, {
        event: entry.event,
        env: entry.env,
        moduleKey: entry.moduleKey,
        versionTag: entry.versionTag ?? null,
        status: entry.status,
        detail: entry.detail,
        operator: entry.operator ?? null,
        time: new Date().toISOString(),
      });
    }
    if (wecom) {
      delivery.wecom = await this.safePost(wecom, {
        msgtype: 'markdown',
        markdown: { content: formatNotifyText(entry) },
      });
    }

    if (logId) {
      try {
        await this.repo.update(logId, { delivery });
      } catch (e) {
        this.logger.warn(`回写送达结果失败: ${(e as Error).message}`);
      }
    }
  }

  private async safePost(url: string, body: unknown): Promise<string> {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`通知通道返回 ${res.status}: ${url}`);
        return `failed(http ${res.status})`;
      }
      return 'ok';
    } catch (e) {
      this.logger.warn(`通知通道不可达: ${url}（${(e as Error).message}）`);
      return 'failed';
    }
  }
}
