// pages/scan/scan.ts
// 扫码登录页 - 扫描 PC 网页上的二维码，确认登录
// 流程：用户点"扫一扫" → wx.scanCode 扫 PC 端 QR 码 → 提取 ticket → 调 /auth/qrcode/confirm

interface IAppOption {
  globalData: {
    apiBase: string;
  };
}

Page({
  data: {
    /** 状态: idle / scanning / confirming / success / fail */
    status: 'idle' as 'idle' | 'scanning' | 'confirming' | 'success' | 'fail',
    statusTip: '请扫描 PC 网页上的登录二维码',
    errorMsg: '',
  },

  /** 开始扫码 */
  startScan() {
    this.setData({ status: 'scanning', errorMsg: '' });
    wx.scanCode({
      success: (res) => {
        // 提取 ticket（支持多种 URL 格式）
        const url = res.result;
        const ticket = this.extractTicket(url);
        if (!ticket) {
          this.setData({
            status: 'fail',
            errorMsg: '无效的二维码，请扫描 PC 网页上的登录二维码',
          });
          return;
        }
        this.setData({ status: 'confirming' });
        this.confirmLogin(ticket);
      },
      fail: () => {
        this.setData({ status: 'idle' });
      },
    });
  },

  /** 从扫码结果提取 ticket */
  extractTicket(text: string): string | null {
    // 匹配 URL 中的 ?ticket=xxx 或 &ticket=xxx
    const match = text.match(/[?&]ticket=([^&]+)/);
    if (match) return match[1];
    // 纯 ticket 字符串（去掉前缀如 kedouai://scan?ticket=）
    const direct = text.match(/^kedouai:\/\/scan\?ticket=(.+)$/);
    if (direct) return direct[1];
    // 兜底：如果是 32 位 hex，认为就是 ticket
    if (/^[a-f0-9]{16,}$/i.test(text)) return text;
    return null;
  },

  /** 确认登录 */
  async confirmLogin(ticket: string) {
    try {
      // 1. 调小程序自己的登录获取 openid
      const loginRes = await wx.login();
      if (!loginRes.code) {
        this.setData({ status: 'fail', errorMsg: '获取登录凭证失败' });
        return;
      }

      // 2. 调后端 confirm 接口
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

      if (res && res.success) {
        this.setData({ status: 'success' });
        // 2秒后返回首页
        setTimeout(() => {
          wx.navigateBack();
        }, 2000);
      } else {
        this.setData({
          status: 'fail',
          errorMsg: (res && res.message) || '登录确认失败',
        });
      }
    } catch (err: any) {
      this.setData({
        status: 'fail',
        errorMsg: err.errMsg || '网络错误，请重试',
      });
    }
  },

  /** 自动触发扫码（带 from=index 时自动开始） */
  onLoad(options: { from?: string }) {
    if (options.from === 'index') {
      // 延迟一点触发，让用户看到提示
      setTimeout(() => this.startScan(), 300);
    }
  },
});
