// pages/scan/scan.ts
// 扫码登录确认页 — 扫描网页端二维码，确认登录

Page({
  data: {
    /** 扫码状态: idle / scanning / confirming / success / fail */
    status: 'idle',
    ticket: '',
    message: '',
  },

  /** 开始扫码 */
  startScan() {
    this.setData({ status: 'scanning', message: '' });
    wx.scanCode({
      success: (res) => {
        // QR 码内容格式: https://kedouai.com/mini-scan?ticket=xxx
        const url = res.result;
        const match = url.match(/[?&]ticket=([^&]+)/);
        if (!match) {
          this.setData({ status: 'fail', message: '无效的二维码，请扫描网页上的登录二维码' });
          return;
        }
        const ticket = match[1];
        this.setData({ ticket, status: 'confirming' });
        this.confirmLogin(ticket);
      },
      fail: () => {
        this.setData({ status: 'idle' });
      },
    });
  },

  /** 确认登录 */
  async confirmLogin(ticket: string) {
    try {
      // 1. 获取微信登录 code
      const loginRes = await wx.login();
      if (!loginRes.code) {
        this.setData({ status: 'fail', message: '获取登录凭证失败' });
        return;
      }

      // 2. 调用后端确认接口
      const app = getApp<IAppOption>();
      const res = await new Promise<any>((resolve, reject) => {
        wx.request({
          url: `${app.globalData.apiBase}/auth/qrcode/confirm`,
          method: 'POST',
          data: { ticket, code: loginRes.code },
          success: (r) => resolve(r.data),
          fail: reject,
        });
      });

      if (res.success) {
        this.setData({ status: 'success', message: '登录确认成功，请返回网页查看' });
      } else {
        this.setData({ status: 'fail', message: res.message || '登录确认失败' });
      }
    } catch (err: any) {
      this.setData({ status: 'fail', message: err.errMsg || '网络错误，请重试' });
    }
  },

  /** 重新扫码 */
  retry() {
    this.startScan();
  },
});
