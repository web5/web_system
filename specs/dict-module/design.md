# 字典模块（维表）设计

> 状态：**v2 · 决策已确认，进入实现**（用户 2026-09-10 答复 7 条，见 §7）｜日期：2026-09-10｜作者：AI 草稿
> 起因：ai-agent 的可用模型清单只存在于 `.env`（`TOKENHUB_MODELS`）与代码默认值里，用户没法在界面维护；
> 同类"小而稳定的枚举集合"后续会越来越多（合同标签、角色类别、地区、业务类型…），需要一个通用维表收敛。

---

## 1. 目标与非目标

**目标**

1. 提供**通用字典**（类型 + 明细两级），由运维在 admin 界面增删改启用，不写代码不发版。
2. 业务侧统一消费方式：**DB 字典 → 环境变量 → 代码内置常量**三级回落，DB 挂了/没配也能起来。
3. 首个落地字典：`llm_models`（大模型清单），替代当前"只能改 `.env`"的形态。

**非目标（本期不做）**

- 不做多级树形字典（本期两级足够；需要时再加 parent_code）。
- 不做字典版本化/审计留痕（先借用已有 `operation_logs`，P3 再评估）。
- 不改造现有 `model_pricing`（单价）数据结构（见 §6 待确认 2）。

---

## 2. 概念模型

```
dict_types（字典类型/维表头）          dict_items（字典项/维表明细）
┌────────────┬──────────────┐        ┌────────────┬───────────────┐
│ code       │ llm_models   │  1:N   │ type_code  │ llm_models    │
│ name       │ 大模型清单    │───────▶│ value      │ hy4-preview   │ ← 业务侧消费的值
│ builtin    │ true         │        │ label      │ Hy4 Preview   │ ← 页面展示
│ enabled    │ true         │        │ sort/enabled/remark
└────────────┴──────────────┘        └────────────┴───────────────┘
```

设计取舍：

| 决策 | 选择 | 理由 |
|---|---|---|
| 一张表还是两张表 | **两张**（type + item） | 后期按 type 加元数据（描述、内置标记）不污染明细；列表页天然两级导航 |
| 删除还是停用 | **默认停用**，删除仅允许非内置项 | 历史数据里已落库的 value 需要能被解释，物理删除会造成悬空引用 |
| 内置类型由谁补 | **模块启动幂等补齐 type，不塞具体 item** | item 全交给人维护。这是 `TOKENHUB_MODELS` 踩的坑——代码默认值和 `.env` 打架，所以 item 坚决不写代码默认值 |
| value 口径 | **以"外部系统真实 id"为准**（如网关 model id） | 字典只做映射，value 必须是可直接透传给下游的原值 |

---

## 3. 数据模型（v2：三层，支持自定义字段）

```
dict_types 字典类型（表头）          dict_fields 字段定义（列元数据）       dict_items 字典项（数据）
┌──────────┬─────────────┐         ┌───────────┬──────────────┐        ┌───────────┬──────────────┐
│ code     │ llm_models  │  1:N    │ type_code │ llm_models   │  1:N   │ type_code │ llm_models   │
│ name     │ 大模型清单   │◀────────│ name      │ model_id     │◀───────│ value     │ hy4-preview  │（保留：唯一键/默认展示） 
│ builtin  │ true        │         │ label     │ 模型 ID      │        │ label     │ Hy4 Preview  │
│ sort     │ 10          │         │ type      │ string       │        │ attrs     │ {"provider":"tokenhub",…}│（按 field 定义的扩展值）
└──────────┴─────────────┘         │ length    │ 64           │        │ sort/enabled/remark
                                   │ required / default / options / sort
```

设计取舍：

| 决策 | 选择 | 理由 |
|---|---|---|
| 一张表还是两张表 | **type + fields + items 三层** | 用户要「字段可定义类型与物理长度、表单按类型渲染」→ 必须有列元数据层 |
| 扩展值怎么存 | **`attrs` JSON 列**（MySQL `json`） | 动态字段不可能预先占物理列；`value`/`label` 保留为固定列，承载唯一键与列表默认展示，避免全 JSON 化后没法建唯一索引 |
| 为什么不为每个字典动态建表 | **不做** | 动态 DDL 破坏 migration 与权限模型，运维成本远高于收益 |
| 删除还是停用 | **默认停用**，删除仅允许非内置项 | 历史数据里已落库的 value 需要能被解释，物理删除会造成悬空引用 |
| 内置类型由谁补 | **启动幂等补齐 type + fields，不塞 item** | item 全交给人维护。这是 `TOKENHUB_MODELS` 踩的坑——代码默认值和 `.env` 打架，所以 item 坚决不写代码默认值 |
| value 口径 | **以"外部系统真实 id"为准**（如网关 model id） | 字典只做映射，value 必须是可直接透传给下游的原值 |

### 3.1 字段定义（type/length → 表单渲染 + 写库校验）

