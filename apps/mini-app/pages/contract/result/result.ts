/**
 * 合同翻译官 - 结果页
 * 展示风险报告：结论 + 风险信号列表（按严重度）+ 免责声明
 * 底部提供"追问"入口：点击具体的"追问：xxx"问题或通用"追问"按钮，跳转独立对话页 chat 继续追问
 *
 * 两种进入方式：
 *  1. 即时分析完成后 redirectTo（无参）→ 从本地 storage 读取刚生成的报告（原有链路）
 *  2. 历史记录点开（带 conversationId）→ 从对话详情接口取 report 快照回放
 */
import type { ContractReport } from '../../../services/contract-api';
import { getContractConversation } from '../../../services/contract-api';

Page({
  data: {
    report: null as ContractReport | null,
    signals: [] as Array<{ open: boolean }>,
    rights: [] as Array<{ open: boolean }>,
    optimize: [] as Array<{ open: boolean }>,
    summary: { danger: 0, warn: 0, ok: 0 },
    /** 当前对话 id（跳转 chat 追问时复用，保证同一对话） */
    conversationId: '',
  },

  onLoad(options: Record<string, string | undefined>) {
    const cid = options?.conversationId;
    if (cid) {
      this.loadByConversation(cid);
      return;
    }
    const storage = wx.getStorageSync('contract_report');
    const report = storage.latest as ContractReport | undefined;
    if (report) {
      this.setData({ conversationId: report.conversationId || '' });
      this.processReport(report);
    } else {
      wx.showToast({ title: '暂无报告数据', icon: 'none' });
    }
  },

  /** 历史回放：按 conversationId 拉详情，用 report 快照渲染（不依赖本地 storage） */
  async loadByConversation(conversationId: string) {
    wx.showLoading({ title: '加载中' });
    try {
      const detail = await getContractConversation(conversationId);
      this.setData({ conversationId: detail.id });
      if (detail.report) {
        this.processReport(detail.report);
      } else {
        this.setData({ report: null, signals: [], rights: [], optimize: [], summary: { danger: 0, warn: 0, ok: 0 } });
        wx.showToast({ title: '该记录暂无报告快照', icon: 'none' });
      }
    } catch {
      // request 层已 toast
    } finally {
      wx.hideLoading();
    }
  },

  processReport(report: ContractReport) {
    const signals = report.signals.map((s: any) => ({ ...s, open: false }));
    const rights = (report.rights || []).map((r: any) => ({ ...r, open: false }));
    const optimize = (report.optimize || []).map((o: any) => ({ ...o, open: false }));
    const summary = {
      danger: report.signals.filter((s: any) => s.level === 'danger').length,
      warn: report.signals.filter((s: any) => s.level === 'warn').length,
      ok: report.signals.filter((s: any) => s.level === 'ok').length,
    };
    this.setData({ report, signals, rights, optimize, summary });
  },

  /** 快捷追问：点击具体的"追问：xxx"问题 → 进入对话页，把该问题作为第二轮对话并自动开始分析回复 */
  askFollowUp(e: any) {
    const question = String(e.currentTarget.dataset.q || '').trim();
    if (!question) return;
    wx.navigateTo({
      url: `/pages/contract/chat/chat?question=${encodeURIComponent(question)}${this.conversationQuery()}`,
    });
  },

  /** 通用"追问"按钮：进入空白对话页（仅展示分析结论作为第一轮，由用户自行输入提问） */
  goChat() {
    wx.navigateTo({ url: `/pages/contract/chat/chat${this.conversationQuery(true)}` });
  },

  /** 携带当前对话 id 的 query 片段（保证追问属于同一对话） */
  conversationQuery(leading = false): string {
    const cid = this.data.conversationId;
    if (!cid) return '';
    return `${leading ? '?' : '&'}conversationId=${encodeURIComponent(cid)}`;
  },

  toggleSignal(e: any) {
    const index = e.currentTarget.dataset.index;
    const signals = this.data.signals.map((s: any, i: number) => ({
      ...s,
      open: i === index ? !s.open : s.open,
    }));
    this.setData({ signals });
  },

  toggleRight(e: any) {
    const index = e.currentTarget.dataset.index;
    const rights = this.data.rights.map((r: any, i: number) => ({
      ...r,
      open: i === index ? !r.open : r.open,
    }));
    this.setData({ rights });
  },

  toggleOptimize(e: any) {
    const index = e.currentTarget.dataset.index;
    const optimize = this.data.optimize.map((o: any, i: number) => ({
      ...o,
      open: i === index ? !o.open : o.open,
    }));
    this.setData({ optimize });
  },

  goHome() {
    wx.navigateBack({
      delta: 999,
      fail: () => {
        wx.reLaunch({ url: '/pages/contract/index/index' });
      },
    });
  },
});
