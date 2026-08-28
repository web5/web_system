/**
 * 合同翻译官 - 历史记录
 */
Page({
  data: {
    records: [] as Array<{ scene: string; time: string; danger: number; warn: number }>,
  },

  onShow() {
    this.loadRecords();
  },

  loadRecords() {
    const storage = wx.getStorageSync('contract_report');
    const latest = storage.latest;
    if (latest) {
      const d = new Date(latest.createdAt);
      const pad = (n: number) => String(n).padStart(2, '0');
      const danger = latest.signals.filter((s: any) => s.level === 'danger').length;
      const warn = latest.signals.filter((s: any) => s.level === 'warn').length;
      this.setData({
        records: [{
          scene: latest.scene || '未知',
          time: `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
          danger,
          warn,
        }],
      });
    }
  },

  goLatest() {
    const storage = wx.getStorageSync('contract_report');
    if (storage.latest) {
      wx.navigateTo({ url: '/pages/contract/result/result' });
    } else {
      wx.showToast({ title: '暂无记录', icon: 'none' });
    }
  },
});
