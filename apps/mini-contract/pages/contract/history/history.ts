/**
 * 合同翻译官 - 历史记录
 *
 * 数据源：对话历史接口（agent_conversations 为唯一真相源，不再依赖本地 storage）。
 * 每次进入 tab 拉取当前用户的多次合同分析记录；点击某条 → result 页回放该次报告。
 */
import { listContractConversations, normalizeScene } from '../../../services/contract-api';

interface HistoryRecord {
  id: string;
  scene: string;
  time: string;
  danger: number;
  warn: number;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

Page({
  data: {
    records: [] as HistoryRecord[],
    loading: false,
  },

  onShow() {
    this.loadRecords();
  },

  async loadRecords() {
    this.setData({ loading: true });
    try {
      const { list } = await listContractConversations(1, 50);
      const records: HistoryRecord[] = list.map((item) => ({
        id: item.id,
        scene: item.meta?.scene ? normalizeScene(item.meta.scene) : '未知',
        time: formatTime(item.updatedAt),
        danger: item.meta?.danger ?? 0,
        warn: item.meta?.warn ?? 0,
      }));
      this.setData({ records });
    } catch {
      // request 层已 toast，这里保持现有列表
    } finally {
      this.setData({ loading: false });
    }
  },

  /** 点击某次分析 → result 页回放该对话（带 conversationId） */
  goDetail(e: any) {
    const id = String(e.currentTarget.dataset.id || '');
    if (!id) return;
    wx.navigateTo({ url: `/pages/contract/result/result?conversationId=${encodeURIComponent(id)}` });
  },
});
