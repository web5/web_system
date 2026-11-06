# 页面规格书 · admin「新概念英语课文」只读预览

> 建：2026-11-05 · 总契约见 `docs/development/nce-integration-spec.md`
> 工程 UI 门凭证：本页与原型/规格同行落码，不单独新建孤立 HTML。

## 用途

后台查看已入库的 NCE2 课文，用于人工校对抓取质量（课文是否漏句、译文是否完整、导入问题中文是否正确、习题答案是否合理）。**只读**：不提供新增/编辑/删除/重新抓取，数据唯一写入口是 `scripts/import-nce-lessons.mjs`。

## 入口与路由

| 项 | 值 |
|---|---|
| 路由 | `/content/nce-lessons`（`name: NceLessons`） |
| 菜单 | 「自媒体运营」子菜单 →「新概念英语」，`key: content-nce-lessons` |
| 权限 | `content:view` |
| 登记处 | `apps/admin/src/router/index.ts`、`apps/admin/src/layouts/BasicLayout.vue`（菜单项 / selectedKeys watch / handleMenuClick 三处） |

## 字段映射（JSON → DB 列 → 页面）

| lessons.json | DB 列 | 页面位置 |
|---|---|---|
| `id` | `lesson_no` | 列表「课号」L01 格式 |
| `title` / `titleCn` | `title` / `title_cn` | 列表两列；预览标题 |
| `leadQuestionCn` | `lead_question_zh` | 列表与预览**优先大字** |
| `leadQuestion` | `lead_question` | 预览中文下方英文小字副行 |
| `textSource` | `text_source` | `xdf`→绿 tag「权威全文」；`lrc`→橙 tag「字幕拼接」 |
| `lines` | `lines`(JSON) | 列表句数；预览逐句对照 |
| `words` | `words`(JSON) | 列表词数；预览生词表 |
| `exercises` | `exercises`(JSON) | 列表题数；预览题干/选项/答案/解析 |
| `text` | `text` | 预览课文全文（`white-space: pre-wrap` 保留分段与引号） |
| `translation` | `translation` | 预览参考译文 |
| `sources` | `sources`(JSON) | 预览来源 URL |
| `fetchedAt` | `fetched_at` | 列表抓取时间 |

三端统一回落规则：`leadQuestionCn || leadQuestion`；两者都空显示「—」/隐藏。

## 接口

`GET /api/content-admin/nce/meta`、`/lessons`、`/lessons/:id`（响应 `{code:0,data,message}`），封装在 `apps/admin/src/api/nce.ts`。

## 交互

- 页头显示教材名与「已入库 N / 96」；搜索框支持课号/中英文标题；分页 20 条/页。
- 点「预览」打开 `a-drawer`（width 900），`:get-container="moduleOverlayContainer"` 必带（微前端 CSS 作用域）。
- 抽屉内 `a-spin` 加载态、`a-empty` 空态；失败由 request 拦截器统一弹错并关闭抽屉。
- 浅色白底：`#FFFFFF / #1A1A1F / #6B7280 / #F97316 / #0EA5A4`。

## 验收判据

| # | 判据 | 通过标准 |
|---|---|---|
| A1 | 菜单可达 | 「自媒体运营 → 新概念英语」点击后 URL 变 `/content/nce-lessons` 且菜单高亮 |
| A2 | 列表 | 显示已入库课，中文导入问题在前、英文副行在后，`xdf/lrc` tag 正确 |
| A3 | 预览 | 抽屉能看全文/逐句/译文/生词/习题/来源，引号与分段不丢 |
| A4 | 只读 | 页面无任何写接口调用（Network 里只有 3 个 GET） |
| A5 | 空值 | 未补中文的课显示「—」而不是 `undefined` / `null` |
