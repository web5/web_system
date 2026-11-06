import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { WecomConfigService } from './wecom.config';
import { WecomApiClient } from './wecom-api.client';
import {
  ApprovalAwaitingEvent,
  WECOM_APPROVAL_AWAITING,
  wecomEvents,
} from './wecom.events';

/**
 * 待办推送（卡② T2-b / V1 / V11）。
 *
 * 🔴 纪律：推送**永远不阻塞**流水线。事件回调里 `void this.push()`，
 * push 内部吞掉一切异常，只记一条 `delivery.wecom=failed` 日志；
 * 流水线照旧挂起、控制台与 MCP 照旧可审批。
 *
 * 收件人本期用 `@all`（应用可见范围已在 #8538 限定为审批人）；
 * 精确按节点白名单反查 wecom_userid 需要卡① 补反向 lookup 契约，
 * 属明确缺口，见契约文档 §七/§九，**不伪造接口**。
 */

export const WECOM_NOTIFY_ALL = '@all';

@Injectable()
export class WecomNotifierService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WecomNotifierService.name);
  private subscribed = false;

  constructor(
    private readonly config: WecomConfigService,
    private readonly api: WecomApiClient,
  ) {}

  onModuleInit(): void {
    // V12：总开关关闭 → 不订阅、不注册任何企微调用
    if (!this.config.enabled) {
      this.logger.log('企微审批通道未启用，跳过待办推送订阅（V12 回到现状）');
      return;
    }
    wecomEvents.on(WECOM_APPROVAL_AWAITING, this.onAwaiting);
    this.subscribed = true;
    this.logger.log('企微待办推送已订阅');
  }

  onModuleDestroy(): void {
    if (!this.subscribed) return;
    wecomEvents.off(WECOM_APPROVAL_AWAITING, this.onAwaiting);
    this.subscribed = false;
  }

  get isSubscribed(): boolean {
    return this.subscribed;
  }

  private readonly onAwaiting = (event: ApprovalAwaitingEvent): void => {
    void this.push(event);
  };

  /** 公开便于单测；失败一律吞掉并只留下可检索的告警 */
  async push(event: ApprovalAwaitingEvent): Promise<boolean> {
    if (!this.config.enabled) return false;
    try {
      const url = `${this.config.config.publicBaseUrl}/m/approve/${encodeURIComponent(event.approvalId)}`;
      const envTag = event.env === 'prod' ? 'PROD 生产' : event.env.toUpperCase();
      const description = [
        `环境：${envTag}`,
        `模块：${event.moduleKey}`,
        `版本：${event.versionTag || event.commitId || '-'}`,
        `节点：${event.nodeLabel || event.nodeKey || '发布确认'}`,
        `提交人：${event.operator || '-'}`,
        `时间：${new Date(event.createdAt).toLocaleString('zh-CN', { hour12: false })}`,
      ].join('\n');
      await this.api.sendTextCard(WECOM_NOTIFY_ALL, {
        title: `【待审批】${event.moduleKey} → ${envTag}`,
        description,
        url,
        btntxt: '去审批',
      });
      return true;
    } catch (e) {
      // V11：不抛、不改流水线状态、不重试（避免挂起路径被拖住）
      this.logger.warn(
        `delivery.wecom=failed approvalId=${event.approvalId} reason=${(e as Error).message}`,
      );
      return false;
    }
  }
}
