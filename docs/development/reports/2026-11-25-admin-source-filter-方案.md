# admin「每日美句」来源筛选表单 · 研发方案（九子项）

> 阻塞: 0

## 0. 元信息

- 版本: v1.0 / 2026-11-25（s36 实施）
- 负责人: 研发部（rd-engineer，AI agent 执行）
- **需求/原型/口径真源（绝对路径）**: `/Users/geekwen/AiWorkspace/30-任务产物/2026-11-17-大橙子小程序NCE交互与登录态整改/167-admin来源筛选表单需求与原型-2026-11-25.md`（全文：需求三件齐 + D1 翻转论证 + 字段取舍 + 只读边界 + 九子项 + V1–V13 + 追溯矩阵 + E1–E8 一手证据）
- **原型凭证（引用，不新造）**: `Proto: 3ac228a0a62df6c8` / `Design: pass`；附件 `167-附件-来源筛选表单原型-2026-11-25.html`（560 行，sha256 `3ac228a0a62df6c830166f9c406e487435af997b299d1155117252f6f7a45a00`）。**未复用旧 `ee0c6bc5…`**（旧稿无筛选表单，sha 对不上，对应 167 稿反例 Y8）。
- **用户拍板记录**: 用户 2026-11-25 13:52 在主会话明确要求「admin 那里的列表加个来源筛选表单吧」，lead 转达确认进入实施；字段口径按 167 稿 §1.5 默认建议执行（册别必做 / 课号可选 includes 不做区间 / title·lineIndex 不做独立项 / 与 keyword 为 AND / 纯前端不伪造接口参数 / 查询控件不算写控件守住只读）。原型已过 ux-prototype-designer 流水线（机检 ✔ + 无头走查 16/16 + JS 0 错）。
- 基线: `origin/master = 2d82d73f`（Merge PR #666，已含三册 v2 池 NCE2:136 / NCE3:80 / NCE4:65，version=2/count=281）。
- 分支 / worktree: `feat/admin-source-filter-20261125` / `web_system-srcfilter`（基于 `origin/master 2d82d73f` 新建，长期保留不删；不复用他人 adminquotes/dqdb/nce3x worktree）。
- PR / commitId: 待建（draft，防 auto-merge 秒合）。
- **范围冻结**: 仅前端 1 文件（DailyQuotes.vue）+ 配套四件套（测试/规格/solution doc 落 reports 与 src）。不改 api/router/layout；不改服务端 / 小程序 / portal / 网关 / DB / 权限常量；不发布、不合并、不 ssh 写远端、不出码。

## 1. 背景与目标

admin「每日美句」只读列表页（master `2d82d73f`）现只有 keyword 客户端搜索 + 20 条/页分页。v2 冻结池上线后整池 281 条横跨 NCE2(136)/NCE3(80)/NCE4(65)，运营无法按册别/课号快速收窄来源。本方案按 167 稿采纳方案 A（工具条内联筛选表单），在现有工具条上加「册别下拉 + 可选课号输入 + 清空」，纯前端 computed 过滤，接口不变。

验收目标（V1–V13）：册别四选项；选册后计数 136/80/65/281 且列表仅对应册；课号客户端 includes；筛选与 keyword 为 AND；筛选变化重置第 1 页；叠加空态 + 唯一清空入口；只读零写按钮（查询控件语义放行）；不伪造接口参数；视觉一致；新 Proto sha 可机检。

## 2. 技术方案九子项（投影自 167 稿 §四）

### §2.1 架构与数据流

```
content-hub /api/nce/daily-quotes（冻结 JSON 资产 v2/281，只读）
   ↓ gateway pathRewrite ^/api/content-admin → /api（用户 JWT 透传）
admin api/nce.ts::getDailyQuotes()（无参数，拦截器拆 {code,data}）
   ↓ onMounted 一次拉整池 → items ref（281 条，不随筛选重拉）
views/Content/DailyQuotes.vue
   ├ 现有：keyword ref → filtered（cn/en/title/lessonId）
   └ 新增：bookFilter ref('ALL') + lessonFilter ref('')
          → filtered 追加 book/lesson 两个 AND 条件
          → paged = filtered.slice(...)（20 条/页，筛选变化 → page=1）
          → a-table + a-drawer（不变）
```

