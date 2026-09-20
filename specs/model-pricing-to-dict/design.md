# 模型单价迁入字典 + 下线「模型」页面（设计稿）

> 状态：**待评审**（2026-09-11 起草）
> 范围决策来源：2026-09-11 确认 —— 删除范围＝「前端 + 后端接口代码，保留表与核算」；存量数据＝「通过字典表来维护」。

## 1 背景与目标

现状：模型单价有**独立一套**（表 `model_pricing` + ai-service CRUD 接口 + admin「模型」页 `ModelPricingPage.vue`），
与「可用模型清单」所在的字典 `llm_models` 分离，运营要跑两个地方对账，且页面价值低于维护成本。

目标：
1. 下线 admin「模型」页面，移除模型单价的 CRUD 接口与网关路由；
2. **单价改由字典 `llm_models` 的 `attrs` 维护**（与模型清单同源，运营只在一个页面维护）；
3. **成本核算继续可用** —— `agent-log` 落 run 时的成本仍按单价算，只是数据源从 `model_pricing` 表切到字典；
4. `model_pricing` 表与存量数据**保留不删**（历史留档、可回溯）。

## 2 范围

### 2.1 删除

| 层 | 文件 / 位置 | 说明 |
|---|---|---|
| 前端 | `apps/admin/src/views/Settings/ModelPricingPage.vue` | 整页 |
| 前端 | `apps/admin/src/api/model-pricing.ts` | API 客户端 |
| 前端 | `apps/admin/src/router/index.ts`（`settings/models` 路由） | 路由 |
| 前端 | `apps/admin/src/layouts/BasicLayout.vue` | 菜单项 `models`、`DollarCircleOutlined` import、`selectedKeys` 映射、`handleMenuClick` 路由项 |
| 前端 | `apps/admin/src/composables/useSafeReturn.ts` | `MENU_ORDER` 去掉 `/settings/models` |
| 后端 | `servers/ai-service/src/agent-log/pricing.controller.ts` | CRUD 控制器 |
| 后端 | `servers/ai-service/src/agent-log/pricing.service.ts` | CRUD 服务 |
| 后端 | `servers/ai-service/src/agent-log/agent-log.module.ts` | 移除 `ModelPricingService` / `ModelPricingController` 注册 |
| 网关 | `servers/gateway/src/proxy/proxy.controller.ts:336-344` | `admin/model-pricing` 的两条代理路由 |

### 2.2 保留

- 表 `model_pricing` **及存量数据**（dev/local 各 1 条：`tokenhub / hy4-preview`）；
- 实体 `ModelPricing`（表映射保留，便于日后回溯；不再被 CRUD 使用）；
- 成本核算能力本身（`agent-log.service.computeCost`）—— 仅切换数据源；
- admin「字典管理」页（单价维护入口，无需新页面）；
- 「Agent 观测」页成本 KPI/成本列、「Run 详情」成本字段（数值口径不变）。

## 3 单价数据源设计（核心）

### 3.1 存放位置

沿用字典项 `attrs`（历史形态本来就有这三个键）：

```jsonc
// dict_items.type_code = 'llm_models' 的某一项
{
  "value": "hy4-preview",
  "label": "Hy4 Preview",
  "attrs": {
    "provider": "tokenhub",
    "context_window": 256000,
    "supports_vision": true,
    "input_price_per1k": 0,      // ← 单价：元 / 1K tokens（输入）
    "output_price_per1k": 0,     // ← 单价：元 / 1K tokens（输出）
    "currency": "CNY"            // ← 仅展示用
  }
}
```

- 键名沿用现有 `attrs` 键（`input_price_per1k` / `output_price_per1k` / `currency`），不引入新命名；
- 单位与 `model_pricing` 一致：**元 / 1K tokens**，成本公式保持 `(prompt*in + completion*out) / 1000`；
- 缺失或非数字 → 该模型成本按 **0**（延续"不发明数值"原则）。

### 3.2 字典字段定义（让字典管理页可编辑）

`llm_models` 类型需补 3 个 `dict_fields`：`input_price_per1k`(number)、`output_price_per1k`(number)、`currency`(string)。

现有 `DictService.ensureBuiltin` 的规则是「**该字典还没有任何字段时**才补齐」，存量环境（dev/local 已有 4 个字段）**不会自动补**，因此需要二选一（见 §8 待确认 Q2）：

- **方案 a（推荐）**：把补齐规则放宽为「**按字段名逐个补缺**」——缺哪个补哪个，不覆盖人工改动；
- **方案 b**：写一条迁移 SQL 直插 3 个字段（一次性，存量库逐个环境执行）。

