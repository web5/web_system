# 「每日美句池扩展到 NCE3/NCE4 + 册别角标」研发方案（九子项）

> 阻塞: 0

## 0. 元信息

- 版本: v1.0 / 2026-11-25（s33 实施）
- 负责人: 研发部（rd-engineer，TDD 实施）
- **需求真源（绝对路径）**: `/Users/geekwen/AiWorkspace/30-任务产物/2026-11-17-大橙子小程序NCE交互与登录态整改/163-NCE3NCE4美句池扩展方案-2026-11-25.md`（§五九子项 + §六 V1–V14 + §七风险回滚 + §八待确认 7 项）
- **册别角标原型（引用，不新造）**: `/Users/geekwen/AiWorkspace/30-任务产物/2026-11-17-大橙子小程序NCE交互与登录态整改/164-册别角标UI原型-2026-11-25.md` + 附件 `164-附件-册别角标UI原型-2026-11-25.html`；凭证 `Proto: d3c3730281e758d8`（sha256 前 16，完整 `d3c3730281e758d8cb8f2cc670fbd21bfcfdf646135f163380f4397799cc067f`）/ `Design: pass`（机检 + 人工质检 A–J 全过 + WCAG AA）。推荐方案①：句上方浅青 pill「新概念二册 · L44」。
- **用户确认记录**: 用户 2026-11-25 11:32 在主会话明确拍板 **A2「先实施」/ A3「加」/ 选项 A 默认**——版权授权不卡开发、本地逐字精选、不向外部 LLM 传原文；书面授权待补、对外发布前提示；册别角标加（方案①）；**方案已获用户确认（lead 转达）**。
- 分支 / worktree: `feat/nce3nce4-daily-quotes-20261125` / `web_system-nce3x`（基于 `origin/master c9684908` 新建，长期保留不删；不复用任何他人 worktree）
- PR / commitId: 待建（draft，防 auto-merge）
- 配套凭证: 独立测试文档（带 `Test:`）、page-spec（带 `Spec:`），实施阶段落任务目录。
- **硬边界**: 只出 PR，不发布 / 不合并 / 不 ssh 写远端 / 不改 prod / 不出码。本轮代码交付不上线。

## 1. 背景与目标

`GET /api/content-admin/nce/daily-quotes` 当前 136 条全部为 NCE2（冻结资产 sha256 `6f5fe566…`、`pool_version=1`），而 NCE3（60 课）、NCE4（48 课）真实课文数据已入库。用户看到「NCE3/NCE4 的怎么没有」。本方案采纳选项 A：三册合一个精选池，`pool_version=2` 统一轮换，v1 保留可回滚；并按 A3 加册别角标（方案①）。属**新需求 / 新一次交付**，不是 bug。

验收目标：接口返回三册书均有句子、契约不变、真实逐字零编造、跨册身份键共存、seed 幂等 v1 保留、小程序取句契约不变 + 角标正确降级、UI 门禁合规、B 抽样全绿。

## 2. 技术方案九子项（投影自 163 稿 §五）

### §2.1 架构与数据流

```
lessons.json(NCE2/96) ┐
lessons3.json(NCE3/60)├─ [离线·构建期一次性逐字精选脚本，非业务代码、零运行时 LLM]
lessons4.json(NCE4/48)┘         │
                                ▼
servers/content-hub/data/daily-quotes.json ← v2 / count=281 / 新 sha256 / 三册 source.book
                                │ [seed 校验 sha+version+count+逐条形状/逐字，事务 upsert + 回读]
                                ▼
MySQL web_system.daily_quotes (pool_version=2, ordinal=1..281) ← v1 行保留不删
                                │ [DailyQuoteService：查库 + 内存缓存 + in-flight + 故障快速失败]
                                ▼
GET /api/content-admin/nce/daily-quotes → {code:0,data:{version:2,count:281,items},message:'ok'}
                                │ [小程序 services/daily-quotes.ts 静默拉取 → 剥成 {cn,en,book,lessonId}[] 写缓存]
                                ▼
utils/daily.ts: dayIndex() 本地午夜取模 N → getDailyQuote(): {cn,en} + getDailyQuoteMeta(): {book,lessonId}
   └─ 首页 index.wxml：主句 {{quote.cn}}/{{quote.en}} + 方案①浅青 pill 册别角标
      缓存空/全脏 → FALLBACK_QUOTES（10 条 NCE2 兜底，恒显「新概念二册」册名）
```

