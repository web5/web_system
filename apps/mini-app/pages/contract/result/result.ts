/**
 * 合同翻译官 - 结果页
 * 展示风险报告：结论 + 风险信号列表（按严重度）+ 免责声明
 */
import type { ContractReport } from '../../../services/contract-api';

Page({
  data: {
    report: null as ContractReport | null,
    signals: [] as Array<{ open: boolean; dangerCount: number; warnCount: number; okCount: number }>,
    summary: { danger: 0, warn: 0, ok: 0 },
  },

  onLoad() {
    const storage = wx.getStorageSync('contract_report');
    const report = storage.latest as ContractReport | undefined;
    if (report) {
      this.processReport(report);
    } else {
      wx.showToast({ title: '暂无报告数据', icon: 'none' });
    }
  },

  processReport(report: ContractReport) {
    const signals = report.signals.map((s: any) => ({ ...s, open: false }));
    const summary = {
      danger: report.signals.filter((s: any) => s.level === 'danger').length,
      warn: report.signals.filter((s: any) => s.level === 'warn').length,
      ok: report.signals.filter((s: any) => s.level === 'ok').length,
    };
    this.setData({ report, signals, summary });
  },

  toggleSignal(e: any) {
    const index = e.currentTarget.dataset.index;
    const signals = this.data.signals.map((s: any, i: number) => ({
      ...s,
      open: i === index ? !s.open : s.open,
    }));
    this.setData({ signals });
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
