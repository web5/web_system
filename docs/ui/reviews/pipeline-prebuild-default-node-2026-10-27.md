# D3 实现一致性评审 · 流水线新建默认节点序列（后台含预构建）

- 日期：2026-10-27
- 规格：`specs/deploy-console/page-spec-pipeline-prebuild-node.md`
- 拍板依据：2026-10-27 Q1-Q5（`docs/development/reports/2026-10-27-prebuild改可选步骤-方案待确认.md` §9）
- 评审方式：git diff 审计 + tsc + jest 独立复跑（非新增视觉稿，无页面截图项）

## 一致性矩阵

| 规格条目 | 实现落点 | 结论 |
|---|---|---|
| 行为1：be 默认序列含「拉取→预构建→构建→发布确认→发布」 | `pipeline.stages.ts` `defaultNodesFor('be')` → [git, prebuild, build, gate, release] | ✅ 一致 |
| 行为2：prebuild 为普通 shell 节点，可删、无内置执行体 | `{ kind:'shell', key:'prebuild', label:'预构建' }`；后端 PrebuildExecutor 已删、注册表/DI 已清 | ✅ 一致 |
| 行为3：创建后预置脚本进 deploy_pipeline_step_commands，失败不阻塞 | `PipelineEdit.vue` `prefillPrebuildScript(id)` → `pipelineStepApi.save(id,'prebuild',{command:'node scripts/prebuild-workspace-deps.mjs'})`，try/catch 吞错，仅 be 且画布仍含节点才预置 | ✅ 一致 |
| 行为4：fe / 未选不含 prebuild | `defaultNodesFor` 仅 `'be'` 分支 push prebuild | ✅ 一致 |
| 行为5：既有流水线 / API 直建不受影响 | 仅新建态 `load()` 走 `defaultNodesFor`；legacyToNodes / API 默认路径未触碰 | ✅ 一致 |
| 范围：无视觉样式变更 | PipelineEdit.vue 改动仅为函数替换 + 新增预置调用；无模板/样式 diff | ✅ 一致 |

## 独立验证记录

- `npx tsc --noEmit`（servers/deploy-console）：0 error
- deploy-console jest 全量：105 套件 / 1293 用例绿
- apps/deploy-console `pipeline.stages` jest：3/3 绿（含「非后台不含 prebuild」「prebuild 无平台保留语义」）

## 阻塞项

**0**。

## 边界声明

本报告为实现-规格一致性审计（执行者实现、负责人 diff 核验后出具），不冒充独立人审；补丁仍须人工评审（橙子哥哥）后合入。
