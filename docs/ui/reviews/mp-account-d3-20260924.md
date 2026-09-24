# 设计评审（D3）· 小程序账号：登录墙 / 绑定手机号 / 绑定邮箱 实现一致性

> 阻塞: 0
> 重要: 0
> 关口：D3（落码后、提交前，比对已确认原型与规格）　目标端：微信小程序（品牌端）
> 被审物：`apps/kedou-ai-minigram`（M1 退出登录 + M3a 绑定手机号 + R3 绑定邮箱 + M4 协议页）
> 基准：`apps/kedou-ai-minigram/prototype/index.html`（已确认原型，锚点 gate / phone-row / email-row / logout-entry / modal / bind-email / agreement）、`specs/kedou-ai-minigram/{page-spec,requirements}-mp-account.md`
> 方式：独立 sub-agent 盲审（先读基准，再看实现）

## 结论

✅ **通过**（初评阻塞 2 项、重要 7 项，已全部修复并复验）

## 阻塞项与处置

| # | 反例 | 判据 | 处置 |
|---|---|---|---|
| B1 | 手机号「已绑定」态无更换二次确认，入口也未表达「更换」 | page-spec §5 已绑定行；§2 phone-row 三态；requirements R2 判据 | ✅ 已修：`onGetPhone` 中已绑定先弹「更换手机号」确认（写明当前号码将被替换），确认后才用该 code 绑定 —— 与同页「更换邮箱」同口径 |
| B2 | 对话页 WXML 标签交叉闭合：输入栏与「+」菜单被关到 `.wrap` 之外，`<block>` 与 `.wrap` 交叉 | page-spec §3「铺满 `.page`、不销毁下层内容」；R1 判据第 6 条 | ✅ 已修：以「底部吸底输入栏」注释为锚点定位 `.wrap` 闭合，在其前插入 `</block>`；输入栏与 sheet 保持在 wrap 外（与改动前一致）；校验 block 开/闭配平 |

## 重要项与处置

| # | 问题 | 判据 | 处置 |
|---|---|---|---|
| M1 | 三处登录卡缺真机语义小字 | 原型 `.g-note`；page-spec §3 | ✅ 已修：补「真机：wx.login 静默登录，无授权弹窗、无验证码」 |
| M2 | 协议链接不可点（死链），协议页未落地 | 原型 `data-dr="agreement"`；page-spec §3/§8 | ✅ 已修：新建 `pages/mine/agreement` 三段式协议页（含「不绑定不影响任何功能使用」「合并不可撤销」），三处登录卡传 `agreement-url`，我的页入口改为跳转 |
| M3 | 合并确认兜底文案未列数据项、toast 缺「凭证已重签」 | 原型合并弹窗；page-spec §6 | ✅ 已修：兜底文案改为「会把当前小程序的对话、生词本与口味记忆合并到该账号，合并不可撤销」；toast 统一「已合并到该账号（凭证已重签）」 |
| M4 | 主按钮文字色是裸 hex（`#fff`） | page-spec §9/§10-E | ✅ 已修：`app.wxss` 新增 `--on-brand`，登录卡与邮箱页按钮改用它 |
| M5 | 用了小程序端不存在的 `--text-body` | page-spec §9 | ✅ 已修：改 `--t2` |
| M6 | 三条非 `request.ts` 通道只判 `isLoggedOut()`，漏「无 token」 | R1 判据第 5/6 条 | ✅ 已修：统一 `!getToken() \|\| isLoggedOut()` |
| M7 | 二级页无登录守卫 | page-spec §3 | ✅ 已修：个人信息 / 绑定邮箱 / 小程序设置 三个二级页 `onShow`/`onLoad` 加守卫，未登录提示并返回 |

## 建议项处置

- 采纳：邮箱行补 `email-row` 锚点 class（与 phone-row 对称）；`bind-email` 的 `setInterval` 在 `onUnload` 清理。
- 登记豁免（不采纳）：登录卡图标用「豆」字符（小程序 wxml 不支持内联 SVG，与我的页头像一致）；`z-index` 取 100 以压住自定义导航栏（页面级差异，非漂移）。
- 未采纳（无判据，属个人偏好）：清理更多本地缓存键、清理剩余展示用假数据（昵称/UID/cacheSize）—— 属存量范围，另立批次。

## 通过项（复验）

- 退出确认文案与按钮与规格逐字一致；退出后停「我的」不跳欢迎页；服务端失败不阻塞本地清态。
- 自动重登被拦（request 与 ensureLogin 双重）；401 在主动退出态只提示「请先登录」。
- 三处登录卡标题一致、`.locked` 锁滚动齐全；无 `138****6688` 硬编码（脱敏值由服务端下发）。
- 合并后 `setToken` 再刷新；冲突必二次确认；`busy` 锁在 `finally` 释放，无解不开的锁。
- 邮箱为自绘二级页（非 `wx.showModal`），60s 倒计时、6 位码校验、更换写明旧号被替换。

## 遗留（不阻塞）

1. 合并后凭证重签在 UI 上无可见差异（真机亦不可见），仅 toast 说明。
2. 协议页生效日期为占位，待运营/法务回填。
3. 展示层仍有存量假数据（昵称 / UID / 加入时间 / 缓存大小），不在本批处理。