边界：精选/重导发生在包外（离线一次性）；运行时只读库 + 取模 + 取句，不调 LLM、不写库。关键改造点：跨册身份键必须含 book（2091 处碰撞，见 §2.4 / §3）。

### §2.2 页面清单（含菜单）

| 页面 | 路由 | 职责 | 权限门控 | UI 改动 |
|---|---|---|---|---|
| 首页 | `pages/home/index/index` | 今日一句 + 册别角标（方案①） | `login-gate` 后 | `.daily-k` 行右侧加浅青 pill（唯一改动页，挂 Proto/Design） |
| admin 每日美句只读页 | `apps/admin/.../DailyQuotes.vue` | 整池只读查看 + 搜索/分页 | 既有 admin 门控 | 零改动（`sourceFields` 已含 `source.book`，三册自动可见） |

> 🔴 因改 `index.wxml`，按 R11 走原型门禁：**直接引用** 164 稿 `Proto: d3c3730281e758d8` + `Design: pass`，禁止伪造新原型、禁止手写 HTML 绕过。

### §2.3 接口清单

| 方法 | 路径 | 入参 | 出参 | 鉴权 |
|---|---|---|---|---|
| GET | `/api/content-admin/nce/daily-quotes` | `?version`（可选，非法值忽略不 500） | `{code:0,data:{version:2,count:281,items[{cn,en,source{book,lessonId,title,lineIndex}}]},message:'ok'}` | 无（公开只读通道，沿用） |

零新增接口、零路径变化、零请求字段变化。`version` 由 1→2 是数据版本而非契约版本。

### §2.4 数据结构

| 结构 | 字段 | 说明 | DDL |
|---|---|---|---|
| 冻结资产 `daily-quotes.json` | `{_notice,version:2,count:281,items:[{cn,en,source{book,lessonId,title,lineIndex}}]}` | `source.book ∈ {NCE2,NCE3,NCE4}`；头注含三册源 sha16 + 生成时间 + 条数 + 版权注记 | 无（seed 唯一真源） |
| DB `daily_quotes` 行 | 现有列 + `pool_version=2` | `source_book` 由「恒 NCE2」改为「册别」；`cn/en VARCHAR(512)` 够用（三册最长 en 317） | **migration 0030**：唯一键 `uk_daily_quotes_version_source` 改为 `(pool_version, source_book, source_lesson_id, source_line_index)`；`uk_daily_quotes_version_ordinal` 不变 |
| 小程序缓存 `daily_quotes_pool` | `{version:2,items:[{cn,en,book,lessonId}],fetchedAt}` | 增 `book`+`lessonId` 两字段（原型字段契约）；旧缓存无 book 时角标隐藏降级；缓存 key 不升版本 | 无 |

**跨册身份键碰撞（migration 0030 设计依据，门禁重点）**：三册课号都从 1 起，按 `(lessonId,lineIndex)` 统计，2922 个唯一键中 **2091 处跨册碰撞**（NCE2∩NCE3 课号交集 60）。现唯一键 `uk_daily_quotes_version_source(pool_version,source_lesson_id,source_line_index)` 不含 `source_book`——若直接把三册合入 `pool_version=2`，NCE2 L1:0 与 NCE3 L1:0 会被判为同一行：seed 身份键校验误杀、service `shapeIsValid` 去重判非法、DB upsert 覆盖。故**必须先上 0030 把 `source_book` 补进唯一键**，使身份键变为 `(pool_version,source_book,source_lesson_id,source_line_index)`，三册同号行才能共存。entity `@Index` 同名同列，避免 `synchronize` 抖动。该新唯一键在仅含 NCE2 的 v1 数据上与旧键等价，可保留不回退（回滚依赖此性质）。

