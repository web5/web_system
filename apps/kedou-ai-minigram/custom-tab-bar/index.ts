/**
 * 自定义 tabBar（app.json 的 tabBar.custom = true 后由本组件渲染）
 *
 * 为什么不用 wx.hideTabBar()：它在 tabBar 页面只是「隐藏」，页面可视区不变 →
 * 底部会留一条空白，吸底输入栏会悬空。改用自定义 tabBar 才是真正的全屏。
 *
 * 约定：每个 tab 页面在 onShow 里把自己登记进来（setData currentPage/selected），
 * 由本组件决定是否渲染（对话页 = 沉浸式，不渲染）。
 * key 用于映射图标样式类（.tb-ic-<key>），见 index.wxss。
 */
Component({
  data: {
    list: [
      { key: 'chat', pagePath: '/pages/chat/index/index', text: '对话' },
      { key: 'discover', pagePath: '/pages/discover/index/index', text: '发现' },
      { key: 'mine', pagePath: '/pages/mine/index/index', text: '我的' },
    ],
    selected: 0,
    /** 当前 tab 页路径（由页面 onShow 写入） */
    currentPage: '',
    /** 对话页不渲染 tabBar */
    hidden: false,
  },

  methods: {
    onSwitch(e: any) {
      const { path, index } = e.currentTarget.dataset;
      if (!path) return;
      this.setData({ selected: Number(index) });
      wx.switchTab({ url: path });
    },
  },

  observers: {
    'currentPage,list': function (currentPage: string, list: Array<{ pagePath: string }>) {
      // 对话页（list 第 0 项）隐藏 tabBar
      this.setData({ hidden: !!currentPage && currentPage === (list && list[0] && list[0].pagePath) });
    },
  },
});
