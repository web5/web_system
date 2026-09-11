# 设计 · 模型信息统一到字典（`llm_models` 收编 `model_pricing`）

> 状态：**待评审**（2026-09-11）
> 分支：`feature/llm-models-unify`
> 关联：`specs/dict-module/design.md`（字典能力来源）、`docs/development/agent-capability-playbook.md`（坑 10 / 11）
>
> ⚠️ **本文档的 `ModelPricingCatalog` + `PRICE_SOURCE` 灰度方案未被最终采用。**
> 2026-09-11 收尾实现改为 `DictPricingProvider`（60s 轮询字典进内存、核算时同步查表），
> 并直接删除 `/api/admin/model-pricing` 只读过渡接口与网关路由 —— 见
> `specs/model-pricing-to-dict/design.md` 与 `servers/ai-service/src/agent-log/dict-pricing.provider.ts`。
> 本文档保留为方案演进记录，实施请以 `specs/model-pricing-to-dict/design.md` 为准。

---

## 1. 背景与问题

当前「一个模型」的属性被拆在两个地方维护，且**没有任何关联约束**：

| 属性 | 存放位置 | 谁消费 |
|---|---|---|
| 模型 id（`value`）、提供方、上下文、视觉、启用/停用、排序 | 字典项 `dict_items`（`type_code='llm_models'`）+ `attrs` | ai-agent `ModelCatalogService`（每 60s 拉 → 决定 Playground / Agent 可选模型） |
| 输入价、输出价、币种 | 表 `model_pricing` | ai-service `AgentLogService.computeCost()`（落 run 时算成本） |

由此产生的实际问题（2026-09-11 在 admin「模型」页实测）：

1. **同一模型在两处各出现一次** —— 页面上「可用模型清单」（字典镜像）与「模型单价」（`model_pricing`）两张表列同一批模型 id。
2. **新增模型要跑两个地方**，漏一处就出现：
   - 字典有、单价无 → 成本记 0（当前 8 个模型里 6 个是「未配置单价」）
   - 单价有、字典无 → 孤儿单价（永不生效，也不报错）
3. **`provider` 冗余且可能不一致**：字典 `attrs.provider` 与 `model_pricing.provider` 各存一份（页面上 `glm-5.3` / `kimi-k3` 显示 `other` 即为此割裂的表现）。
4. **双表分工没有带来任何收益**（见 §2 事实 2），只是把一条记录拆成两处。

---

## 2. 现状事实（设计依据，均来自代码）

**事实 1 — 清单真相源已经是字典。**
`servers/ai-agent/src/agent/model-catalog.service.ts` 按 `DB 字典 → TOKENHUB_MODELS → 代码内置` 三级回落拉取 `/internal/dict/llm_models`，用返回的 `value` 注册 `TokenHubClient`。字典是运维在 admin 维护的唯一入口。

**事实 2 — 成本是「逐 run 快照」，不依赖单价表做聚合。**
`servers/ai-service/src/agent-log/agent-log.service.ts:219-231`：

```ts
private async computeCost(model, prompt, completion): Promise<number> {
  const p = await this.pricingRepo.findOne({ where: { model } });   // ← 只按 model 查，没用 provider
  if (!p) return 0;
  return (prompt * Number(p.inputPricePer1k||0) + completion * Number(p.outputPricePer1k||0)) / 1000;
}
```

算出的值写入 `agent_runs.cost`，再由 `upsertDailyMetric` 聚合进 `run_metrics.total_cost`。
→ **账单聚合走 `agent_runs` / `run_metrics`，不会 join `model_pricing`**；专用表的「精度列 / FK / 聚合 join」三项优势在本系统都用不上。同时 `provider` 在查询里完全没参与（只作唯一索引的一部分）。

**事实 3 — 字典已具备承载价格的全部能力。**
- `dict_fields` 支持 `number` 类型（含位数上限），并有 `required` / `defaultValue` / `options`；
- `DictService.validateAttrs()`（`dict.service.ts:306-364`）对写入做类型/位数/必填/枚举强校验，未定义字段被丢弃；
- 消费接口 `/internal/dict/:code` 返回启用项的 `value/label/attrs/sort` —— 清单与价格可一次拉取。

---

## 3. 目标与非目标

**目标**

1. 模型的所有属性（是否可用、提供方、上下文、视觉、**价格**、币种、排序）**只在字典 `llm_models` 维护一次**。
2. 成本核算读取路径不变语义（无价格 → 成本 0，不发明数值），但数据来源改为字典。
3. 老数据（`model_pricing` 现有行）无手工干预地迁移过去，无法自动处理的显式报出。

**非目标**

- 不做「按 provider 的多维账单聚合」（若将来要做，那才是引入专用表的时机）。
- 不改 `agent_runs.cost` / `run_metrics.total_cost` 的存储与语义（历史成本快照不重算）。
- 不动 ai-agent 的三级回落策略（字典 → env → 内置）。