无写链路；无新后端改动；接口整池一次返回、筛选纯 computed、筛选变化零新请求。

### §2.2 页面清单（含菜单）

| 页面 | 路由 | 职责 | 权限门控 | 本任务改动 |
|---|---|---|---|---|
| 每日美句 | `/content/daily-quotes`（name `DailyQuotes`） | 281 条只读列表 + 来源筛选 + 预览抽屉 | `content:view` | **仅模板工具条加筛选表单**，路由/菜单不动 |

菜单项 `content-daily-quotes` 已在 160 稿落地（router/BasicLayout 三处），本任务不改菜单、不改路由。

### §2.3 接口清单

| 方法 | 路径 | 入参 | 出参（data 本体） | 鉴权 | 本任务改动 |
|---|---|---|---|---|---|
| GET | `/api/content-admin/nce/daily-quotes` | **无** | `{version:2,count:281,items:[{cn,en,source:{book,lessonId,title,lineIndex}}]}` | 公开只读，透传 JWT | **无改动**；`getDailyQuotes()` 保持无参数 |

服务端整池一次返回，无 page/pageSize/keyword/book/lessonId 参数；前端禁止伪造 `?book=`/`?lessonId=`/`?keyword=`（反例 Y2 / V11）。

### §2.4 数据结构

无表结构增改、无 DDL。前端新增两个筛选 ref（非 DB 结构）：

```ts
const bookFilter = ref<'ALL' | 'NCE2' | 'NCE3' | 'NCE4'>('ALL');
const lessonFilter = ref('');
// filtered 追加两个 AND 条件：
//   (bookFilter.value === 'ALL' || item.source.book === bookFilter.value)
//   && (!lessonFilter.value || String(item.source.lessonId).includes(lessonFilter.value.trim()))
```

`rowKey` 沿用 `${source.book}-${source.lessonId}-${source.lineIndex}`（组合键唯一）。

### §2.5 配置清单

| 配置项 | 类型 | 改动 | 发布关联 |
|---|---|---|---|
| gateway `contentAdminProxy` | 网关配置 | **沿用**（`^/api/content-admin` → `/api` 已存在） | 无需改 |
| 部署路径（admin 前端 commit 段） | 部署配置 | 本轮不出码、不发布 | 后续独立发布阶段 |
| 第三方凭证 / Key | 环境变量 | **无**（只读公开内容） | — |

### §2.6 依赖系统或接口

| 依赖对象 | 强/弱 | 缺失后果 | 发布关联 |
|---|---|---|---|
| gateway 网关路由 | 强 | 接口 404 → 页面错态 | 已存在（160 稿验证） |
| content-hub daily-quotes 接口（v2/281） | 强 | 无数据 | dev 已在（167 E1）；prod 版本待确认（见风险） |
| 权限 `content:view` | 强 | 菜单被过滤、路由 403 | 已存在 |

### §2.7 初始化数据 / 种子数据

**无新增初始化数据**。筛选是纯前端查询态（ref 默认 `'ALL'` / `''`），不涉及 DB seed；冻结池 v2 已由 166 稿在 dev 落地，本任务不碰数据。

### §2.8 权限模型

沿用 `content:view`（160 稿已落地），**不新增权限常量** → 无「首次引入须发版」风险。筛选表单随页面可见性门控（持权限才见工具条），不改权限服务/seed。

### §2.9 接口设计约束（三项必查）

1. **① 静态路径 vs 参数路径**：`@Get('daily-quotes')`，不加筛选子路由、不改路径 → 无抢匹配。✅
2. **② 路径参数强校验**：无路径参数、无 `Number(id)` 进 ORM。✅ 不适用。
3. **③ 并发聚合不得拖垮主流程**：筛选纯本地 computed，不新增任何接口请求（无 `Promise.all`）；筛选变化不触发重新请求。✅ 单接口、零新增请求。
   - **附加约束**：`getDailyQuotes()` 调用不得带 params；筛选全程零新请求（V11）。

## 3. 改动清单（唯一功能改动文件 + 配套四件套）

