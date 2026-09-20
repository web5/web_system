# 流水线脚本按环境区分（多环境 = 多分支脚本）

> 建立：2026-09-20 ｜ 分支：`feat/deploy-console-domain-split` ｜ 仅本地（local）验证
> 配套：`specs/config-driven-deploy/design.md`、`docs/development/local-dev-guide.md §3.2`

---

## 1. 背景

用户口径（2026-09-20）：**本地验证时，deploy-console 自身走脚本；其他模块走发布流水线。**

但当前流水线节点脚本是**模板级、不区分环境**：

- `deploy_pipeline_step_commands` 唯一键 = `(pipelineId, nodeKey)`，一行脚本服务所有环境
- 于是同一条 `admin 发布` 线，`env=dev` 与 `env=local` 执行**同一份 scp 脚本**
  → 用流水线做本地验证会把产物投到 dev 机（已实测复现）

要让"流水线支持多环境"，脚本必须能**按环境（分支）分别配置**。

---

## 2. 目标

1. 同一条流水线的同一节点，可为不同环境配不同脚本（`local` 本机 cp、`dev`/`prod` 远程 scp）
2. **未配环境级脚本时，行为与现状逐字节一致**（双轨零破坏）
3. 不新增"每环境一条流水线"的特例模板（那条路已否决：会按模块 × 环境爆炸）

---

## 3. 设计

### 3.1 数据模型

`deploy_pipeline_step_commands` 增加 `env` 维度：

| 列 | 类型 | 说明 |
|---|---|---|
| `env` | varchar(32) NOT NULL DEFAULT `''` | 环境 ID；`''` = 默认（全环境通用） |

唯一键：`(pipelineId, nodeKey)` → **`(pipelineId, nodeKey, env)`**

> `synchronize: true`：加列与改唯一键由启动自动完成；存量行 `env` 填 `''`（即默认脚本），等价现状。

### 3.2 解析规则（读取优先级）

```
1) (pipelineId, nodeKey, env = 当前环境)   精确命中 → 用它
2) (pipelineId, nodeKey, env = '')        回落默认 → 用它
3) 都没有 → 节点无脚本（走内置逻辑 / 按 optional 跳过或 fail-fast）
```

### 3.3 接口

`/api/pipeline-templates/:id/steps/:nodeKey` 增加 `?env=` 查询参数：

| 方法 | 语义 |
|---|---|
| `GET ...?env=local` | 读该环境脚本（不存在时返回默认行，带 `source: 'default'` 标记） |
| `PUT ...?env=local` | 写环境级脚本（不影响默认与其他环境） |
| `DELETE ...?env=local` | 删环境级脚本（回落到默认） |

不传 `env` = 操作默认脚本（兼容现有调用与前端）。

### 3.4 执行链路

`PipelineService.runStageCommand` → `stepCommands.resolveActions(pipelineId, nodeKey, p.env)`
按 §3.2 解析；其余不变。

### 3.5 平台托管脚本

`PlatformScriptSeedService` 仍写 `env=''`（默认），对所有环境生效；
环境级脚本只覆盖用户显式配置的部分，平台基线不被绕过。

---

## 4. 影响面

| 位置 | 改动 |
|---|---|
| `entities/deploy-pipeline-step-command.entity.ts` | 加 `env` 列 + 唯一键 |
| `pipeline-step-command.service.ts` | `getRow` / `listByTemplate` / `resolveActions` / `upsert` / `remove` 加 env |
| `pipeline-step-command.controller.ts` | 加 `?env` 参数 |
| `pipeline.service.ts`（runStageCommand） | 传 `p.env` |
| 单测 | 新增：精确命中 / 回落默认 / 环境间互不干扰 |

---

## 5. 回退

- 环境级脚本留空即回落到默认（现状行为）
- 无需开关：无环境级配置时代码路径与改动前等价

---

## 6. 验证（本地）

1. 单测：三级解析 + 环境隔离
2. 接口：`PUT ...?env=local` 写本机脚本 → `GET`（不传 env）仍返回默认 → 两者互不影响
3. 端到端：给 `admin 发布` 线配 `env=local` 的本机 cp 脚本 → 提交 `env=local` 发布
   → 产物落**本机**静态目录（不再 scp 到 dev）→ 页面可加载
   → 同时确认 `env=dev` 行为不变（默认/远程脚本）
