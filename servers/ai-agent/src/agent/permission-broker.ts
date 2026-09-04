import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';

/**
 * 权限确认中介：桥接「SSE 流内的工具执行（await confirm）」与「前端确认接口」。
 *
 * 工作流：
 * 1. 工具执行遇到高危操作 → 引擎调 confirmHandler → 服务端 register() 生成 requestId 并挂起
 * 2. 服务端把 permission_request 事件写入 SSE 流
 * 3. 前端弹确认框 → 调 POST /agent/permission/:requestId { approve }
 * 4. resolve() 唤醒挂起的 Promise，工具继续/中止
 *
 * 安全：
 * - requestId 是 uuid（随机，不可猜）
 * - 校验确认者 userId 与发起 run 的用户一致，防止越权替他人确认
 */
@Injectable()
export class PermissionBroker {
  private readonly logger = new Logger(PermissionBroker.name);
  private readonly pending = new Map<
    string,
    { resolve: (ok: boolean) => void; userId: string }
  >();

  /** 注册一个待确认请求，返回 requestId（服务端据此挂起工具执行） */
  register(userId: string, resolve: (ok: boolean) => void): string {
    const requestId = randomUUID();
    this.pending.set(requestId, { resolve, userId });
    return requestId;
  }

  /** 解析确认结果（approve/reject）；返回 false 表示请求不存在或已处理 */
  resolve(requestId: string, userId: string, approve: boolean): boolean {
    const entry = this.pending.get(requestId);
    if (!entry) return false;
    if (entry.userId !== userId) {
      this.logger.warn(`权限确认越权：requestId=${requestId} 发起者=${entry.userId} 确认者=${userId}`);
      return false;
    }
    this.pending.delete(requestId);
    entry.resolve(approve);
    return true;
  }

  /** 超时自动拒绝（前端未在超时窗口内确认时调用） */
  rejectTimeout(requestId: string): void {
    const entry = this.pending.get(requestId);
    if (!entry) return;
    this.pending.delete(requestId);
    entry.resolve(false);
  }
}
