/**
 * 登录引导卡（登录墙）
 *
 * 口径（requirements-mp-account.md R1 / Q1 已拍板「必须登录才可用」）：
 * 未登录态下对话 / 发现 / 我的三处均渲染本组件，不发起任何业务请求。
 * 登录是 wx.login 静默换取，无授权弹窗，一次点击即可恢复。
 */
import { loginFromGate } from '../../services/auth';

Component({
  properties: {
    /** 主标题，默认「登录后继续使用」 */
    title: { type: String, value: '登录后继续使用' },
    /** 说明文案（各页可差异化，标题保持一致） */
    desc: { type: String, value: 'AI 对话、翻译与合翻都需要登录后使用' },
    /**
     * 协议页路径：传入才显示协议链接（M4 建页后启用）。
     * 未建页时不传，避免出现点不动的死链。
     */
    agreementUrl: { type: String, value: '' },
  },

  methods: {
    async onLogin() {
      const ok = await loginFromGate();
      if (ok) this.triggerEvent('logged');
    },

    onAgreement() {
      const url = this.data.agreementUrl;
      if (!url) return;
      wx.navigateTo({ url });
    },
  },
});
