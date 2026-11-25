# admin 后台「每日美句」只读查看 UI · 研发方案（九子项）

> 阻塞: 0

## 0. 元信息

- 版本: v1.0 / 2026-11-25（s28 实施）
- 负责人: 研发部（rd-engineer，AI agent 执行）
- **需求真源（绝对路径）**: `/Users/geekwen/AiWorkspace/30-任务产物/2026-11-17-大橙子小程序NCE交互与登录态整改/157-admin美句查看UI需求与原型-2026-11-25.md`（全文：需求 spec + 原型凭证 + 改动清单 + V1–V12 + 测试用例矩阵 + 追溯矩阵）
- **原型凭证（引用，不新造）**: `Proto: ee0c6bc5d6ce8405` / `Design: pass`；附件 `156-附件-每日美句只读查看UI交互原型-2026-11-25.html`（468 行，sha256 `ee0c6bc5d6ce84054f8190d50f878b12ae7c2569a424cf47c6ca25c2bb4ef707`）
- **用户确认记录**: 用户已于 2026-11-25 09:57 在主会话明确拍板「每日美句 admin UI 可以，开工实现」，D1–D6 按 157 稿默认建议执行；方案已获用户确认（lead 转达）。D7 承载分支硬阻塞已消解：`origin/master = 8f41d541`（Merge PR #664 已含 daily-quotes 接口 + s27 数据库治本）。
- 分支 / worktree: `feat/admin-daily-quotes-readonly-view` / `web_system-adminquotes`（基于 `origin/master 8f41d541` 新建，长期保留不删；不复用 s27 的 `web_system-dqdb`）
- PR / commitId: 待建
- 配套凭证: `docs/development/reports/测试用例-每日美句查看UI.md`（`Test:`）、`docs/ui/page-specs/daily-quotes-readonly.md`（`Spec:`）
- 不发布、不合并、不 ssh 写远端；不改服务端 / 小程序 / portal / 网关 / DB / 权限常量。

## 1. 背景与目标

S4 已在服务端上线 136 条「每日美句」只读冻结池（`GET /api/content-admin/nce/daily-quotes`），admin 后台无查看入口。本方案按 157 稿采纳方案 A（独立新页）：照搬 `NceLessons.vue` 只读预览骨架，新增 content 功能组「每日美句」页 + 菜单 + 接口封装。D1–D6 默认建议：不加 book 筛选、列表/抽屉字段范围如稿、客户端分页 20 条/页、900px 抽屉、客户端搜索四字段、权限复用 `content:view`。

验收目标：持 `content:view` 可见入口并查看 136 条整池的 cn/en + 4 个 source 字段；页面与抽屉零写按钮 / 零可编辑控件（V8 硬判据）；视觉与 `NceLessons.vue` 一致。

## 2. 技术方案九子项（投影自 157 稿 §五）

### §2.1 架构与数据流

```
content-hub /api/nce/daily-quotes（冻结池，只读）
   ↓ gateway pathRewrite ^/api/content-admin → /api（用户 JWT 透传）
admin api/nce.ts::getDailyQuotes()（拦截器拆 {code,data} → DailyQuotesPool）
   ↓ onMounted 一次拉整池 → pool ref
views/Content/DailyQuotes.vue（客户端搜索/分页 → a-table 5 列 + a-drawer）
```

无写链路、无辅助接口、无 Promise.all 装饰数据；小程序侧零改动。

### §2.2 页面清单（含菜单）

| 页面 | 路由 | 职责 | 权限门控 |
|---|---|---|---|
| 每日美句 | `/content/daily-quotes`（name `DailyQuotes`） | 136 条只读列表 + 预览抽屉 | `content:view` |
| 菜单项 | `content-daily-quotes`，挂在 `a-sub-menu key="content"` 内 | 入口 | 子菜单整体受 `content:view` 门控 |

菜单在 router / BasicLayout **代码声明**，随前端模块发布即生效；`content:view` 为既有常量（复用，不新增）。

### §2.3 接口清单

| 方法 | 路径 | 入参 | 出参（data 本体） | 鉴权 |
|---|---|---|---|---|
| GET | `/api/content-admin/nce/daily-quotes` | 无（可选 `?version=` 忽略） | `{version,count,items:[{cn,en,source:{book,lessonId,title,lineIndex}}]}` | 公开只读，透传 JWT；前端仅需登录 + `content:view` |

服务端整池一次返回，无 page/pageSize/keyword；前端禁止伪造分页参数。

### §2.4 数据结构

无表结构增改、无 DDL。前端新增 TS 类型：

```ts
export interface DailyQuoteSource { book: string; lessonId: number; title: string; lineIndex: number }
export interface DailyQuoteItem { cn: string; en: string; source: DailyQuoteSource }
export interface DailyQuotesPool { version: number; count: number; items: DailyQuoteItem[] }
```

`rowKey` 用 `${source.book}-${source.lessonId}-${source.lineIndex}`（实测组合键唯一）。

### §2.5 配置清单

| 配置项 | 改动 | 发布关联 |
|---|---|---|
| gateway `^/api/content-admin → /api` | 沿用，不改 | 无需改；pre-flight 比对确认 |
| admin 前端发布单元 | 本轮不出码、不发布 | 后续独立发布阶段 |
| 第三方凭证 / Key | 无（只读公开内容，不用 service key） | — |