`dict_fields` 支持的字段类型与 canonical 约束：

| type | 存储（attrs 内） | 渲染控件 | length 语义 | 校验 |
|---|---|---|---|---|
| `string` | 字符串 | `a-input` | 最大字符数（≤1024） | `≤ length`，非空视 `required` |
| `text` | 字符串 | `a-textarea` | 最大字符数（≤4096） | 同上 |
| `number` | 数字 | `a-input-number` | 精度（总位数，≤20） | 数值合法 + 位数上限 |
| `boolean` | 布尔 | `a-switch` | — | 仅 true/false |
| `enum` | 字符串 | `a-select` | — | 必须命中 `options`（JSON 数组） |
| `date` | ISO 字符串 | `a-date-picker` | — | 可解析日期 |

- **长度不是数据库物理约束**，而是"应用层强校验 + 提示 maxLength"——JSON 列无法做列级 `varchar(n)`，但所有写入都过 `DictService.validateAttrs()`，超长直接 400 并指明字段名；同时在 UI 上用 `maxlength` 前置拦截，体感与物理长度一致。
- `required` / `default` / `options` / `sort` 一并入库，表单完全由元数据驱动：新增一个字典 = 配 type + 配 fields，无需写代码、无需改前端。

### 3.2 建表

```sql
dict_types   (id uuid PK, code varchar(64) UNIQUE, name varchar(128), description varchar(255),
              builtin bool default false, enabled bool default true, sort int, created_at/updated_at/deleted_at)
dict_fields  (id uuid PK, type_code varchar(64), name varchar(64), label varchar(128), type varchar(16),
              length int null, required bool default false, default_value varchar(255) null,
              options json null, sort int, UNIQUE(type_code, name), INDEX(type_code, sort))
dict_items   (id uuid PK, type_code varchar(64), value varchar(128), label varchar(255),
              attrs json null, remark varchar(255), enabled bool default true, sort int,
              UNIQUE(type_code, value), INDEX(type_code, sort))
```

承载：**system-service 库**（用户确认）。本地 `synchronize` 自动建；生产 synchronize 关闭 → **补 `migrations/0006_dict_tables.sql`**。

---

## 4. 后端接口

承载服务：**system-service（:6004）**，gateway `admin/:path(*)` 已通配转发到它，无需改网关路由。

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/admin/dict/types` | `system:dict:view` | 字典类型列表，带 `keyword`（code/name 模糊）与 `itemsCount` |
| POST | `/admin/dict/types` | `system:dict:manage` | 新建类型 |
| PUT | `/admin/dict/types/:id` | `system:dict:manage` | 改名称/描述/排序/启用 |
| DELETE | `/admin/dict/types/:id` | `system:dict:manage` | 删除（builtin 拒绝 400；连带删其下所有 field 与 item，二次确认） |
| GET | `/admin/dict/types/:code/fields` | `system:dict:view` | 某字典的字段定义（按 sort） |
| PUT | `/admin/dict/types/:code/fields` | `system:dict:manage` | **整体覆盖式保存**字段定义（前端按最终态提交，天然支持重排/删除） |
| GET | `/admin/dict/types/:code/items` | `system:dict:view` | 某字典明细，**分页**：`page` / `pageSize` / `keyword`(value/label) / `enabled`；返回 `{ items, total, page, pageSize }` |
| POST | `/admin/dict/items` | `system:dict:manage` | 新建明细（`attrs` 按 field 定义校验） |
| PUT | `/admin/dict/items/:id` | `system:dict:manage` | 改 label/attrs/备注/排序/启用 |
| DELETE | `/admin/dict/items/:id` | `system:dict:manage` | 删除明细 |

> 字段定义采用"整体覆盖 PUT"而非逐个 CRUD：字段重排/改名是连带操作，逐个改容易出现中间态。
> 已存在 items 的字典**允许删除字段**（删除只丢这一列的 attrs，不删数据行），但前端会提示"该字段在 N 条明细中已有值"。

**服务间消费接口（Phase 2 开）**：`GET /internal/dict/:code` —— 只返回启用项，供 ai-agent 拉模型清单。
鉴权方案待定（`INTERNAL_API_KEY` 与 user-service 现有做法对齐），见 §6 待确认 3。

返回体沿用 system-service 现有风格 `{ code: 0, data }`；错误由全局 `AllExceptionsFilter` 统一脱敏。

---

## 5. 消费侧：三级回落（这次要解决的根因）

```
可用模型清单 = DB(dict llm_models 启用项)   ← MODEL_SOURCE=db（Web 默认）
             → TOKENHUB_MODELS(.env)       ← CLI / 未启用 DB 时
             → DEFAULT_TOKENHUB_MODELS(代码内置常量)
