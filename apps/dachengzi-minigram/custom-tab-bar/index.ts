/**
 * 自定义 tabBar（app.json 的 tabBar.custom = true 后由本组件渲染）
 *
 * 为什么不用 wx.hideTabBar()：它在 tabBar 页面只是「隐藏」，页面可视区不变 →
 * 底部会留一条空白，吸底输入栏会悬空。改用自定义 tabBar 才是真正的全屏。
 *
 * 2026-11-09：三 tab 改为 首页/发现/我的，全部 isTab=true 走 switchTab；对话页已不在
 * tabBar 集合（app.json tabBar.list 三项：home / discover / mine）。
 * 对话页仍是普通页（welcome/发现/我的均 navigateTo 进入），右滑退回来源页 ——
 * 这条约定没变：tab 页右滑会退出小程序，故对话页不能进 tabBar。
 *
 * ============================ 高亮的两级机制 ============================
 * 一级（权威）：页面在 onShow 里显式登记 —— 见 utils/tabbar.ts 的 setTabBarSelected。
 *   自定义 tabBar 组件**在每个页面是独立实例**（不是全局单例），新页面的 selected
 *   会回到初始值，且 attached/show 与页面入栈的时序不保证 —— 纯自推导会在首次
 *   进入某页时读到旧栈顶，表现为「页面切过去了、高亮还停在上一项」（10-13 实测）。
 *   登记后写 _registered=true，组件不再覆盖。
 * 一级半（跨实例缓存）：setTabBarSelected / onSwitch 把当前 tab 同步到
 *   globalData.tabIndex，新实例在 attached / pageLifetimes.show 时先读它立即恢复，
 *   消除「等 onShow 登记」之间的半拍（详见 restoreFromGlobalData）。
 * 二级（兜底）：页面未登记时（设置/翻译/对话记录等二级页），syncFromRoute 从页面栈
 *   回溯推导归属（settings→「我的」；其余二级页归属栈中最近的 tab 页）。
 * ======================================================================
 *
 * key 用于映射图标样式类（.tb-ic-<key>），见 index.wxss。
 */

Component({
  data: {
    list: [
      { key: 'home', pagePath: '/pages/home/index/index', text: '首页', isTab: true },
      { key: 'discover', pagePath: '/pages/discover/index/index', text: '发现', isTab: true },
      { key: 'mine', pagePath: '/pages/mine/index/index', text: '我的', isTab: true },
    ],
    selected: 0,
    /** 页面是否已显式登记高亮；true 后组件的自推导不再覆盖（见文件头「两级机制」） */
    _registered: false,
  },

  lifetimes: {
    attached() {
      // 立即高亮：切 tab 后本组件是**新页面里的独立实例**，selected 会回到初始值 0，
      // 若只等 onShow 登记，会出现「页面切过去了、高亮还停在上一项」的半拍闪跳。
      // 先读 globalData 缓存的当前 tab（onSwitch / setTabBarSelected 都会写），
      // 命中即立即恢复；读不到（首启未登记）再走 syncFromRoute 兜底。
      if (!this.restoreFromGlobalData() && !this.data._registered) this.syncFromRoute();
    },
  },

  pageLifetimes: {
    show() {
      // 已登记（_registered）：onShow 已显式指定过高亮，不再覆盖。
      // 未登记时同样优先读 globalData：官方「页面创建生命周期」里 pageLifetimes.show
      // 在 Page.onShow **之前**触发，此刻 getCurrentPages() 仍可能是旧栈顶，直接
      // syncFromRoute 会把正确高亮覆盖回旧值 —— 先 restoreFromGlobalData 命中即停。
      if (this.data._registered) return;
      if (!this.restoreFromGlobalData()) this.syncFromRoute();
    },
  },

  methods: {
    /**
     * 从 globalData.tabIndex 恢复高亮（跨实例共享的权威值，onSwitch / setTabBarSelected 都写）。
     * 命中返回 true；getApp 不可用 / tabIndex 未登记返回 false，交由 syncFromRoute 兜底。
     * 用「命中即跳过 syncFromRoute」的理由：syncFromRoute 靠 getCurrentPages() 自推导，
     * 而 attached / pageLifetimes.show 时页面栈顶可能仍是旧页（10-13 实测「首次进入某页
     * 读到旧栈顶」），若命中后仍走 syncFromRoute 会把刚恢复的正确高亮覆盖回旧值。
     */
    restoreFromGlobalData(): boolean {
      try {
        const app = getApp<IAppOption>();
        if (app && typeof app.globalData.tabIndex === 'number') {
          this.setData({ selected: app.globalData.tabIndex });
          return true;
        }
      } catch {
        // getApp 不可用（极早期）：交给 syncFromRoute
      }
      return false;
    },

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

    onSwitch(e: WechatMiniprogram.TouchEvent) {
      const { path, index, istab } = e.currentTarget.dataset;
      if (!path) return;
      const idx = Number(index);
      // ⚠️ data- 属性经 dataset 后一律是字符串：直接 if(istab) 会让 'false' 也 truthy
      // （10-13 实测：点「对话」误走 switchTab，而 chat 不在 tabBar.list → 失败不跳转，
      // 但 selected 已置 0 → 高亮与当前页错位）。统一数值化后比较。
      const isTab = Number(istab) === 1;
      // 乐观高亮：切页前先亮（当前实例），并把 idx 写入 globalData，供目标页新实例
      // attached 时立即读回（消除 onShow 登记前的半拍）。目标页 onShow 会再登记一次
      // （幂等、值一致）。
      this.setData({ selected: idx });
      try {
        getApp<IAppOption>().globalData.tabIndex = idx;
      } catch {
        // getApp 不可用：仅乐观高亮，onShow 仍会兜底登记
      }
      if (isTab) wx.switchTab({ url: path });
    },
  },
});