### §2.6 依赖系统或接口

| 对象 | 强/弱 | 缺失后果 | 发布关联 |
|---|---|---|---|
| gateway contentAdmin 路由 | 强 | 接口 404 → 页空/错态 | 已存在于 master |
| content-hub daily-quotes 接口 | 强 | 无数据 | 接口版本须先于前端可用（master 已含） |
| 权限 `content:view` | 强 | 菜单过滤 + 路由 403 | 既有常量，已 seed |
| DB / Redis | 无 | 本功能不直连 | — |

### §2.7 初始化数据 / 种子数据

无新增。冻结池资产已随 s27 入库方案落库并在服务端发布（非本任务新增）；本任务 seed 清单为空。

### §2.8 权限模型

| 权限项 | 授予角色 | 门控 | 定义位置 | 生效方式 |
|---|---|---|---|---|
| `content:view` | admin / super_admin（沿用） | 菜单可见 + 路由可进 | 既有共享常量包（已 seed） | 沿用；**不新增常量**，无「首次引入须发版」风险 |

### §2.9 接口设计约束（三项必查）

1. **静态 vs 参数路径**：`@Get('daily-quotes')` 与 `lessons/:id(\\d+)` 无抢匹配。✅
2. **路径参数强校验**：无路径参数，不适用。✅
3. **并发聚合不得拖垮主流程**：本页只 1 接口，无装饰数据；如将来加辅助数据必须 `.catch(() => null)` 降级，不进主链路。✅

## 3. 改动清单（4 文件，157 稿 §六）

| # | 文件 | 动作 | 内容 |
|---|---|---|---|
| 1 | `apps/admin/src/views/Content/DailyQuotes.vue` | 新增 | 只读列表页：整池加载 → pool/page/pageSize/keyword ref；a-table 5 列；客户端搜索与分页；a-drawer width 900 展示 cn/en + 4 source 字段 + 版权注记；四态；组合 rowKey；纯文本插值不用 v-html |
| 2 | `apps/admin/src/api/nce.ts` | 改 | 追加 3 个 interface + `getDailyQuotes()`，沿用同一 request 实例与拆包口径 |
| 3 | `apps/admin/src/router/index.ts` | 改 | content children 增 `daily-quotes` 子路由，紧邻 `nce-lessons` |
| 4 | `apps/admin/src/layouts/BasicLayout.vue` | 改三处 | 菜单项 / handleMenuClick 路由表 / `watch(route.path)` 分支（放 nce-lessons 同层、/content 兜底之前） |

明确不改：content-hub 服务端、小程序端、portal、网关配置、DB/migration、权限常量、测试基建。

## 4. 验证判据 V1–V12（投影自 157 稿 §七，逐条留证）

| # | 判据 | 方法 | 预期 |
|---|---|---|---|
| V1 | 承载分支含接口 | `git show origin/master:…/nce.controller.ts \| grep daily-quotes` | 命中 `@Get('daily-quotes')` |
| V2 | 接口 200 + 信封 | curl（带 JWT，只读 GET） | 200 / `{code:0,message:'ok'}` |
| V3 | 136 条 + 字段齐 | 同上取 data 断言 | count=items.length=136，字段类型齐 |
| V4 | 前端类型检查 | `pnpm --filter admin exec vue-tsc --noEmit` | 0 错 |
| V5 | 列表渲染与 total | 打开页 / 静态+DOM 机检 | total=136；20 条/页客户端切片 |
| V6 | 来源可追溯 | 点预览 / AST 断言 | 抽屉 4 个 source 字段全名 + cn/en |
| V7 | 搜索命中 | 输入 Sundays/明信片/56 | 命中；清空恢复 136 |
| V8 | **只读无写按钮** | 生产 SFC AST + compileTemplate + jsdom DOM 断言 + 变异红绿 | 写按钮 0；无 input/textarea/contenteditable/v-html |
| V9 | 四态 + 唯一恢复入口 | 静态审计 + 代码走查 | 骨架/错误重试/空态清空/403 |
| V10 | 权限门控一致 | router + BasicLayout 源码断言 | 菜单项、路由 meta、watch 三处齐 |
| V11 | 视觉一致性 | 与 NceLessons / 原型 §4.4 对照 | 白底、品牌橙仅交互色、正文合规对比度 |
| V12 | 原型凭证 | sha256 + 机检脚本 | 与 156 原型一致，`Proto:`/`Design:` trailer 可挂 |

## 5. 交付物（四件套）

1. 方案文档（本文）
2. 任务卡 / 需求单（157 稿 §一）
3. `docs/development/reports/测试用例-每日美句查看UI.md`（`Test:` trailer）
4. `docs/ui/page-specs/daily-quotes-readonly.md`（`Spec:` trailer）

## 6. 风险与回滚

- 风险：后台无 JWT 时 V2/V3 无法一手 curl（如实标注缺口，不伪造）；接口依赖 s27 DB + seed，未发布环境会 5xx（本轮不发布）。
- 回滚：本分支仅 4 文件改动，PR 未合并；撤销 PR 或回退分支即可，服务端 / 小程序零影响。
