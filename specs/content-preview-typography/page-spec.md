# 页面规格书 · 成文预览抽屉（公众号版面）

> 版本：v1.0 ｜ 2026-10-23 ｜ 关联 issue #436
> 原型稿：`specs/content-preview-typography/prototype.html`
> 设计决策与验收：`docs/ui/reviews/content-preview-typography-20261023.md`
> 适用端：admin（`--ws-brand-500` 主橙 / `@web-system/ui` 语义 token）
> 实现：`apps/admin/src/views/Content/ContentPublications.vue`

---

## 0. 定位

公众号成文记录点「预览」打开的抽屉。**目标是「所见即读者所见」**，不是把库里的 HTML 直接倒进后台。
只做显示，不改产物；发到公众号的仍是 `payload.html`。

## 1. 结构

```
a-drawer (width 820)
├── 抽屉标题 = 记录标题
├── .preview-meta      sticky：目标标签 / 状态标签 / 发布时间 / 聚合说明
└── .preview-body      padding 0 24px 40px
    ├── .preview-aside 680 居中：失败告警（有则显）+「重建成文」工具栏（stored 才显）
    └── .preview-paper 680 居中：纸张卡片
        └── .preview-html  正文（v-html，渲染层已链接化 #433）
            └── 空正文 → a-empty「该记录未留存成文内容，请重跑对应管线」
```

## 2. 排版规格

| 元素 | 字号 / 字重 | 颜色 | 标识 | 间距 |
|---|---|---|---|---|
| 文章主标题（首个 h1/h2） | 24 / 700 | `--ws-text-primary` | 底部 1px 分割线 | 下 24 |
| 章节 h2 | 18 / 600 | `--ws-text-primary` | 左 3×16 橙色竖条 | 上 36 下 14 |
| 小节 h3 | 16.5 / 600 | `--ws-text-primary` | 6px 橙色圆点 | 上 26 下 10 |
| h4 / h5 / h6 | 15 / 14 / 14 · 600 | `--ws-text-secondary` | — | 上 22 下 8 |
| 正文 p | 16 / 400 | `--ws-text-body` | — | 下 18 |
| 列表 ul>li | 16 / 400 | 同上 | 5px 橙色圆点 | 条目间 10 |
| 有序 ol>li | 16 / 400 | marker `--ws-brand-500` | 数字 | 条目间 10 |
| 链接 a | 16 / 400 | `--ws-brand-600`（暗色 `400`） | 1px 半透明下划线 | — |
| strong | 600 | `--ws-text-strong` | — | — |
| em | 500 | 同正文 | 14% 橙色底色块 | — |
| blockquote | 16 | `--ws-text-secondary` | 左 3px 橙边 + `--ws-bg-hover` 底 | 上下 22 |
| code / pre | 0.88em / 13 | `--ws-code-text` on `--ws-code-bg` | — | 上下 22 |
| table | 14 | 表头 `--ws-bg-hover` | 1px `--ws-border-subtle` 网格 | 上下 22 |
| img / figure | — | — | 圆角 6、居中 | 上下 22 |
| hr | — | `--ws-border-subtle` | — | 上下 30 |

全局：`line-height 1.8`、`letter-spacing .2px`、`word-break: break-word`。

## 3. 硬约束

1. **颜色只引 `--ws-*`**：`--text-*` 等旧别名在 `:root` 处求值，组件内不跟随 `data-theme`（见 `packages/ui/src/tokens.css` 注释）。
2. **暗色不得用 `bg-subtle` 做块底色**：`#111` 比纸面 `#1A1A1A` 更深，会呈"挖洞"。统一 `bg-hover`。
3. **长 URL 必须可断行**：`#433` 之后正文会有成串裸链接，禁止出现横向滚动。
4. **空正文必须给空态**：2026-10-22 前未留存 payload 的记录不允许呈现为空白。
5. 抽屉宽度 820 是配合 680 版心的最小可用值，改版心须同步改抽屉宽度。

## 4. 不在范围

列表页表格样式、公众号端渲染样式（由公众号自身决定）、存量数据清洗（走「重建成文」+ 重新发布，见 #431）。
