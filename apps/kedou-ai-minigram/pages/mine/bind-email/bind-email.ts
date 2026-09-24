// 绑定邮箱：邮箱 + 验证码（自绘页，原生弹窗无输入框）
import { sendEmailCode, bindEmail, applyMergedToken, readConflict, readMessage } from '../../../services/account';
import { isLoggedIn } from '../../../services/auth';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Page({
  onLoad(options?: { purpose?: string }) {
    // 登录守卫：分享直达等路径可能绕过 tab 的登录墙
    if (!isLoggedIn()) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      wx.navigateBack();
      return;
    }
    if (options?.purpose === 'change') this.setData({ purpose: 'change', title: '更换邮箱' });
  },

  data: {
    title: '绑定邮箱',
    purpose: 'bind' as 'bind' | 'change',
    email: '',
    code: '',
    /** 倒计时剩余秒数；0 = 可发送 */
    countdown: 0,
    err: '',
    busy: false,
  },

  onEmailInput(e: any) {
    this.setData({ email: e.detail.value, err: '' });
  },
  onCodeInput(e: any) {
    this.setData({ code: e.detail.value, err: '' });
  },

  /** 获取验证码：字段级校验 + 60s 倒计时（真机由服务端 429 驱动，倒计时只为体验） */
  async onSendCode() {
    if (this.data.countdown > 0 || this.data.busy) return;
    const email = String(this.data.email || '').trim();
    if (!EMAIL_RE.test(email)) {
      this.setData({ err: '邮箱格式不正确，请检查' });
      return;
    }
    this.setData({ busy: true, err: '' });
    try {
      const res = await sendEmailCode(email);
      wx.showToast({ title: res?.message || '验证码已发送', icon: 'none' });
      this.startCountdown();
    } catch (err: any) {
      this.setData({ err: readMessage(err, '发送失败，请稍后再试') });
    } finally {
      this.setData({ busy: false });
    }
  },

  startCountdown() {
    this.setData({ countdown: 60 });
    const timer = setInterval(() => {
      const left = this.data.countdown - 1;
      if (left <= 0) {
        this.clearTimer();
        this.setData({ countdown: 0 });
        return;
      }
      this.setData({ countdown: left });
    }, 1000);
    (this as any)._timer = timer;
  },

  clearTimer() {
    if ((this as any)._timer) {
      clearInterval((this as any)._timer);
      (this as any)._timer = null;
    }
  },

  onUnload() {
    this.clearTimer();
  },

  async onSubmit() {
    if (this.data.busy) return;
    const email = String(this.data.email || '').trim();
    const code = String(this.data.code || '').trim();
    if (!EMAIL_RE.test(email)) {
      this.setData({ err: '邮箱格式不正确，请检查' });
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      this.setData({ err: '请输入 6 位数字验证码' });
      return;
    }
    this.setData({ busy: true, err: '' });
    try {
      const result = await bindEmail(email, code);
      if (result.conflict) {
        this.confirmMerge(email, code, result.hint, result.maskedValue);
        return;
      }
      wx.showToast({ title: '绑定成功', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
    } catch (err: any) {
      const conflict = readConflict(err);
      if (conflict) {
        this.confirmMerge(email, code, conflict.hint, conflict.maskedValue);
        return;
      }
      this.setData({ err: readMessage(err, '验证失败，请稍后重试') });
    } finally {
      this.setData({ busy: false });
    }
  },

  /** 合并二次确认：写明会合并数据且不可撤销 */
  confirmMerge(email: string, code: string, hint: string, masked: string) {
    wx.showModal({
      title: '该邮箱已注册',
      content:
        hint ||
        `${masked} 已注册科豆账号。绑定后会把当前小程序的对话、生词本与口味记忆合并到该账号，合并不可撤销。`,
      confirmText: '确认合并',
      cancelText: '取消',
      success: (res: any) => {
        if (!res.confirm) return;
        void (async () => {
          try {
            const result = await bindEmail(email, code, true);
            if (result.merged) {
              applyMergedToken(result);
              wx.showToast({ title: '已合并到该账号（凭证已重签）', icon: 'none' });
              setTimeout(() => wx.navigateBack(), 800);
            }
          } catch (err: any) {
            this.setData({ err: readMessage(err, '合并失败，你的数据未发生变更') });
          }
        })();
      },
    });
  },
});
