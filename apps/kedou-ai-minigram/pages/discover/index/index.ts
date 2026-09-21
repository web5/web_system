/**
 * 科豆 AI · 发现页（tab 2）—— 能力市场
 *
 * 骨架期：两张能力卡写死在 wxml，navigateTo 到既有专属页。
 * 批次 4：改为 `GET /ai/agents` 数据驱动 ——
 *   ui='custom' → navigateTo(entry.route)
 *   ui='chat'   → navigateTo('/pages/chat/index/index?agentId=…&title=…')
 * 届时本页 onShow 拉清单渲染即可，跳转逻辑见下方 openCustom。
 */
Page({
  /** 登记当前 tab（自定义 tabBar 据此渲染并高亮；对话页则隐藏） */
  onShow() {
    const tabBar = (this as any).getTabBar?.();
    if (tabBar) tabBar.setData({ currentPage: '/pages/discover/index/index', selected: 1 });
  },

  /** 语言翻译官（专属 UI，已存在） */
  openTranslate() {
    wx.navigateTo({ url: '/packageTranslate/pages/translate/index/index' });
  },

  /** 合同评估（专属 UI，已存在） */
  openAssess() {
    wx.navigateTo({ url: '/packageAssess/pages/assess/index/index' });
  },

  /** 即将上线的能力 */
  onSoon(e: any) {
    const name = String(e.currentTarget.dataset.name || '该能力');
    wx.showToast({ title: `${name} · 敬请期待`, icon: 'none' });
  },
});
