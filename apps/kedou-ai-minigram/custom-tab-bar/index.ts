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
 * ============================ 高亮的两级机制 ============================
 * 一级（权威）：页面在 onShow 里显式登记 —— 见 utils/tabbar.ts 的 setTabBarSelected。
 *   自定义 tabBar 组件**在每个页面是独立实例**（不是全局单例），新页面的 selected
 *   会回到初始值，且 attached/show 与页面入栈的时序不保证 —— 纯自推导会在首次
 *   进入某页时读到旧栈顶，表现为「页面切过去了、高亮还停在上一项」（10-13 实测）。
 *   登记后写 _registered=true，组件不再覆盖。
 * 二级（兜底）：页面未登记时（设置/翻译/对话记录等二级页），syncFromRoute 从页面栈
 *   回溯推导归属（settings→「我的」、history→「对话」）。
 * ======================================================================
 *
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
    /** 页面是否已显式登记高亮；true 后组件的自推导不再覆盖（见文件头「两级机制」） */
    _registered: false,
  },

  lifetimes: {
    attached() {
      if (!this.data._registered) this.syncFromRoute();
    },
  },

  pageLifetimes: {
    show() {
      if (!this.data._registered) this.syncFromRoute();
    },
  },

  methods: {
    /**
     * 兜底推导：从栈顶往前找第一个匹配 list 的页面。
     * 二级页（设置/翻译/对话记录）不匹配任何项时归属栈中最近的 tab 相关页，
     * 避免右滑返回二级页时高亮漂移。已登记（_registered）时不执行。
     */
    syncFromRoute() {
      const pages = getCurrentPages() as Array<{ route: string }>;
      for (let i = pages.length - 1; i >= 0; i--) {
        const route = '/' + pages[i].route;
        const idx = this.data.list.findIndex((it) => it.pagePath === route);
        if (idx >= 0) {
          this.setData({ selected: idx });
          return;
        }
      }
    },

    onSwitch(e: any) {
      const { path, index, istab } = e.currentTarget.dataset;
      if (!path) return;
      const idx = Number(index);
      // ⚠️ data- 属性经 dataset 后一律是字符串：直接 if(istab) 会让 'false' 也 truthy
      // （10-13 实测：点「对话」误走 switchTab，而 chat 不在 tabBar.list → 失败不跳转，
      // 但 selected 已置 0 → 高亮与当前页错位）。统一数值化后比较。
      const isTab = Number(istab) === 1;
      // 对话页已在栈顶时避免重复 push（navigateTo 同路由会新建实例，栈越点越厚）
      if (!isTab) {
        const pages = getCurrentPages() as Array<{ route: string }>;
        const top = pages.length ? '/' + pages[pages.length - 1].route : '';
        if (top === path) return;
      }
      // 乐观高亮：切页前先亮，目标页 onShow 会再登记一次（幂等、值一致）
      this.setData({ selected: idx });
      // tab 页（发现/我的）switchTab 切换；对话页是普通页，navigateTo 进入（右滑可退回来源页）
      if (isTab) {
        wx.switchTab({ url: path });
      } else {
        wx.navigateTo({ url: path });
      }
    },
  },
});
