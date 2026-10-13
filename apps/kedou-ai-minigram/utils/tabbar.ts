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