### §2.5 配置清单

| 配置项 | 类型 | 改动 | 环境差异 | 发布关联 |
|---|---|---|---|---|
| `DAILY_QUOTES_ASSET_SHA256` / `FROZEN_VERSION` / `FROZEN_COUNT`（`daily-quotes.data.ts` + seed） | 常量 | `41e3588e…` / `2` / `281` | 无 | 随 content-hub |
| seed book 白名单与课号上限 | 脚本校验 | `NCE2:1..96 / NCE3:1..60 / NCE4:1..48`，按 book 分支 | 无 | 同上 |
| seed 清理规则 | 脚本逻辑 | 保留 v1，仅清理 `pool_version>2` 或本版越界 ordinal | 无 | 同上（回滚依赖 v1 保留） |
| 册名中文映射 `BOOK_LABEL` | 前端常量 | `NCE2→新概念二册 / NCE3→新概念三册 / NCE4→新概念四册` | 无 | 随小程序 |
| LLM key / 凭证 | 环境变量 | **不引入**（离线筛选、运行时零 LLM） | 无 | 无 |

三类最易漏项（网关路由 / 权限规则 / 部署路径+凭证）：均不涉及。

### §2.6 依赖系统或接口

| 依赖对象 | 类型 | 强/弱 | 缺失后果 | 发布关联 |
|---|---|---|---|---|
| 三册 `lessons*.json`（sha16：NCE2 `40339154ec0a54ad` / NCE3 `9558256c30524970` / NCE4 `4885c6aee9121a2f`） | 内部数据源 | 强 | 精选无输入 / 无法溯源 | 阶段 0 复核三 sha16 与课数 |
| `daily_quotes` 表 + 0030 migration | 内部 DB | 强 | 无缓存时 5xx；唯一键未改则 upsert 覆盖跨册行 | migration 先行，再 seed，再重启 |
| 外部 LLM API | 外部 | **无** | 本轮离线精选在**本地**做，绝不向任何外部 LLM/第三方传原文 | 不进运行时依赖链 |
| admin / PC portal | 下游只读消费者 | 弱 | 无（结构不变） | 无需改动 |

### §2.7 初始化数据 / 种子数据

| 数据项 | 内容 | seed 方式 | 幂等 | 环境差异 |
|---|---|---|---|---|
| 新冻结池 v2 | 资产 JSON（281 条：NCE2 136 冻结 + NCE3 80 + NCE4 65，三册 source 齐全、逐字、交错编排） | `scripts/seed-daily-quotes.mjs` 校验新 sha/version/count/逐条形状后，事务按 `(pool_version=2,ordinal)` upsert + 回读逐字比对；v1 行保留 | 身份键含 book + 唯一键改造后重复执行不漂移 | 无（同库 `web_system`） |
| 小程序兜底池 | `FALLBACK_QUOTES` 10 条 NCE2（默认不动） | 代码常量 | — | 随包（默认无变化） |

执行顺序（实施阶段写进回执，本轮不执行写库）：备份 `daily_quotes` → 上 0030 migration → 跑新 seed（`--dry-run` 先校验）→ `SELECT COUNT(*) WHERE pool_version=2` 校验 → 重启 content-hub 清缓存 → 接口探针 → dev 验证（本轮不做 prod/dev 写）。

### §2.8 权限模型

无新增权限项；沿用公开只读通道（无 JwtGuard）与首页 `login-gate`；无新菜单、无新角色映射。

### §2.9 接口设计约束（设计阶段必查三项）

