# 步骤 · 步骤任务（分支）与执行条件

> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
> 定位：流水线**步骤（节点）与其下「步骤任务」的两实体关系** + **统一的条件表达式引擎**（步骤执行条件 / 任务匹配条件共用）。
> 替代：`specs/pipeline-env-branch/design.md`（脚本拼装方案）已由本设计取代 —— 分支改为独立实体，不再拼写进脚本。

---

## 1 概念模型

```
流水线（deploy_pipelines）
 └─ 步骤（节点 step，deploy_pipeline_step_commands）   1 行 = 流程中的一个步骤（如「发布 release」）
     ├─ 执行条件 condition（可选）                     不满足 → 整个步骤跳过，流程继续
     └─ 步骤任务 branch（deploy_pipeline_step_branches） 1:N
         名称 + 匹配条件 condition（空=默认任务） + 脚本 → 运行时命中第一个为真的任务执行
```

**为什么是两个实体**：分支是「同一件事的不同做法」（本机 cp / 远程 scp），它们平级、可独立增删改与审计；塞进一段脚本会让「运行了哪个分支」只能靠读日志 + 字符串反解得知。

---

## 2 条件表达式（一处实现，两处使用）

```
expr   := term (&& term)*
term   := KEY op VALUE
op     := == | !=
KEY    := [A-Za-z_][A-Za-z0-9_]*        （执行变量，如 DEPLOY_ENV / MODULE_TYPE）
VALUE  := [A-Za-z0-9._/@:-]+ | '引号串'  （支持含空格的引号值）
```

- **不做**任意脚本求值（不 `eval`、不 `bash -c` 判真假）：可静态校验、可单测、无注入面。
- 取值来自执行期变量：内置（`DEPLOY_ENV` / `MODULE_KEY` / `MODULE_TYPE` / `BRANCH` / `COMMIT_ID` / `STAGE` / `PORT`…）+ 流水线变量 + 配置中心注入值。
- 变量缺失 → 视为空串参与比较（`DEPLOY_ENV != prod` 在变量缺失时为真）。

两处用法：

| 用法 | 位置 | 不满足时 |
|---|---|---|
| **步骤执行条件（gate）** | `deploy_pipeline_step_commands.condition` | 跳过整个步骤（日志记「执行条件不满足，已跳过」），流程继续 |
| **任务匹配条件** | `deploy_pipeline_step_branches.condition` | 继续匹配下一个任务 |

- **表达式非法 → 该步骤 fail-fast**（不静默放行，避免「看着配了其实没生效」）。

---

## 3 存储

### 3.1 新表 `deploy_pipeline_step_branches`

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | uuid PK | |
| `template_id` | varchar(64) | 流水线 ID（沿用历史列名 `template_id`） |
| `node_key` | varchar(32) | 所属步骤 |
| `name` | varchar(64) | 任务名（如 `local` / `dev`） |
| `label` | varchar(128) NULL | 展示名（如「本机投递」） |
| `condition` | varchar(255) NULL | 匹配条件；**NULL/空 = 默认任务（兜底）** |
| `script` | text | 任务脚本（自包含，自带 `set -euo pipefail`） |
| `sort` | int default 0 | 匹配顺序（小的先判） |
| `enabled` | tinyint default 1 | |
| `updated_by` / `created_at` / `updated_at` | | |

唯一键：`(template_id, node_key, name)`；索引 `(template_id, node_key, sort)`。

### 3.2 改表 `deploy_pipeline_step_commands`

| 列 | 说明 |
|---|---|
| `condition` varchar(255) NULL | 步骤执行条件（gate） |

两处均由 `synchronize` 随 console 启动自动建立，无需手工 DDL（迁移脚本仍需备份 + 幂等，见 §6）。

---

## 4 执行语义