## 4 后端改造（ai-service）

新增 `DictPricingProvider`（放在 `agent-log/` 下，或与 `agent-log.service` 同模块）：

| 项 | 设计 |
|---|---|
| 数据来源 | `GET {SYSTEM_SERVICE_URL}/internal/dict/llm_models`，头 `x-internal-key: INTERNAL_API_KEY` |
| 拉取时机 | 模块启动同步一次 + 定时轮询（默认 60s，可用 env `MODEL_PRICING_POLL_MS` 覆盖） |
| 内存结构 | `Map<model, { inPrice: number; outPrice: number }>` |
| 失败策略 | 拉取失败/超时（5s）→ **保留上次成功清单**并 WARN；从未成功过 → 空表（成本按 0） |
| 消费方式 | `computeCost(model, prompt, completion)` 改为查内存表，**不在 run 落库路径上做同步 HTTP** |
| 鉴权 | 复用 `INTERNAL_API_KEY`（与 ai-agent `ModelCatalogService` 一致） |

`computeCost` 改造后：

```ts
private computeCost(model: string, promptTokens: number, completionTokens: number): number {
  const p = this.pricingProvider.get(model);      // 内存查表，同步
  if (!p) return 0;
  return (promptTokens * p.inPrice + completionTokens * p.outPrice) / 1000;
}
```

（原实现为 `async` + 查 `model_pricing` 仓储；改造后变为同步查内存，可顺带把调用点的 `await` 收敛。）

同时 `agent-log.service` 移除对 `pricingRepo` 的依赖注入（实体与表保留）。

## 5 接口与鉴权变化

| 接口 | 变化 |
|---|---|
| `GET/POST/DELETE /api/admin/model-pricing` | **删除**（controller + 网关路由） |
| `agents:cost:view` 权限码 | 失去全部消费方（唯一使用点是「模型」页与 pricing 接口）→ 建议移除，见 Q1 |
| `/internal/dict/llm_models` | 无变化（本次只是**新增一个消费方** ai-service） |

## 6 数据迁移

- **无需回填**：`model_pricing` 现有记录（`tokenhub / hy4-preview`，单价 0/0）在字典 `attrs` 中已存在同值；
- 其余 7 个模型字典项无单价 → 成本按 0（与现状一致，运营按需在字典里补价）；
- `model_pricing` 表与数据**不做删除**，仅停止写入。

## 7 风险与回滚

| 风险 | 影响 | 缓解 |
|---|---|---|
| 字典拉取失败 | 成本按 0 或沿用上次值 | 保留上次成功清单 + WARN；成本本就允许为 0 |
| 字典与表口径不一致期 | 改价后 60s 才生效 | 轮询周期 60s，文档写明"改价 60s 内生效" |
| 忘记补字典字段定义 | 字典页看不到单价输入框 | 按 Q2 选定方案处理并写入迁移 |
| 回滚 | —— | 代码回退即可恢复旧路径；表与数据未动，无数据损失 |

## 8 待确认项

| # | 问题 | 备选 | 建议 |
|---|---|---|---|
| Q1 | `agents:cost:view` 权限码是否移除？（涉及 `packages/types`、DB `permissions`/`role_permissions` 与角色同步） | a 移除 / b 保留空置 | **a**（已无消费方） |
| Q2 | 字典字段定义的补齐策略 | a 改 `ensureBuiltin` 为逐字段补缺 / b 一次性迁移 SQL | **a**（后续新增字段也受益） |
| Q3 | 单价的 `attrs` 键名 | a 沿用 `input_price_per1k` / `output_price_per1k` / `currency` / b 改名对齐 field | **a**（存量数据已在用） |
| Q4 | 「Agent 观测」页文案「按 model_pricing 单价核算」 | 改为「按字典 llm_models 单价核算」 | 一并改 |

## 9 实施顺序（确认后）

1. 后端：新增 `DictPricingProvider` → 改造 `computeCost` → 删 `pricing.*` 与模块注册 → 本地验证成本链路；
2. 网关：删两条 `admin/model-pricing` 路由；
3. 前端：删菜单/路由/页面/API + `useSafeReturn` 与观测页文案；
4. 字典：按 Q2 落地单价字段定义；
5. 权限：按 Q1 处理 `agents:cost:view`；
6. 文档：同步 `docs/development/agent-capability-playbook.md`（§3.3 成本核算、§3.5 页面/权限表、§4 体验路线 ③）。

## 变更日志

| 日期 | 变更 |
|---|---|
| 2026-09-11 | 初稿：范围决策落定（前端 + 后端接口代码删除，保留表与核算；单价迁字典维护），待评审 Q1–Q4 |