| # | 文件 | 动作 | 内容 |
|---|---|---|---|
| 1 | `apps/admin/src/views/Content/DailyQuotes.vue` | **改（唯一功能改动文件）** | 工具条加册别 `<a-select>`（4 选项）+ 课号 `<a-input>` + 「清空」；新增 `bookFilter/lessonFilter` ref；`filtered` 追加两个 AND 条件；筛选变化 `onFilterChange()` 重置 `page=1`；`clearFilters()` 复位三条件 + keyword + 页码；空态文案改「清空筛选与搜索」；浅色白底样式沿用现页 |
| 2 | `apps/admin/src/views/Content/daily-quotes-source-filter.spec.ts` | 新增（TDD spec） | 结构守卫 + 语义用例 + V8 只读机检（语义白名单，注入编辑按钮应红） |
| 3 | `docs/development/reports/测试用例-admin来源筛选表单.md` | 新增（`Test:`） | V1–V13 用例矩阵 + 变异红绿记录 |
| 4 | `docs/development/reports/2026-11-25-admin-source-filter-方案.md` | 新增（本文，`Plan:`） | 九子项凭证 |

明确不改：`api/nce.ts`、`router/index.ts`、`layouts/BasicLayout.vue`（接口无参数变化、路由/菜单不变）；content-hub 服务端、小程序端、portal、网关配置、DB/migration、权限常量、测试基建。

## 4. 测试方案（TDD 红→绿→重构）

- **红**：先写 spec 覆盖筛选 AND / 页码重置 / V8 只读机检；未实现时断言失败。
- **绿**：最小实现 DailyQuotes.vue 让 spec 全绿。
- **变异红绿（至少 3 组）**：① 册别筛选漏加 AND（改了不过滤）→ 用例红；② 注入编辑按钮 → V8 机检红；③ 页码不重置 → 用例红。每组记录「注入→红→还原→绿」证据。
- **lint/typecheck/test**: `pnpm --filter admin exec vue-tsc --noEmit` + `pnpm --filter admin test` 全绿；测试/脚本禁硬编码本机绝对路径（用 `__dirname` 相对定位）。
- **测试范围**：命中单视图文件，非共享面（`views/*` 不属于 §test_surface），只跑 admin 包，不请示全量。

## 5. 验证判据 V1–V13

见 167 稿 §七（本方案不改判据）。实施阶段逐条给一手证据，写回执 `168-admin来源筛选实施回执-2026-11-25.md`。

## 6. 发布清单

**本轮不发布、不出码、不合并**。后续实施发布时按 admin 前端单元的既有发布流程走（发布单元清单另立），本方案不含发布动作。

## 7. 影响面 / 追溯矩阵

| 需求 | 设计处 | 判据 | 反例 |
|---|---|---|---|
| D1 翻转（三册筛选） | §1.4(167) / §2.4 | V1–V5 | Y1 |
| book 必做 | 167 §1.5 / §2.4 | V1–V5 | Y1 |
| lessonId 可选 includes | 167 §1.5 / §2.4 | V6 | — |
| title/lineIndex 不做 | 167 §1.5 | — | Y6 |
| AND + 页码重置 | 167 §1.5 / §2.1 | V7 V8 | Y5 |
| 空态 + 清空 | 167 §1.5 / §2.1 | V9 | — |
| 纯前端不伪造参数 | §2.3 / §2.9 | V11 | Y2 Y3 |
| 只读边界 | 167 §1.6 | V10 | Y7 |
| 视觉/白底 | 167 §5.4 | V12 | — |
| 新原型凭证 | 167 §5.1 | V13 | Y8 |

## 8. 风险与回滚

- **风险 1（prod 池版本）**：dev 已 v2/281（167 E1），prod 是否上 v2 未确认；若 prod 仍 v1 单册，册别下拉 NCE3/NCE4 会 0 命中。本轮不上线，上线前须确认 prod 池版本（不在本任务范围）。
- **风险 2（只读误判）**：查询用 select/input 属查询控件，V8 机检须按语义白名单放行；表格内编辑控件与写按钮零容忍（变异红绿 ② 守此边界）。
- **回滚**：单文件改动，回滚 = revert 该 commit（或 restore 工具条到 master 版）；不涉及数据/接口/权限，回滚无副作用。