```
执行某步骤（nodeKey）：
  1) 读 step row（含 condition）
  2) condition 非空：
       - 求值失败（表达式非法） → 步骤 failed（不静默放行）
       - 求值为 false           → 记日志「执行条件不满足，已跳过」→ 步骤 skipped，继续下一节点
  3) 有 enabled 步骤任务：
       - 按 sort 逐个求值：第一个为真的任务命中 → 执行其 script（作为 shell action）
       - 全部不命中：存在默认任务（condition 为空）→ 用它；否则步骤 failed
         （日志含「未命中任何任务，且未配置默认任务」+ 提示去哪里配）
  4) 无步骤任务 → 现状行为：actions / command 执行体（零破坏）
  5) 命中任务后，节点内**非 shell 操作照常执行**
     —— 关键：release 的 `write-version`（写版本记录）不能因为走了某个分支而被绕过
```

> 默认任务的语义 = 「其余情况」：迁移时把原 `*) 其他 → scp` 的通配语义落成默认任务（§6）。

---

## 5 接口

| 方法 | 路径 | 语义 |
|---|---|---|
| `GET` | `/api/pipeline-templates/:id/steps/:nodeKey/branches` | 任务列表（含 condition / script / sort） |
| `PUT` | `/api/pipeline-templates/:id/steps/:nodeKey/branches` | 批量保存任务（全量覆盖；逐条 `bash -n` + 条件表达式校验） |
| `DELETE` | `.../branches` | 清空分支（回落到 §4-4 现状行为） |
| `PUT` | `/api/pipeline-templates/:id/steps/:nodeKey` | 现有接口加 `condition`（步骤执行条件）与保留 `command` / `actions` |

保存前校验：条件语法、同一节点内**同名重复**、默认任务至多一个、`bash -n`。

---

## 6 迁移

`scripts/migrations/p15-step-branches.mjs`（幂等，`DRY_RUN` 支持）：

1. 备份受影响行到 `/tmp/p15-backup-<ts>.json`。
2. 把 `admin 发布` 的 release 的两段分支落成两行任务：
   - `local`：`condition = DEPLOY_ENV == local`，script = 本机 cp
   - `dev`：**默认任务**（`condition = NULL`），script = 远程 scp（承接原通配兜底语义）
3. 清空该节点的 `env_branches`（旧拼装配置）与由它生成的单一执行体，保留 `actions` 中的 `write-version` 操作。
4. 完成后重跑 → 零差异。

---

## 7 前端

- **画布**：维持分支分叉展示（数据源改为任务列表；默认任务块标注「默认」）。
- **抽屉**：「步骤任务」列表 —— 每任务一行（名称 / 条件 / 脚本 / 默认标记 / 删除 / 上下移）+ 新增；「高级」Tab 放步骤执行条件（原型稿 `docs/ui/prototypes/pipeline-env-branch-canvas.html`）。
- 节点 gate 与任务条件共用表达式输入组件（快捷模板 + 可用变量提示）。

---

## 8 验收

| 判据 | 方法 |
|---|---|
| V1 条件引擎 | 单测：`==` / `!=` / `&&` / 缺失变量 / 引号值 / 非法表达式抛错 |
| V2 任务选择 | 单测：命中第一个为真 / 全不命中用默认 / 无默认且无命中 → failed / 非 shell 操作不被绕过 |
| V3 接口 | PUT 任务列表 → 回读一致；重复名 / 多个默认 / 语法错脚本 → 400 并给出字段级原因 |
| V4 端到端命中 | admin + `env=local` → 走 local 任务，产物落本机 `modules/admin/local/<commit>/`，且写版本记录仍在 |
| V5 端到端默认 | admin + `env=dev` → 走默认任务（scp） |
| V6 gate 跳过 | 给某步骤配 `DEPLOY_ENV == prod` → 发 `local` → 日志「执行条件不满足，已跳过」，后续节点照常，`status=succeeded` |

---

## 9 回退

- 清空某节点的任务行 → 回落到 §4-4（单一执行体）行为。
- 删 `condition` 列值 → 步骤无条件恒执行。

---

## 常见问题

**Q：为什么条件不做脚本求值？**
A：`eval "$cond"` 会把流水线配置变成任意代码执行面；DSL 可静态校验、可单测，改动面还可控。需要复杂判断时，把判断写进**任务脚本内部**即可（脚本本来就能做任意逻辑）。

**Q：默认任务和「未配环境的 fail-fast」冲突吗？**
A：不冲突 —— 默认任务**存在**就是显式兑底；没有默认任务时全不命中才 fail-fast（保持「不静默猜」的口径）。