---

## 4. 方案设计

### 4.1 数据模型：`llm_models` 增 3 个内置字段

在 `DictService.BUILTIN_DICTS` 的 `llm_models.fields` 追加：

| name | label | type | 约束 | 说明 |
|---|---|---|---|---|
| `input_price_per1k` | 输入价/1K | `number` | `length: 8`，非必填 | CNY，每 1K input tokens |
| `output_price_per1k` | 输出价/1K | `number` | `length: 8`，非必填 | CNY，每 1K output tokens |
| `currency` | 币种 | `enum` | `options: ['CNY','USD']`，`defaultValue: 'CNY'` | 与 `model_pricing.currency` 对齐 |

**为何非必填**：现状允许「模型可用但未配价」（成本记 0 并在页面提示补配），保持语义不变，避免上线即阻塞运维添加模型。

**价格精度说明（需评审知晓）**：`attrs` 是 JSON，`number` 只有「整数位上限」校验（`castValue()`），没有 `decimal(12,6)` 那样的列级精度约束。业务影响可忽略——价格参与的是「一元一次乘法」，且历史成本已快照；若评审认为需要强精度，备选是给 `dict_fields` 增加 `scale`（小数位）属性，属字典模块的独立小改（见 §7 待确认 3）。

### 4.2 读写路径

```
admin「模型」页 ──(dict API)──┐
                              ├─→ system-service: dict_items(llm_models) + dict_fields
运维在「字典管理」────────────┘
                                        │
                    GET /internal/dict/llm_models（启用项 value+attrs）
                                        │
              ┌─────────────────────────┴──────────────────────────┐
        ai-agent ModelCatalogService                    ai-service 新增 ModelPricingCatalog
        （已有：注册可用模型，60s 轮询）                  （新：缓存 model→价格，落 run 时查缓存）
```

**ai-service 新增 `ModelPricingCatalog`**（放 `agent-log/` 或独立模块，与 ai-agent 的 `ModelCatalogService` 同款模式）：

- 启动立即拉一次 + `PRICE_POLL_MS`（默认 60s，与 ai-agent 对齐）轮询 `/internal/dict/llm_models`；
- 缓存 `Map<modelId, { inputPricePer1k, outputPricePer1k, currency }>`；
- **失败回落**：拉取失败保留上一次缓存；从无缓存可用时按「无价格」处理（成本 0）并打一次 WARN —— 与现状 `if (!p) return 0` 语义一致；
- `computeCost()` 改读缓存，**去掉对 `pricingRepo` 的依赖**（不再查库）。

> 为什么不直连字典表：`dict_items` 属 system-service 的库表，跨服务直连会破坏边界；项目已有 `/internal/dict/:code` + `x-internal-key` 的既定通道。

### 4.3 内置字段补齐策略变更（必须改，否则新字段永远建不出来）

`DictService.ensureBuiltin()` 现在只在「该字典字段数为 0」时补字段（`dict.service.ts:145-149`）。
`llm_models` 已有 4 个字段，**新增的 3 个价格字段不会生效**。

改为**按 `name` 增量补齐**：
- 遍历内置字段定义，逐 `name` 比对；缺失的插入，已存在的**不覆盖**（保护运维改过的 label / 长度 / 是否必填）；
- 幂等，可重复执行；补齐动作打一条 INFO 日志（便于排查）。

### 4.4 数据迁移

一次性脚本 `scripts/migrate-model-pricing-to-dict.ts`（或 `migrations/0006_*.sql`，推荐脚本以便打印明细），步骤：

1. 读 `model_pricing` 全部行；
2. 对每行，按 `model` 匹配 `dict_items(type_code='llm_models', value=model)`：
   - 命中 → 合并 `input_price_per1k` / `output_price_per1k` / `currency` 进 `attrs`（**不覆盖已有非空 attrs 价格**，冲突时打印 diff 由人决定）；
   - 未命中 → 记入「孤儿单价」清单，**不自动建字典项**（因为「该模型是否可用」是业务决策，不能由脚本臆断）；
3. 输出三份清单：`已迁移 N` / `已存在跳过 N` / `孤儿 N（列出 provider+model）`；
4. 幂等：可重复执行，重复执行结果为「已存在跳过」。

`model_pricing` 表**保留不删**（历史留痕；确认稳定后再单独提删除迁移）。迁移完成前 `computeCost` 走「字典优先、表兜底」的双读，迁移完成后切为纯字典（见 §4.5 灰度）。

### 4.5 灰度与回退

| 阶段 | `PRICE_SOURCE` | 行为 |
|---|---|---|
| 1（本次先上） | `dict`（默认） | 读字典缓存；缓存为空时回落查 `model_pricing` 表，并打 WARN |
| 2（观察 1~2 周后） | `dict-only` | 纯字典，彻底不查表 |

