# 设计评审（D2）· 小程序账号：登录引导卡 / 退出 / 绑定手机号 / 合并

> 阻塞: 0
> 重要: 0
> 关口：D2（原型 / 规格评审，交用户确认之前）　目标端：微信小程序（品牌端）
> 被审物：`apps/kedou-ai-minigram/prototype/index.html`（gate-chat/gate-discover/gate-mine、wxModal、p-agreement、我的页、个人信息页、设置页 + ACCOUNT 逻辑块）
> 判据源：`docs/ui/design-system.md`、`@brand-interface`、`references/design-review-checklist.md`、`specs/kedou-ai-minigram/{requirements,page-spec}-mp-account.md`
> 评审方式：独立 sub-agent 盲审（先读判据源形成应然清单，再看被审物）

## 结论

✅ **通过**（初评阻塞 3 项已全部修复并复验：见下表「处置」列；重要 4 项已修 4 项，遗留 0）

## 初评阻塞项与处置

| # | 反例（情形 → 实际 vs 期望） | 判据 | 处置 |
|---|---|---|---|
| B1 | 未登录态下导航栏「新建对话 / 对话记录」仍可点，可进 `p-history` 看历史会话；期望拦截全部功能入口 | requirements §2 R1 判据 6/8；Q1；checklist K；X1 | ✅ 已修：`applyAccountState()` 未登录时移除 `has-act`/`has-hist`；新增 `syncNavForAccount()` 并在 `enterTab()` 末尾调用；`navigateTo()` 加登录墙守卫（未登录只允许 `p-agreement`） |
| B2 | `.gate` 随 `.page` 滚动（absolute + overflow-y:auto），我的页可滚出登录墙、露出内容与「退出登录」入口；期望整页不可绕过 | requirements §2 判据 4/6/8；page-spec §2/§3；P3；checklist K | ✅ 已修：新增 `.page.locked{overflow:hidden}`，未登录时给三个 tab 页加锁；page-spec §3 同步补「并锁定滚动」 |
| B3 | 合并确认弹窗点遮罩关闭 → 只 `hideModal()` 不触发 `onCancel` → `ACCOUNT.busy` 永久为 true → 手机号行点了没反应、无恢复入口 | P3；S8；S4/X2；checklist C/D | ✅ 已修：真机 `wx.showModal` 蒙层不可关闭 → 原型同口径（遮罩点击不再关闭），取消只能走「取消」按钮，`onCancel` 必执行 |

## 初评重要项与处置

| # | 问题 | 判据 | 处置 |
|---|---|---|---|
| I1 | 三处登录卡标题不一致（我的页「登录后查看我的」）；真机语义小字只在对话页 | P2；I5；page-spec §3 | ✅ 已修：标题统一为「登录后继续使用」，三处均补真机语义小字 |
| I2 | 额度不足文案与 page-spec §5 不一致，且 toast 无「怎么办」 | page-spec §5；H4；S4/X2 | ✅ 已修：改为「服务暂不可用，请稍后再试」 |
| I3 | 登录卡合规小字 `--t3` 在 `--page-bg` 上约 1.8:1，协议告知不可读 | G3；G4 | ✅ 已修：`g-note`/`g-link` 改 `--t2`（≈4.6:1），链接加下划线 + 500 字重保持可点识别 |
| I4 | 「更换手机号」二次确认未写明后果（旧号被覆盖） | S6；requirements §3 | ✅ 已修：文案补「当前号码 138****6688 **将被新号码替换**」 |

## 建议项处置（部分采纳）

- 采纳：`wxModal` 加 150ms 淡入缩放（`--duration-fast` + `--ease-out`）；授权弹窗小字补「真机『拒绝』= 静默返回，不提示」；`demoBindFail` 文案改为「请稍后重试；其他功能不受影响」；`p-agreement` / `wxModal` 补 `data-dr` 锚点（`agreement` / `modal`）。
- 不采纳（登记豁免）：`.wxmodal` 内间距与按钮高度复刻微信原生 `wx.showModal` 固定形态，豁免 8 倍数；登录卡 icon 26/1.7 与原型存量口径一致，登记例外。
- 未采纳（无判据，属个人偏好）：登录卡换品牌标识、设置页退出入口标红 —— 交产品裁决。

## 通过项（复验）

- 锚点齐备且与 page-spec §2 一致：`gate`（三处）、`phone-row`、`logout-entry`（两处），新增 `modal` / `agreement`。
- 无裸 hex；新增 `--on-brand` 定义在 `:root`（浅 `#FFFFFF` / 深 `#1A1005`）。
- 破坏性操作二次确认齐全且写明后果：退出（凭证失效）、合并（数据合并 + 不可撤销）、更换手机号（旧号被替换）。
- 合规：协议页明确「不绑定不影响任何功能使用」；手机号只展示脱敏号；注销标注「开发中」；文案待运营/法务确认已标注。
- 目标端：小程序壳（胶囊 + TabBar）；`wx.login` / `getPhoneNumber` / `wx.showModal` 均标注真机语义，未伪装已实现。

## 遗留（不阻塞）

1. 合并后凭证重签在原型仅以 toast 说明，页面无可见差异（真机亦不可见）。
2. 未登录态下层 DOM 未销毁（仅覆盖 + 锁滚动），D3 比对时按「跳过」处理。
3. 协议页生效日期为占位，待运营/法务回填。
