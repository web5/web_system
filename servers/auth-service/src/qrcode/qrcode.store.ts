import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';

/** 扫码 ticket 状态 */
export interface QrcodeTicket {
  ticketId: string;
  status: 'pending' | 'confirmed' | 'expired';
  /** 小程序扫码确认后绑定的用户信息 */
  userId?: number;
  accessToken?: string;
  refreshToken?: string;
  createdAt: number;
}

const TTL_MS = 5 * 60 * 1000; // 5 分钟过期

@Injectable()
export class QrcodeStore {
  private readonly logger = new Logger(QrcodeStore.name);
  /** 内存兜底存储（生产环境建议替换为 Redis） */
  private store = new Map<string, QrcodeTicket>();

  /** 生成 ticket */
  create(): QrcodeTicket {
    const ticketId = randomBytes(16).toString('hex');
    const ticket: QrcodeTicket = {
      ticketId,
      status: 'pending',
      createdAt: Date.now(),
    };
    this.store.set(ticketId, ticket);
    // 5分钟后自动清理
    setTimeout(() => {
      const t = this.store.get(ticketId);
      if (t && t.status === 'pending') {
        t.status = 'expired';
        this.logger.log(`Ticket ${ticketId} expired`);
      }
      setTimeout(() => this.store.delete(ticketId), 5000);
    }, TTL_MS);
    return ticket;
  }

  /** 获取 ticket */
  get(ticketId: string): QrcodeTicket | undefined {
    const ticket = this.store.get(ticketId);
    if (!ticket) return undefined;
    // 检查是否过期
    if (Date.now() - ticket.createdAt > TTL_MS) {
      if (ticket.status === 'pending') {
        ticket.status = 'expired';
      }
    }
    return ticket;
  }

  /** 标记为已确认（绑定用户） */
  confirm(ticketId: string, userId: number, accessToken: string, refreshToken: string): boolean {
    const ticket = this.store.get(ticketId);
    if (!ticket || ticket.status !== 'pending') return false;
    ticket.status = 'confirmed';
    ticket.userId = userId;
    ticket.accessToken = accessToken;
    ticket.refreshToken = refreshToken;
    return true;
  }
}
