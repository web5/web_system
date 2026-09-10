# 字典模块 · 接口设计（消费契约）

> 状态：**待评审**｜日期：2026-09-10｜配套：`design.md`（数据模型与分期）、`page-spec.md`（管理页 UI）
> 定位：字典的**三类消费入口 + 消费方约定 + 字典目录**。改接口前先改本文档，评审通过再动代码。

---

## 1. 为什么要有三个入口

字典同时被三种角色消费，权限与数据可见性完全不同，因此拆成三个入口而不是一个通吃：

| 入口 | 前缀 | 鉴权 | 数据可见性 | 典型调用方 |
|---|---|---|---|---|
| **管理端** | `/admin/dict/*` | JWT + `system:dict:view` / `system:dict:manage` | 全部（含停用项、含字段定义） | admin「字典管理」页 |
| **服务间** | `/internal/dict/:code` | `x-internal-key: INTERNAL_API_KEY` | 仅启用项 | ai-agent（模型清单、合同场景校验） |
| **C 端只读** | `/dict/:code` | **登录即可**（JWT，无需权限码） | 仅启用项 | 小程序 / portal 渲染业务枚举 |

设计取舍：

- C 端接口**刻意不 `@Public`**：业务枚举（合同场景、风险等级）虽非敏感，但匿名可爬没必要开放；登录用户足够覆盖小程序/门户场景。
- 三入口共用一套 service 方法（`listEnabledItems` / `listItems`），**不做三份查询逻辑**，避免语义漂移。
- 停用项只在管理端可见：服务间与 C 端拿到的一定是"当前生效值"。

---

## 2. 接口清单

### 2.1 管理端（gateway：`/api/admin/dict/*` → system-service）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/admin/dict/types` | `system:dict:view` | 字典类型列表；`?keyword=` 模糊匹配 code/name；每项带 `itemsCount`（一次聚合，避免 N+1） |
| POST | `/admin/dict/types` | `system:dict:manage` | 新建字典 |
| PUT | `/admin/dict/types/:id` | `system:dict:manage` | 改名称/描述/排序/启用 |
| DELETE | `/admin/dict/types/:id` | `system:dict:manage` | 删除（`builtin=true` 拒绝 400；连带删字段与全部明细） |
| GET | `/admin/dict/types/:code/fields` | `system:dict:view` | 字段定义列表（按 sort） |
| PUT | `/admin/dict/types/:code/fields` | `system:dict:manage` | **整体覆盖式保存**字段定义（前端提交最终态，天然支持重排/删除） |
| GET | `/admin/dict/types/:code/items` | `system:dict:view` | 明细分页：`page` / `pageSize`(≤200) / `keyword`(value\|label) / `enabled`(true\|false) |
| POST | `/admin/dict/items` | `system:dict:manage` | 新建明细（`attrs` 按字段定义校验） |
| PUT | `/admin/dict/items/:id` | `system:dict:manage` | 改 label/attrs/备注/排序/启用 |
| DELETE | `/admin/dict/items/:id` | `system:dict:manage` | 删除明细 |

**返回体**统一 `{ code: 0, data: ... }`；分页为 `data = { items, total, page, pageSize }`。

> ⚠️ query 参数的类型转换：`page`/`pageSize` 需 `@Type(() => Number)`、`enabled` 需把 `"true"/"false"` 转 boolean，
> 否则 class-validator 会直接 400（已修，见 commit `c0dd089`）。

### 2.2 服务间

| 方法 | 路径 | 鉴权 | 返回 |
|---|---|---|---|
| GET | `/internal/dict/:code` | `x-internal-key` | `{ code: 0, data: [{ value, label, attrs, sort }] }`（仅启用项） |

失败语义：缺 key 或 key 不匹配 → **401**；`INTERNAL_API_KEY` 未配置 → 401（不静默放行）。

### 2.3 C 端只读（gateway：`/api/dict/*` → system-service）

| 方法 | 路径 | 鉴权 | 返回 |
|---|---|---|---|
| GET | `/dict/:code` | JWT（登录即可） | `{ code: 0, data: [{ value, label, attrs, sort }] }`（仅启用项） |

`attrs` 是自定义字段的键值对（如 `contract_scene` 的 `hint`、`contract_risk_level` 的 `color/icon/weight`），
前端按需取用；**不要**假设某个字典一定有 `attrs`。

---

## 3. 消费方约定（重要）

### 3.1 三级回落

```
DB 字典（启用项） → 环境变量 → 代码内置常量
```

