# 流水线节点的「环境分支」可编辑配置

> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
> 定位：发布（release）节点按环境分叉的**配置与编辑器**设计 —— 每环境一段脚本，页面增删改，保存时拼装成单一执行体。
> 配套：`specs/pipeline-release-config/design.md`（配置完善：REPO_URL / admin 线合并）、`specs/pipeline-env-scripts/design.md`（env 列备选方案，本设计不采用）

---

## 1 背景

- 2026-09-20 用户口径：**同模块只保留一条流水线，构建一致，只有发布节点因目标机器不同而不同**；且要求「后续增加环境分支，直接改流水线脚本」。
- p13 已在脚本内落了 `case $DEPLOY_ENV`（local=本机 cp / 其他=scp），但**页面没有任何体现** —— 用户看不到「这条线在各环境走哪段脚本」，也无从新增分支。
- 直接改整段脚本有两个坑：① 执行体在 `actions[shell].code`，只改 `command` 列不生效（p13 已实测复现）；② 分支逻辑埋在长脚本里，改一处要读全段。

---

## 2 目标 / 非目标

**目标**

1. 节点脚本支持「每环境一段」，页面可增删改（新增环境 = 加一个分支）。
2. **真相源 = 环境分支配置**；`command` 列与 `actions[shell].code` 由它**生成**，杜绝「改了不生效」。
3. 未配置脚本的环境 → **fail-fast**（用户选定：强制显式配置，不做静默回落）。
4. 保留节点内非 shell 操作（如 `write-version`）不受影响。

**非目标**

- 不给 `deploy_pipeline_step_commands` 加 `env` 列、不为每环境建一行（备选方案，本设计不采用）。
- 不改执行链路：`runStageCommand` / `pickStepActions` 语义不变（仍取单一执行体）。
- 不同步云库（本地验证优先）。

---

## 3 设计

### 3.1 存储

`deploy_pipeline_step_commands` 增加一列（`synchronize` 自动加）：

| 列 | 类型 | 说明 |
|---|---|---|
| `env_branches` | json NULL | `{ "<envId>": "<该环境脚本>" }`；NULL/空 = 未启用环境分支（沿用现状单一脚本） |

- 仅对**可执行脚本节点**开放（release / build / git 等；平台托管节点 `locked=true` 不开放）。
- 写路径唯一：保存环境分支 → 拼装 → 同时更新 `command` 与 `actions[shell].code`（保留其余 service 操作）。

### 3.2 拼装规则（纯函数，可单测）

```bash
#!/usr/bin/env bash
# 自动生成：由「环境分支」配置拼装（勿手改 —— 改请到节点编辑器 → 环境分支）
# 环境脚本未配置 → fail-fast（不做静默回落）
set -euo pipefail
: "${DEPLOY_ENV:?缺少 DEPLOY_ENV（发布必须指定环境）}"

# ── 分支体（每段是完整脚本，互不共享变量，避免环境间耦合）──
__branch_local() {
<local 段脚本>
}
__branch_dev() {
<dev 段脚本>
}

case "$DEPLOY_ENV" in
  local) __branch_local ;;
  dev) __branch_dev ;;
  *)
    echo "[env-branch] 环境 $DEPLOY_ENV 未配置发布脚本" >&2
    echo "[env-branch] 处置：流水线编辑 → release 节点 → 环境分支 → 新增该环境脚本" >&2
    exit 1
    ;;
esac
```

- 函数名 `__branch_<envId>`：envId 白名单 `[A-Za-z0-9_-]{1,32}`，非法即拒绝保存（防拼装出坏语法）。
- 每段是**自包含脚本**（自带 `set -euo pipefail` 与变量计算），包在函数里 → 环境间零耦合，`set -e` 在函数内生效并向外传播。
- 未配环境一律落进 `*)` 分支 → **fail-fast**。

### 3.3 接口

`PUT /api/pipeline-templates/:id/steps/:nodeKey`（现有接口扩展 body）：

| 字段 | 语义 |
|---|---|
| `envBranches` | `{ "<envId>": "<script>" }`；传了即启用环境分支（覆盖旧配置），传 `null` 关闭 |
| `command` | 兼容旧调用：不传 envBranches 时按原样存（单一脚本） |

返回体带 `generated`（bool）与 `envs`（已配置环境列表），供前端回显。

保存前校验：每段 `bash -n`（复用 `PipelineStepCommandService.validate`）+ envId 白名单；拼装结果整体再 `bash -n` 一次。

### 3.4 前端（流水线编辑 → 节点）

- 节点开启环境分支后，脚本区改为「环境分支」列表：每行 = 环境（下拉，来自 `envsApi.list()`，含自建环境）+ 代码编辑框 + 删除；
- 「+ 添加环境分支」选择未配置的环境；
- 顶部提示：**保存后脚本由分支配置生成，手工改脚本会在下次保存时被覆盖**；
- 未启用时保持现有单脚本编辑（零破坏）。

---

## 4 影响面

| 位置 | 改动 |
|---|---|
| `entities/deploy-pipeline-step-command.entity.ts` | 新增 `envBranches` json 列 |
| `pipeline/steps/env-branch.ts`（新） | 拼装 + 反向解析（纯函数） |
| `pipeline-step-command.service.ts` | upsert 支持 envBranches：校验 → 拼装 → 写 command + actions[shell].code |
| `pipeline-step-command.controller.ts` | PUT body 扩展；GET 返回 envBranches |
| `apps/deploy-console/src/views/PipelineEdit.vue` | 环境分支编辑器 |
| `scripts/migrations/p14-env-branches-seed.mjs` | 把 admin-dev 现有 case 脚本拆成 `local` / `dev` 两段落库 |

---

## 5 验收

| 判据 | 方法 |
|---|---|
| V1 拼装 | 单测：多分支 / 单分支 / 非法 envId 拒绝 / 未配环境落 `*)` 且 fail-fast / 拼装结果 `bash -n` 通过 |
| V2 接口 | PUT envBranches → 回读 `command` 与 `actions[shell].code` 均为拼装结果，`write-version` 操作仍在 |
| V3 页面 | 编辑页显示两个分支（local / dev），新增第三个环境分支后保存，库里出现三段 |
| V4 端到端（命中） | 提交 admin + `env=local` → 执行 `__branch_local`（本机 cp），产物落本机 `modules/admin/local/<commit>/` |
| V5 端到端（未配） | 删掉 `local` 分支 → 提交 `env=local` → **failed**，日志含「未配置发布脚本」 |

---

## 6 回退

- 删掉 `envBranches`（置 NULL）→ 节点回落到「单一脚本」形态，执行体为最后保存的 `command`/`actions.code`。
- 迁移脚本备份改写前正文到 `/tmp/p14-backup-<ts>.json`。

---

## 常见问题

**Q：为什么不给 `deploy_pipeline_step_commands` 加 `env` 列、每环境一行？**
A：那需要改执行链路的解析（三级回落）与唯一键；本方案执行体仍是单一脚本，引擎零改动，且「页面所见 = 实际执行」由拼装保证。

**Q：环境分支和「一环境一条流水线」的区别？**
A：后者会让流水线按 模块×环境 爆炸（已否决）；分支是**同一条流水线内的脚本分叉**，构建/重启/探活节点共享，只有发布逻辑按环境分。