| 检查项 | 裁定 |
|---|---|
| ① 静态路径与参数路径共存 | `daily-quotes` 为静态段，与 `lessons/:id(\d+)` 无同前缀 `:param` 抢匹配；本次不加新路径 |
| ② 路径参数强校验 | 无新增路径参数；`?version` 仍仅留痕，非法值忽略不 500 |
| ③ 前端并发聚合不拖垮主流程 | 无运行时生成/联网取句新链路；`prefetchDailyQuotes()` 仍 `silent:true` + try/catch，不进首页主链路 |

## 3. 测试六维（投影自 163 稿 §四）

| 维度 | 设计 |
|---|---|
| 单元测试 | service：v2 行数/ordinal 连续/三册 book 合法/身份键含 book 去重/缓存命中与 in-flight/DB 故障降级；seed：新 sha+version+count、跨册同 `(lessonId,lineIndex)` 不互覆、幂等、v1 保留、回读逐字；小程序：`isValidPoolBody` 接受三册池并拒非法 book、`getDailyQuote()` 契约不变、`getDailyQuoteMeta()` 字段齐全、本地午夜、旧缓存无 book 降级 |
| 接口 / 集成 | `GET .../daily-quotes` 信封、count=281、三册 book 均出现、`?version=2/not-an-int/-3` 均不 500 |
| 功能用例矩阵 | 独立用例文档落任务目录（commit 带 `Test:`） |
| 回归范围 | **≥6 suites / 77 tests**（134 稿基线）+ 3 组变异红 / 还原绿；禁跑全量（命中共享面已获用户授权抽样 B）；改 `index.*` 按 UI 门禁验 |
| 变异测试 | ① seed/service 身份键改回无 book → 跨册用例抓红；② book 白名单删 NCE3/4 → 三册用例抓红；③ 取模 N 改回 136 → 轮回用例抓红 |
| **测试范围决策** | 改动命中 content-hub 共享面（migration/entity/seed）+ 首页共享面（`index.wxml`/缓存）；**用户已授权抽样 B（≥6 suites/77 tests + 3 组变异红绿，禁跑全量）**，本方案据此执行，不另跑全量；小程序按 B 抽样覆盖，不重跑全量 UI |

## 4. 验证判据 V1–V14（投影自 163 稿 §六）

| 编号 | 验证项 | 通过标准 |
|---|---|---|
| V1 | 三册数据源现值与 sha | NCE2=96/`40339154ec0a54ad`、NCE3=60/`9558256c30524970`、NCE4=48/`4885c6aee9121a2f` |
| V2 | 逐字保真 / 零编造 | 新池每项按 `(book,lessonId,lineIndex)` 反查对应 `lessons*.json`，`mismatches=0`；source 四字段齐全 |
| V3 | 完整句 / 中英成对 | cn+en+source 三项一致；半句占比 ≤5% |
| V4 | 跨册身份键 | NCE2 L1:0 与 NCE3 L1:0 共存不互覆；DB 唯一键含 source_book |
| V5 | 资产完整性 | sha256 = 锁定值 `41e3588e…`；version=2、count=281、items.length=281 |
| V6 | seed 幂等 + v1 保留 | 连跑两次结果逐字一致；v2=281、v1=136 不变 |
| V7 | migration 生效 | `uk_daily_quotes_version_source` 含 `source_book`；ordinal 键不变；entity @Index 同名同列 |
| V8 | 接口契约 | 信封不变、count=281、三册 book 出现、`?version` 非法不 500 |
| V9 | 取句契约 | `getDailyQuote(): {cn,en}` 不变；`getDailyQuoteMeta(): {book,lessonId}` 可用；无新增权限/联网 |
| V10 | 本地午夜口径 | `new Date(y,m,d)` 不变，不改成 UTC；N 天轮回 |
| V11 | 离线兜底 | 清缓存/脏池 → 回落 10 条 NCE2 兜底，确定性、不抛错/不 toast |
| V12 | UI 门禁 | 改 `index.wxml` 挂 `Proto: d3c3730281e758d8` + `Design: pass`，无手写 HTML |
| V13 | B 抽样 + 新交付纪律 | ≥6 suites/77 tests 全绿 + 3 组变异有效红 + 还原绿；新 sha 已锁；标为新一次交付 |
| V14 | 版权与边界 | 头注含版权注记、运行时无 LLM 痕迹；只出 PR、零 prod、零出码 |

