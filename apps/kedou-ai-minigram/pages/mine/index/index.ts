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

Page({
  data: {
    nickname: '橙子哥哥',
    realName: '已实名',
    phone: '138****6688',
    /** 各应用 / 主对话的历史条数（空则不展示数字，避免假数据） */
    trCount: '',
    asCount: '',
    chatCount: '',
    cacheSize: '24.6MB',
    /** 音乐口味摘要（前 3 个标签；无则「未设置」） */
    tasteSummary: '未设置',
  },

  /** 登记当前 tab（自定义 tabBar 据此渲染并高亮；对话页则隐藏） */
  onShow() {
    const tabBar = (this as any).getTabBar?.();
    if (tabBar) tabBar.setData({ currentPage: '/pages/mine/index/index', selected: 2 });
    // 口味摘要：轻量读一次，失败保持「未设置」不打扰
    void getMusicTaste().then((t) => {
      this.setData({ tasteSummary: tasteSummary(t) });
    });
  },

  goTaste() {
    wx.navigateTo({ url: '/pages/mine/taste/index' });
  },

  goProfile() { wx.navigateTo({ url: '/pages/mine/profile/profile' }); },
  goAppSettings() { wx.navigateTo({ url: '/pages/mine/settings/settings' }); },
  goTrSettings() { wx.navigateTo({ url: '/pages/translate/settings/settings' }); },
  goAsSettings() { wx.navigateTo({ url: '/pages/assess/settings/settings' }); },
  goHistory() { wx.navigateTo({ url: '/pages/translate/history/history' }); },

  goVip() { wx.showToast({ title: '会员功能开发中', icon: 'none' }); },
  goContracts() { wx.showToast({ title: '我的合同开发中', icon: 'none' }); },
  goChats() { wx.showToast({ title: '对话记录开发中', icon: 'none' }); },
  onNotify() { wx.showToast({ title: '消息通知已开启', icon: 'none' }); },
  goAgreement() { wx.showToast({ title: '协议页开发中', icon: 'none' }); },
  goAbout() { wx.showToast({ title: '科豆 AI v1.0.0', icon: 'none' }); },
  logout() { wx.showToast({ title: '退出登录开发中', icon: 'none' }); },

  clearCache() {
    wx.showLoading({ title: '清理中…' });
    setTimeout(() => {
      wx.hideLoading();
      wx.showToast({ title: '已清除 ' + this.data.cacheSize });
    }, 700);
  },
});