```

- **DB 全部为空 → 回落下一级并打 WARN**，不会让服务起不来。这是硬约束：字典是新依赖，不允许它成为 Agent 链路的单点。
- CLI（kedou-agent）**不连 DB**，默认 `MODEL_SOURCE=env`；同时让 CLI 也读同一份 `.env`（现在它只读 `~/.kedou`），做到"一个 `.env` 喂饱两端"。
- 开关：`MODEL_SOURCE`（`db` / `env` / `builtin`），Web 侧默认 `db`，CLI 默认 `env`。

---

## 6. 分期计划

| 阶段 | 内容 | 是否本期 |
|---|---|---|
| P1 | system-service 字典模块（3 表 + 10 接口 + 内置 `llm_models` 类型与字段补齐）、admin 字典管理页（搜索 + 分页 + 按字段定义渲染表单）、权限登记、生产迁移 SQL | ✅ 本期 |
| P2 | `/internal/dict/:code` 内部接口 + ai-agent 接入（`MODEL_SOURCE=db` + 三级回落）+ admin「模型」页聚合（清单 × 单价） | 下期 |
| P3 | 其它字典接入（合同标签等）、字典变更审计、按需树形字典 | 后续 |

---

## 7. 已确认决策（2026-09-10 用户答复）

| # | 议题 | 结论 |
|---|---|---|
| 1 | 表归属 | **system-service 库**；生产补 `migrations/0006_dict_tables.sql` |
| 2 | 字典与模型单价的页面关系 | **页面层合并**：保留 `model_pricing` 表与数据在 ai-service，admin「模型」页同时呈现"可用清单（字典 `llm_models`）"与"单价（model_pricing）"，两侧互相跳转；**数据层不合并**，避免跨服务写操作 |
| 3 | `/internal/dict/:code` 鉴权 | 复用 `INTERNAL_API_KEY`，与 user-service 现有做法一致 |
| 4 | 权限范围 | `system:dict:view` 给 **super_admin / admin / editor / viewer**；`system:dict:manage` 仅 super_admin / admin |
| 5 | 删除语义 | 不做回收站；破坏性操作写明后果 + 二次确认 |
| 6 | 列表形态 | 左侧字典列表**预留搜索框**；右侧明细**必须分页**（`page` / `pageSize`） |
| 7 | 字段是否可定义 | **要**：新增 `dict_fields` 定义字段名/类型/长度/必填/默认值/枚举项，表单按类型渲染，写库前按定义校验（§3.1） |

## 7.1 遗留风险

| 风险 | 应对 |
|---|---|
| `attrs` JSON 列无列级约束 | 应用层 `validateAttrs()` 强校验 + UI `maxlength` 前置；DTO 层禁 `any`，attrs 值限定 `string \| number \| boolean \| null` |
| MySQL JSON 与 PostgreSQL 兼容 | 本地 MySQL（json）/ 生产 PG（jsonb）：实体统一用 `type: 'json'`，迁移 SQL 分库各出一份 |
| 改字段定义导致历史 attrs 残留无效 key | 读取时只返回当前定义内的字段（多余 key 保留不展示、不丢失），避免"改定义即丢数据" |
| 消费方忘记做回落 | P2 接入时统一走三级回落 + WARN（§5） |

## 7.2 变更日志

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-09-10 | v1 | 初稿：两层模型（type + item），待评审 |
| 2026-09-10 | v2 | 采纳用户 7 条答复：归属 system-service；新增 `dict_fields` 字段定义层 + `attrs` JSON；搜索 + 分页；权限放宽到 editor/viewer 只读；模型页与字典页页面层合并 |

---

## 8. 影响面清单（改动文件预览，确认后执行）

| 层 | 文件 | 改动 |
|---|---|---|
| 后端 | `servers/system-service/src/dict/*`（新建 7 个文件） | entity×3（type/field/item）/ dto / service（含 `validateAttrs`）/ controller / module |
| 后端 | `servers/system-service/src/app.module.ts` | 注册 `DictModule` |
| 迁移 | `migrations/0006_dict_tables.sql`（新建） | 3 张表的 MySQL/PG 建表语句（生产 synchronize 关闭） |
| 权限 | `packages/types/src/index.ts` | 新增 `system:dict:view` / `system:dict:manage`；view 放宽到 editor/viewer |
| 前端 | `apps/admin/src/api/dict.ts`（新建） | 接口封装（含分页参数） |
| 前端 | `apps/admin/src/views/Settings/DictManagePage.vue`（新建） | 管理页：搜索 + 分页 + 按字段定义动态渲染表单 |
| 前端 | `apps/admin/src/router/index.ts` | 新增 `settings/dicts` 路由（`system:dict:view`） |
| 前端 | `apps/admin/src/layouts/BasicLayout.vue` | selectedKeys 映射补 `dicts` |
| 文档 | `docs/development-guide.md` / Agent 手册 | 补「字典消费方式」小节（P2 接入时一并写） |
| P2 | `ModelPricingPage.vue` | 页面层聚合字典可用清单（本期不动） |