回退：把 `PRICE_SOURCE` 改回 `legacy` 即恢复「只查 `model_pricing`」，不需要回滚代码。

### 4.6 前端（用户 2026-09-11 裁定：维护统一在「字典管理」）

**不新增第二套维护 UI**，`llm_models` 的维护完全沿用字典模块已有交互约定：

| 维护对象 | 入口 | 形态 |
|---|---|---|
| **表的定义**（`llm_models` 的字段：provider / context_window / supports_vision / note / **三个价格字段**） | 字典管理 → 该字典「编辑」 | **独立页面**（`settings/dicts/llm_models`，即现有 `DictEditPage`） |
| **记录**（每个模型及其价格值） | 字典管理 → 明细区「新增记录 / 编辑」 | **抽屉式**（`DictManagePage` 的 `a-drawer`） |

含义：
- 价格加进字段定义后，**抽屉里的动态表单会自动多出三个价格输入项**（`llm_models` 的表单是按 `dict_fields` 动态渲染的，无需为模型单独写表单）；
- 「模型」页不再承担维护职责，其最终形态见 `page-spec.md`（本轮评审一并定）。

---

## 5. 影响面

| 模块 | 改动 | 风险 |
|---|---|---|
| system-service `dict.service.ts` | `BUILTIN_DICTS` 加 3 字段；`ensureBuiltin` 改增量补齐 | 低（补齐逻辑幂等，不覆盖人工改动） |
| ai-service `agent-log` | 新增 `ModelPricingCatalog`；`computeCost` 改读缓存；`PRICE_SOURCE` 开关 | 中（成本计算路径，但语义不变：无价→0） |
| ai-service 接口 | `admin/model-pricing` CRUD 标 deprecated（页面下线后仅保留只读 `GET` 供过渡） | 低 |
| admin 前端 | 「模型」页重写为单表；菜单文案调整 | 中（页面重写，需 page-spec 评审） |
| 数据 | 迁移脚本 + 孤儿清单 | 中（需人工确认孤儿单价） |
| 文档 | playbook 坑 10/11 补充；`specs/dict-module/design.md` 交叉引用 | 低 |

---

## 6. 验收标准

1. **单点维护**：在「模型」页新增一个模型（含价格）后，该模型出现在 Agent Playground 下拉中（≤60s），且下一次 run 的成本按新价计算。
2. **迁移完整**：迁移脚本执行后，「孤儿清单」为空，或清单中的每一项都由人工明确处置（补字典项 / 确认丢弃）。
3. **语义不变**：未配价格的模型，`agent_runs.cost` 仍为 0（不得出现 `null` 或报错）。
4. **回落可用**：把 system-service 停掉后发一次 run，成本按最后一次缓存计算；缓存不存在则记 0 且日志有 WARN，run 本身不失败。
5. **开关有效**：`PRICE_SOURCE=legacy` 时行为与改动前完全一致（回归对照）。
6. **页面无重复**：「模型」页只剩一张表，页面上不再出现同一模型两行。

---

## 7. 待确认（评审请逐条给结论）

1. **价格字段命名**：`input_price_per1k` / `output_price_per1k` / `currency` 是否认可？（与老表 `inputPricePer1k` 驼峰不同，字典 `attrs` 惯例是下划线）
2. **金额单位**：老表是「每 1K tokens 的 CNY」，字典沿用同一口径（页面写 `输入价/1K`）—— 是否需要改成「每 1M」以贴近厂商报价？
3. **精度**：接受 `number` + 位数上限（无小数位约束），还是给 `dict_fields` 补 `scale` 字段做强约束？
4. **孤儿单价**：脚本只报告不自动建字典项，确认？（若希望自动建，需要额外确认「provide/model 从哪取」—— 老表里有 `provider`，可自动填）
5. **灰度**：是否按 §4.5 分两阶段（先双读、后纯字典）？
6. **`model_pricing` 表**：保留只读一段时间，还是本次一并下线（含表删除）？
7. ~~页面归属~~ → **已确认（2026-09-11）**：`llm_models` 就放在「字典管理」维护，**不加提示、不另建入口**（见 §4.6）。
8. ~~权限归属~~ → **已确认（2026-09-11）**：权限与其它字典表**完全一致**（`system:dict:view` / `system:dict:manage`），**不新增权限点**；`agents:cost:view` 保持原样，供成本/观测页使用。
9. **「模型」页的最终形态**（唯一待定项）：① 保留为**只读总览**（展示清单 + 价格 + 未配价提示，编辑跳字典管理）；② 直接**下线**（模型完全在字典管理里维护）；③ 保留可编辑的聚合视图。见 `page-spec.md` 的「形态选项」。
