/**
 * tabBar 高亮登记（微信官方范式）
 *
 * 为什么不让 custom-tab-bar 自己推导高亮：
 * 自定义 tabBar 组件**在每个页面是独立实例**（非全局单例），页面切换时新实例的
 * data.selected 会回到初始值；而组件 attached / pageLifetimes.show 的触发时机与
 * 页面入栈顺序并非严格可控，靠 getCurrentPages() 自推导会在「首次进入某页」时
 * 读到旧栈顶 —— 表现为「页面切过去了，高亮还停在上一项」（2026-10-13 实测）。
 *
 * 官方做法：每个展示 tabBar 的页面在自己的 onShow 里显式登记 selected。
 * 这里统一封装，避免各页重复写 getTabBar 判空。
 *
 * 兜底：页面未登记时（二级页如设置/翻译/对话记录），由 custom-tab-bar 的
 * syncFromRoute 从页面栈回溯推导归属，见 custom-tab-bar/index.ts。
 */

/** 与 custom-tab-bar/index.ts 中 list 的顺序严格一致；改序必须同步改这里 */
export const TAB_INDEX = {
  chat: 0,
  discover: 1,
  mine: 2,
} as const;

/**
 * 在页面 onShow 中调用，登记本页对应的 tabBar 高亮项。
 * 非 tabBar 页面（如对话页）同样适用 —— 只要该页展示了 tabBar。
 * 拿不到 tabBar 实例时静默跳过（如 navigationStyle:custom 的沉浸页）。
 */
export function setTabBarSelected(page: any, idx: number) {
  if (typeof page?.getTabBar !== 'function') return;
  const bar = page.getTabBar();
  if (!bar) return;
  bar.setData({ selected: idx, _registered: true });
}

export const CHAT_PATH = '/pages/chat/index/index';
export const WELCOME_PATH = '/pages/welcome/index/index';

/**
 * 进入对话页（**所有入口统一走这里**）
 *
 * 产品约定：对话页的返回（右滑手势 / 返回按钮）**始终回到欢迎页**，
 * 其余页面照常走历史返回。右滑本质是 wx.navigateBack，所以只要保证
 * 对话页下面那页是欢迎页即可，无需拦截手势。
 *
 * 按当前页面栈选择代价最小的跳转方式（避免无谓的 reLaunch 闪屏）：
 *   ① 栈顶已是对话页        → 不动（防重复入栈）
 *   ② 当前页就是欢迎页      → navigateTo（栈天然是 [welcome, chat]）
 *   ③ 对话页在栈中非栈顶    → navigateBack 回到它
 *   ④ 欢迎页恰在栈倒数第二  → redirectTo 把当前页换成对话页
 *   ⑤ 其余（欢迎页已被 switchTab 清掉 / 深栈二级页）→ reLaunch 重建 [welcome, chat]
 *
 * @param query 透传给对话页的 query 串，如 'agentId=xxx&title=yyy'（可不带 ?）
 */
export function openChat(query = '') {
  const suffix = query ? (query.charAt(0) === '?' ? query : '?' + query) : '';
  const url = CHAT_PATH + suffix;
  const pages = getCurrentPages() as Array<{ route: string }>;
  const routes = pages.map((p) => '/' + p.route);
  const last = routes.length ? routes[routes.length - 1] : '';

  // ① 已在对话页：不重复入栈
  if (last === CHAT_PATH) return;

  // ② 当前页就是欢迎页：直接进
  if (last === WELCOME_PATH) {
    wx.navigateTo({ url });
    return;
  }

  // ③ 对话页在栈中但不在栈顶：回退到它（其下即欢迎页，返回链正确）
  const chatIdx = routes.indexOf(CHAT_PATH);
  if (chatIdx >= 0) {
    wx.navigateBack({ delta: routes.length - 1 - chatIdx });
    return;
  }

  // ④ 欢迎页恰在栈倒数第二位：把当前页替换成对话页 → [.., welcome, chat]
  const wIdx = routes.indexOf(WELCOME_PATH);
  if (wIdx >= 0 && wIdx === routes.length - 2) {
    wx.redirectTo({ url });
    return;
  }

  // ⑤ 其余：清栈重建（welcome 收到 ?to=chat 后自动进对话，见 welcome 页 onLoad）
  wx.reLaunch({ url: WELCOME_PATH + '?to=chat&q=' + encodeURIComponent(query) });
}