## 5. 风险与回滚（投影自 163 稿 §七）

| 风险 | 等级 | 缓解 |
|---|---|---|
| 版权授权 | **P0** | 头注「仅供个人学习，不对外分发」；本地逐字精选、零 LLM、不向第三方传原文；书面授权由 lead 另行提示、对外发布前提示，不在本职责内 |
| 提炼质量 | P1 | 每课 ≤2 条、完整句优先、离线逐字精选 + 人审抽检；零编造 |
| 跨册唯一键 | P1 | 2091 处碰撞；先上 0030 再 seed（§2.4 设计依据）；V4/V7 强校验 |
| 轮回周期变化 | P2 | N 136→281，属新交付、预览码目视与文案明示，禁止静默改判据 |
| 缓存不失效 | P2 | 换 `pool_version` 必须重启 content-hub 清内存缓存；上线时按序执行 |
| 回滚路径 | — | 保留 v1 行 + 旧资产 sha + 旧常量：回滚 = 常量回 `1/136/旧sha` + 重启；0030 新唯一键在仅含 NCE2 的 v1 数据上与旧键等价、可保留不回退；小程序/admin 无需回滚 |

## 6. 待确认项处置（投影自 163 稿 §八 + 164 稿 §九）

| 项 | 用户拍板 / 默认 | 本方案处置 |
|---|---|---|
| 选项 A/B/C | ✅ A（用户拍板） | 三册合池 + `pool_version=2` 统一轮换 |
| 新池 N 与配比 | NCE2 136 + NCE3 ~80 + NCE4 ~65（区间 260–300） | 实际 281 = 136+80+65 |
| 抽样口径 | 每课 ≤2 / 完整句优先 / 逐字 / 中英成对 / source 齐全 | 沿用，离线精选脚本实现 |
| 离线筛选授权 | 优先本地；外部 LLM 需书面授权 | **本地精选，零外部 LLM、零原文外传** |
| 小程序兜底池 | 保持 10 条 NCE2 不动 | 不动；角标恒显「新概念二册」 |
| 学习进度联动 | 不联动（全局交错轮换） | 不联动 |
| 册别角标 | A3「加」（用户 11:32 拍板），方案①默认 | 加方案①，引用 164 原型 Proto/Design |
| D5 色板 | 角标浅青底、与真机蓝色系 `--accent-soft` 同族，不重刷整页品牌色 | 采用浅青 pill + 真机 token |
| D6 兜底角标 | 兜底恒「新概念二册」，课号缺省不编造 | 采用 |
| D7 缓存兼容 | 不升缓存 key、靠字段缺失降级隐藏角标 + `showBookBadge` 开关默认开 | 采用 |

## 7. 本轮零动作边界

只出 draft PR；不改 prod、不发版、不 ssh 写远端、不合 master、不重出码；脚本/测试不硬编码本机绝对路径；不向外部 LLM 传原文、不编造句子、不伪造 sha、不手写 HTML 绕过 R11、不改 `index.*` 却无 Proto/Design trailer。

---

> 本文件为 s33 实施前置流程凭证（九子项），依《研发方案与发布规范-v2》§2.1–2.9 投影自 163 稿真源；用户 2026-11-25 11:32 拍板 A2/A3/选项 A 已由 lead 转达确认。凭证先落盘提交，再动 service / controller / types / migrations / 小程序代码。
