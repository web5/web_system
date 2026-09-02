import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemSettingEntity } from '../entities/system-setting.entity';

/** 通知渠道设置键 */
export const NOTIFY_WEBHOOK_URL_KEY = 'NOTIFY_WEBHOOK_URL';
export const NOTIFY_WECOM_URL_KEY = 'NOTIFY_WECOM_URL';

export interface NotifyChannels {
  webhook: string | null;
  wecom: string | null;
}

/**
 * 系统设置（通用键值）。
 *
 * 当前承载通知渠道配置；后续审批开关、度量保留期等系统级配置都收在这里，
 * 避免继续散落在代码与各环境变量里。
 */
@Injectable()
export class SystemSettingsService {
  constructor(
    @InjectRepository(SystemSettingEntity)
    private readonly repo: Repository<SystemSettingEntity>,
  ) {}

  async get(key: string): Promise<string | null> {
    const row = await this.repo.findOne({ where: { settingKey: key } });
    const v = row?.settingValue;
    return v ? v : null; // 空串视为未配置
  }

  async set(key: string, value: string | null, updatedBy?: string): Promise<void> {
    await this.repo.upsert(
      { settingKey: key, settingValue: value ?? '', updatedBy },
      { conflictPaths: ['settingKey'] },
    );
  }

  list(): Promise<SystemSettingEntity[]> {
    return this.repo.find({ order: { settingKey: 'ASC' } });
  }

  /**
   * 通知渠道解析：**DB 优先，env 兜底**。
   *
   * 兼容迁移前的部署（只有 env、从未在页面上配过）：DB 无值时走 env，
   * 保证升级后原有通知不丢；页面一旦配置过，以 DB 为准。
   */
  async notifyChannels(envGetter?: (key: string) => string | undefined): Promise<NotifyChannels> {
    const rows = await this.repo.find();
    const db = new Map(
      rows.filter((r) => r.settingValue).map((r) => [r.settingKey, r.settingValue as string]),
    );

    const pick = (key: string): string | null => {
      const fromDb = db.get(key);
      if (fromDb) return fromDb;
      return envGetter?.(key) || null;
    };

    return {
      webhook: pick(NOTIFY_WEBHOOK_URL_KEY),
      wecom: pick(NOTIFY_WECOM_URL_KEY),
    };
  }

  /** 更新通知渠道（传 null/undefined 表示不清动；空串则关闭该通道） */
  async setNotifyChannels(
    channels: { webhook?: string | null; wecom?: string | null },
    updatedBy?: string,
  ): Promise<void> {
    if (channels.webhook !== undefined) {
      await this.set(NOTIFY_WEBHOOK_URL_KEY, channels.webhook, updatedBy);
    }
    if (channels.wecom !== undefined) {
      await this.set(NOTIFY_WECOM_URL_KEY, channels.wecom, updatedBy);
    }
  }
}
