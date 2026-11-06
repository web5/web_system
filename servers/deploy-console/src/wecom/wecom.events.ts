import { EventEmitter } from 'events';

/**
 * 挂起事件桥（卡② / spec §5.1 ①）。
 *
 * 为什么不用 Nest DI 直接注入：`WecomModule` 需要 `PipelineService`，
 * 而挂起点在 `PipelineService` 内部 —— 反向注入会形成模块循环依赖。
 * 这个零依赖单例让挂起分支只多一行 `emit`，notifier 在模块初始化时订阅；
 * 开关关闭则根本不订阅（V12「完全回到现状」）。
 *
 * console 是单点进程；跨实例广播不在本期范围（见契约文档 §五）。
 */

export const WECOM_APPROVAL_AWAITING = 'approval.awaiting';

export interface ApprovalAwaitingEvent {
  approvalId: string;
  pipelineId: string;
  env: string;
  moduleKey: string;
  versionTag?: string;
  gitBranch?: string;
  commitId?: string;
  nodeKey?: string;
  nodeLabel?: string;
  operator?: string;
  createdAt: number;
}

export const wecomEvents = new EventEmitter();
wecomEvents.setMaxListeners(5);
