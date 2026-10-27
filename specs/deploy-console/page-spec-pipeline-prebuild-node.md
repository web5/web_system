# 流水线新建默认节点序列（后台含预构建）规格

## 范围

PipelineEdit 新建态默认节点序列按模块类型分化（Q3，2026-10-27 拍板，见 `docs/development/reports/2026-10-27-prebuild改可选步骤-方案待确认.md` §9）。不改变画布交互、节点抽屉、保存流程、路由与既有流水线编辑态行为；无视觉样式变更。

## 行为

1. 新建后台（moduleType='be'）流水线，默认节点序列：拉取代码 → 预构建 → 构建 → 发布确认 → 发布。
2. 「预构建」是**普通 shell 节点**（key=prebuild，label=预构建）：可删除、无删除保护、无平台内置执行体、无 watchdog（A 案去内置，Q1）。
3. 创建成功后连同节点一起预置**自包含多行 bash 脚本**（`prebuildScriptBody`：`set -euo pipefail` + 显式 `cd "${RELEASE_DIR}"` + 全量扫 `packages/*` 的 isStale 判定重建，带 `[prebuild]` 日志与 `.build.lock` 并发锁；**不依赖**仓库内任何 `.mjs`/`.sh` 文件，node 只当 JSON 工具读 package.json）写入 `deploy_pipeline_step_commands`（流水线 × 节点 key 真相源）；`timeoutSec=900`（与 build 一致）；创建前已从画布删除该节点则不预置；预置失败不阻塞创建（与既有 `prefillBuildScript` 同策略）。
4. 新建前端/小程序（'fe' / 未选类型）流水线，默认序列**不含**预构建节点。
5. 既有流水线编辑态（legacyToNodes 转存路径）不受影响；API 直建（nodes 未传）仍走 legacy 九阶段默认，不含 prebuild（§9 明确不做 OPTIONAL_STAGES）。

## 验收

- `defaultNodesFor('be')` 含 prebuild 且位于 git 与 build 之间；`defaultNodesFor('fe')` / `defaultNodesFor('')` 不含。
- prebuild 节点为 kind=shell，无平台保留语义（可删）。
- 预置脚本正文为纯 bash（`bash -n` 通过；`undeclaredVars` 无报警，`RELEASE_DIR` 属 PLATFORM_VARS）；`scripts/prebuild-workspace-deps.mjs` 已删除，仓内无对它的引用。
- 单测：`apps/deploy-console/src/components/pipeline/pipeline.stages.spec.ts` 3 用例。
- 后端回归：deploy-console jest 全量绿（去内置化后 legacy 9 阶段口径）。

一致性证据与边界见 `docs/ui/reviews/pipeline-prebuild-default-node-2026-10-27.md`；补丁仍须人工评审，不把执行者自查当作额外人审。