- 任一级为空或不可用 → 回落下一级并 **WARN**；**任何情况都不因字典不可用而中断业务**。
- 现有实现：ai-agent `ModelCatalogService`（模型清单）、`DictClientService`（通用读取）。

### 3.2 「参与判断」vs「纯展示」

| 类型 | 示例 | 字典作用 | 校验策略 |
|---|---|---|---|
| **参与判断** | `contract_scene`（决定过滤哪套法定标准） | 只约束**可选值**（前端展示 + 入参校验） | **字典值 ∪ 代码常量**（宽松并集，不让运维误删导致后端拒单） |
| **纯展示** | `contract_risk_level`、`operation_log_type` | 以字典为准（文案/颜色/排序可配） | 直接以字典为准 |

> ⚠️ `contract_scene` 这类枚举还有**代码配套要求**：新增场景必须同时补法定标准库
> （`packages/shared/src/contract/standards/*`），否则该场景判定结果为空。字典里已在 `description` 标注此约束。

### 3.3 生效时机与缓存

| 消费方 | 缓存/轮询 | 行为 |
|---|---|---|
| ai-agent `ModelCatalogService` | `MODEL_POLL_MS`（默认 60s） | 轮询刷新并重建注册表 |
| ai-agent `DictClientService` | `DICT_CACHE_MS`（默认 60s） | 读时缓存；失败回落代码常量 |
| 前端（admin / 小程序 / portal） | 无缓存 | 每次进入页面拉取；**写后刷新即见** |

结论：**字典改动最长 60s 生效**（AiAgent 侧），前端下次进入页面即生效。

---

## 4. 字典目录（现存契约）

| 编码 | 名称 | 关键字段（`dict_fields`） | 初始数据 | 消费方 | 备注 |
|---|---|---|---|---|---|
| `llm_models` | 大模型清单 | `provider`(enum 必填) / `context_window`(number) / `supports_vision`(boolean) / `note`(text) | **不预置** | ai-agent 模型注册、admin「模型」页、Agent 定义模型下拉 | `hy3` 由专用 client 承载，不要加进本字典（会被过滤 + WARN） |
| `contract_scene` | 合同场景 | `hint`(string) | 6 项（消费贷/车贷/医疗险/车险/租赁/其他） | ai-agent `contract-rule` 校验；（批次二）小程序上传页 chips | 新增场景需补标准库 |
| `contract_risk_level` | 合同风险等级 | `color`(enum) / `icon`(string) / `weight`(number) | 3 项（高风险/需关注/正常） | （批次二）小程序结果页展示 | **计分公式仍在代码**，字典只管展示元数据 |
| `operation_log_type` | 操作日志类型 | 无 | 5 项（登录/退出/修改设置/创建用户/删除） | admin 操作日志筛选；（后续）写入端取值对齐 | — |

内置字典的补齐规则（`DictService.ensureBuiltin`）：

- 类型与字段：**只在字典还没有字段时补齐**，不覆盖人工改动；
- 初始数据（`seedItems`）：**仅当该字典一条明细都没有时插入一次**；`llm_models` 明确不预置（内容随业务变化）。

---

## 5. 接入一个新字典的标准流程

```
① 定契约：编码（小写下划线）/ 字段定义 / 是否需要初始数据
② 改本文档 §4 目录 + 消费方约定（评审）
③ 后端：BUILTIN_DICTS 加一项（内置）或页面新建（业务自建）；消费方按 §3 接
④ 前端：读 /dict/:code（C 端）或 /admin/dict/... （管理端）
⑤ 验证：字典停用某项 → 消费方 ≤60s 内不再出现；字典服务不可用 → 回落且业务不中断
```

---

## 6. 待确认

| # | 问题 | 当前实现 | 备选 |
|---|---|---|---|
| 1 | C 端只读接口的鉴权强度 | 登录即可 | 完全公开（匿名可读）/ 仅限白名单字典 |
| 2 | 参与判断枚举的宽松并集 | 字典值 ∪ 代码常量 | 严格以字典为准（运维可控但误删会拒单） |
| 3 | 是否给字典加"使用方声明"字段（记录哪些服务在读） | 暂不加，目录表人工维护 | 加 `consumers` 字段，页面展示影响面 |
| 4 | 批次二的落地顺序 | 建议：变变分类 → 小程序合同两项 → todo 三组 | 由你定 |

---

## 7. 变更日志

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-09-10 | v1 | 初版：补记批次一已实现的接口（三入口、seedItems、并集校验）与消费契约；批次二/三待评审 |
