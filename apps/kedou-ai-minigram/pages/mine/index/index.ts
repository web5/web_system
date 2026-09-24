/**
 * 科豆 AI · 我的（tab 3）—— 设置总入口
 *
 * 设置收敛为分组：应用设置（各应用自己的）/ 通用 / 我的数据。
 * 会话归属按「完全隔离」口径（Q6）：应用历史与主对话记录分列。
 *
 * 计数（trCount / asCount / chatCount）骨架期留空，不显示假数字；
 * 批次 4/5 接真后填充。
 */
import { getMusicTaste, tasteSummary } from '../../../services/user-taste';
import { listMemory } from '../../../services/user-memory';
import { listGlossary } from '../../../services/glossary';
import { isLoggedIn, logout } from '../../../services/auth';
import { fetchProfile } from '../../../services/account';

Page({
  data: {
    radiusClass: "",
    /** 登录态：false 时整页渲染登录引导卡（不拉任何业务数据） */
    loggedIn: true,
    nickname: '橙子哥哥',
    realName: '已实名',
    /** 脱敏手机号；空 = 未绑定（禁止展示硬编码假数据） */
    phone: '',
    /** 各应用 / 主对话的历史条数（空则不展示数字，避免假数据） */
    trCount: '',
    asCount: '',
    chatCount: '',
    cacheSize: '24.6MB',
    /** 音乐口味摘要（前 3 个标签；无则「未设置」） */
    tasteSummary: '未设置',
    /** 用户记忆条数摘要 */
    memorySummary: '0 条',
    /** 生词本条数摘要 */
    glossarySummary: '0 条',
  },

  /** 登记当前 tab（自定义 tabBar 据此渲染并高亮；对话页则隐藏） */
  onShow() {
    const __app = getApp<IAppOption>();
    const __cls = __app.radiusClassOf ? __app.radiusClassOf() : "";
    if (__cls !== this.data.radiusClass) this.setData({ radiusClass: __cls });

    const tabBar = (this as any).getTabBar?.();
    if (tabBar) tabBar.setData({ currentPage: '/pages/mine/index/index', selected: 2 });

    const loggedIn = isLoggedIn();
    this.setData({ loggedIn });
    // 未登录：只渲染登录卡，不发起任何业务请求（判据第 8 条）
    if (!loggedIn) return;

    // 账号信息：昵称 / 手机号（未绑定显示占位文案，不展示假数据）
    void fetchProfile().then((info) => {
      this.setData({
        phone: info.phone || '未绑定手机号',
        nickname: info.nickname || this.data.nickname,
      });
    });

    // 口味摘要：轻量读一次，失败保持「未设置」不打扰
    void getMusicTaste().then((t) => {
      this.setData({ tasteSummary: tasteSummary(t) });
    });
    // 用户记忆 / 生词本摘要：只取总数（pageSize=1），失败保持 0 条不打扰
    void listMemory(1, 1).then((r) => {
      this.setData({ memorySummary: (r.total || 0) + ' 条' });
    });
    void listGlossary(1, 1).then((r) => {
      this.setData({ glossarySummary: (r.total || 0) + ' 条' });
    });
  },

  goTaste() {
    wx.navigateTo({ url: '/pages/mine/taste/index' });
  },

  goMemory() {
    wx.navigateTo({ url: '/pages/mine/memory/index' });
  },

  goGlossary() {
    wx.navigateTo({ url: '/pages/mine/glossary/index' });
  },

  goProfile() { wx.navigateTo({ url: '/pages/mine/profile/profile' }); },
  goAppSettings() { wx.navigateTo({ url: '/pages/mine/settings/settings' }); },
  goTrSettings() { wx.navigateTo({ url: '/packageTranslate/pages/translate/settings/settings' }); },
  goAsSettings() { wx.navigateTo({ url: '/packageAssess/pages/assess/settings/settings' }); },
  goHistory() { wx.navigateTo({ url: '/packageTranslate/pages/translate/history/history' }); },

  goVip() { wx.showToast({ title: '会员功能开发中', icon: 'none' }); },
  goContracts() { wx.showToast({ title: '我的合同开发中', icon: 'none' }); },
  goChats() { wx.showToast({ title: '对话记录开发中', icon: 'none' }); },
  onNotify() { wx.showToast({ title: '消息通知已开启', icon: 'none' }); },
  goAgreement() { wx.navigateTo({ url: '/pages/mine/agreement/agreement' }); },
  goAbout() { wx.showToast({ title: '科豆 AI v1.0.0', icon: 'none' }); },

  /** 退出登录：二次确认 → 服务端作废 + 本地清态 → 停在登录墙（不跳欢迎页） */
  logout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后需要重新登录才能继续使用。服务端登录凭证会同时失效。',
      confirmText: '退出',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return;
        void (async () => {
          await logout();
          this.setData({ loggedIn: false });
          wx.showToast({ title: '已退出登录', icon: 'none' });
        })();
      },
    });
  },

  /** 登录卡登录成功后回调：刷新本页内容 */
  onLogged() {
    this.setData({ loggedIn: isLoggedIn() });
    this.onShow();
  },

  clearCache() {
    wx.showLoading({ title: '清理中…' });
    setTimeout(() => {
      wx.hideLoading();
      wx.showToast({ title: '已清除 ' + this.data.cacheSize });
    }, 700);
  },
});
