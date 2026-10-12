/**
 * 自定义 tabBar（app.json 的 tabBar.custom = true 后由本组件渲染）
 *
 * 为什么不用 wx.hideTabBar()：它在 tabBar 页面只是「隐藏」，页面可视区不变 →
 * 底部会留一条空白，吸底输入栏会悬空。改用自定义 tabBar 才是真正的全屏。
 *
 * 2026-10-12 结构变更：对话页退出 tabBar 集合（app.json tabBar.list 只剩发现/我的）。
 * 原因：对话页是 tab 页时，欢迎页 switchTab 进入会清掉页面栈，对话页右滑无处可退 →
 * 微信直接退出小程序。改为普通页后 welcome/发现/我的均 navigateTo 进入，右滑退回来源页。
 * 代价：对话项（isTab=false）点击走 navigateTo 而非 switchTab。
 *
 * 高亮推导：组件挂在哪些页面就由哪些页面的 show 触发 —— attached + pageLifetimes.show
 * 时读 getCurrentPages() 最后一条路由，匹配 list 项则高亮；沉浸页（对话/历史）不匹配
 * 任何项时保持上次高亮，避免闪空。各页面不再需要 onShow 手工登记。
 * key 用于映射图标样式类（.tb-ic-<key>），见 index.wxss。
 */
Component({
  data: {
    list: [
      { key: 'chat', pagePath: '/pages/chat/index/index', text: '对话', isTab: false },
      { key: 'discover', pagePath: '/pages/discover/index/index', text: '发现', isTab: true },
      { key: 'mine', pagePath: '/pages/mine/index/index', text: '我的', isTab: true },
    ],
    selected: 0,
  },

  lifetimes: {
    attached() {
      this.syncFromRoute();
    },
  },

  pageLifetimes: {
    show() {
      this.syncFromRoute();
    },
  },

  methods: {
    /** 由当前页面路由推导高亮项；沉浸页（对话/记录等）不匹配时保持上次，不闪空 */
    syncFromRoute() {
      const pages = getCurrentPages() as Array<{ route: string }>;
      const route = pages.length ? '/' + pages[pages.length - 1].route : '';
      const idx = this.data.list.findIndex((it) => it.pagePath === route);
      if (idx >= 0) this.setData({ selected: idx });
    },

    onSwitch(e: any) {
      const { path, index, istab } = e.currentTarget.dataset;
      if (!path) return;
      this.setData({ selected: Number(index) });
      // tab 页（发现/我的）switchTab 切换；对话页是普通页，navigateTo 进入（右滑可退回来源页）
      if (istab) {
        wx.switchTab({ url: path });
      } else {
        wx.navigateTo({ url: path });
      }
    },
  },
});
