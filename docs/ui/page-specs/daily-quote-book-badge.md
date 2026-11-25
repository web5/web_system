# 页面规格书 · 首页「今日一句」册别角标（方案①）

> Spec: pass
> 关联方案: `docs/development/reports/2026-11-25-nce3-nce4-quotes-expansion-方案.md`
> 原型继承: `Proto: d3c3730281e758d8` / `Design: pass`（引用 164 原型方案①，不新造、不搬演示控件到工程）
> 需求真源: 164 稿 §五方案①（句上方浅青 pill「新概念二册 · L44」）

- 页面类型：首页 tab1「今日一句」卡片内的来源角标（纯展示，无交互）
- 改动页：`apps/dachengzi-minigram/pages/home/index/index.{wxml,wxss,ts}`
- 需求一句话：句子在三册间轮换后，用低饱和册别 pill 让用户一眼知道来源册别与课号，不抢主句视觉。

## 模块清单（今日一句卡片）

| 序 | 模块 | 数据来源 | 承载节点 | 空态策略 | 备注 |
|---|---|---|---|---|---|
| 1 | 标题行 | 静态文案 + 角标 | `.daily-top`（flex，space-between） | — | 本轮唯一结构增量：把原 `.daily-k` 包入 flex 行 |
| 2 | 标题 | 静态 | `.daily-k`「今日一句」 | — | 字号 22rpx / `--brand-txt`，保持不变 |
| 3 | 册别 pill | `bookBadge`（`getDailyQuoteMeta`+`BOOK_LABEL`） | `.badge-pill` | `book` 缺失 → `bookBadge=''` → `wx:if` 隐藏，不显 undefined | 浅底 `--accent-soft` / 深青字 `--accent-ink`（AA 4.92:1）/ 20rpx / 圆角 `--r-pill` |
| 4 | 中文句 | `quote.cn` | `.daily-cn` | — | 主句第一焦点，结构/字号不变 |
| 5 | 英文句 | `quote.en` | `.daily-en` | — | 主句，结构/字号不变 |

## 角标状态矩阵

| 状态 | book | lessonId | 角标表现 | 判据 |
|---|---|---|---|---|
| 常规 NCE2 | NCE2 | 44 | `新概念二册 · L44` | TC-B1 |
| 常规 NCE3 | NCE3 | 37 | `新概念三册 · L37` | TC-B1 |
| 常规 NCE4 | NCE4 | 12 | `新概念四册 · L12` | TC-B1 |
| 旧缓存 | 缺失 | 缺失 | 隐藏 pill（wx:if false） | TC-B2 |
| 课号缺省 | 有 | 缺失 | 只显册名，不编造课号 | TC-B3 |
| 兜底 | NCE2（常量） | 真实 lessonId | `新概念二册 · L{n}` | TC-B4 |
| 极长/极短句 | 任意 | 任意 | pill 固定标题行，正文自适应不挤行 | TC-B5 / 原型 Design: pass |
| 开关关 | — | — | `showBookBadge=false` 隐藏全部角标 | TC-B7 |

## 视觉与可访问性

- 浅色白底卡片，角标浅青底 `--accent-soft:#E4F6F2` + 深青字 `--accent-ink:#0F766E`（4.92:1 ≥ WCAG AA 4.5:1），与真机蓝色系 `--brand` 兼容。
- 字重不加重、字号 20rpx（10px）低于主句（30rpx/23rpx），视觉权重低于主句。
- 无深色背景、无 emoji 图标、无裸 hex（字色走 token）、无 `!important`。
- 原型机检 + 人工质检 A–J 全过（`Design: pass`），本页只落地结构/样式，不搬演示控件。

## 数据契约

- 服务端接口信封不变；`source.book`/`source.lessonId` 本就在 items 内。
- 小程序缓存 `daily_quotes_pool.items` 由 `{cn,en}[]` 扩为 `{cn,en,book,lessonId}[]`（title/lineIndex 不进缓存）。
- `getDailyQuote(): {cn,en}` 签名不变；角标走 `getDailyQuoteMeta(): {book,lessonId}` 另开 getter，同源同天同条。
- 册名中文映射 `BOOK_LABEL` 留前端常量；缺省只显册名、不编造课号；旧缓存无 book 降级隐藏。

## 门禁

- 改 `index.wxml` → R11：commit 挂 `Proto: d3c3730281e758d8` + `Design: pass`（直接引用 164 原型凭证）。
- 本规格 `Spec: pass`；测试文档 `Test: pass`（`docs/development/reports/测试用例-NCE3NCE4扩展-2026-11-25.md`）。
