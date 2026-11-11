# tabbar getTabBar() 崩溃穿透 onShow 修复方案（2026-11-11）

## 一、根因

`pages/mine/index/index.ts:119` onShow **第一句**调 `setTabBarSelected(this, TAB_INDEX.mine)`，
其内部 `utils/tabbar.ts:35` 执行 `const bar = getTabBar()`——**无任何 try/catch**。

微信自定义 tabBar 场景下，`this.getTabBar()` 在组件尚未实例化的时序窗口会内部抛
`TypeError: Cannot read properties of undefined (reading '__treeManager__')`
（2026-11-11 21:09 / 21:48 devtools Console 两次实测）。异常向上穿透 → **onShow 整体中断**
→ 同函数第 141 行的 `fetchProfile()` 永远不执行 → 「我的」页 avatar/nickname 全空
（「橙」占位 + 「点击设置昵称」），Network 无 verify 请求。home/discover 页同款调用点
（home:162 / discover:28）暴露同一风险。

该调用为基线代码（b1a46439 引入），非 11-11 tab 修复的回归；9baa2f36 仅在其后追加
globalData 同步，未触及该调用。

## 二、方案

`utils/tabbar.ts` 的 `setTabBarSelected` 内：

1. `getTabBar()` 改为 `getTabBar.call(page)` —— 保留 this 绑定（原写法为脱离实例调用，
   严格模式下 this=undefined，正是 `__treeManager__` 读取崩溃的直接机制）；
2. 调用整体包 try/catch —— 组件未实例化时序窗口静默跳过，**绝不允许中断 onShow**。

不改接口、不改调用方、不改 tabBar 组件本体；高亮语义不变（拿不到实例 = 本帧不登记，
下一帧 onShow 重试）。

## 三、微调豁免

微调豁免：bug 止血修复，非新功能，不改视觉 UI。
