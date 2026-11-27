/**
 * 登录引导卡（唯一共享面）
 *
 * 口径（requirements-mp-account.md R1 / Q1 已拍板「必须登录才可用」）：
 * 未登录态下对话 / 发现 / 我的三处均渲染本组件，不发起任何业务请求。
 * 登录是 wx.login 静默换取，无授权弹窗，一次点击即可恢复。
 *
 * 双态（V12/V13-A/清单 4）：
 * - mode='page'（默认）：三 tab 页整页登录墙，铺满拦截；不传 mode 即此态，零回归。
 * - mode='modal'：三数据页会话过期弹窗，标题固定「登录已过期」，含「重新登录 / 稍后」。
 *   叠加层不整页替换，底层骨架/内容由页面保留；登录成功后由页面级广播收起并重拉。
 *
 * 🔴 组件只触发 logged / defer 事件，不订阅任何登录态广播（否则与页面双重响应）。
 */
import { loginFromGate } from '../../services/auth';

Component({
  properties: {
    /** 'page' 整页墙（默认）| 'modal' 会话过期弹窗 */
    mode: { type: String, value: 'page' },
    /** 主标题，默认「登录后继续使用」（modal 态固定用「登录已过期」，不用此值） */
    title: { type: String, value: '登录后继续使用' },
    /** 说明文案（各页可差异化，标题保持一致） */
    desc: { type: String, value: '学习进度与收藏都跟着账号走' },
    /**
     * 协议页路径：传入才显示协议链接（M4 建页后启用）。
     * 未建页时不传，避免出现点不动的死链。
     */
    agreementUrl: { type: String, value: '' },
  },

  data: {
    /** V14：登录按钮 loading / 禁用防重复；失败复位可再点 */
    logging: false,
  },

  methods: {
    async onLogin() {
      if (this.data.logging) return;
      this.setData({ logging: true });
      let ok = false;
      try {
        ok = await loginFromGate();
      } catch {
        // 失败不吞错、不跳转：弹窗仍在，按钮复位供再次点击
        ok = false;
      }
      this.setData({ logging: false });
      if (ok) this.triggerEvent('logged');
    },

    /** V17「稍后」：只抛 defer 事件，由页面置常驻提示条；组件不自行关闭整页 */
    onDefer() {
      this.triggerEvent('defer');
    },

    onAgreement() {
      const url = this.data.agreementUrl;
      if (!url) return;
      wx.navigateTo({ url });
    },
  },
});
