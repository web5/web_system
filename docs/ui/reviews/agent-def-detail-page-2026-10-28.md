# D3 实现一致性评审 · Agent 定义详情页形态（B3 调参 UI 弹窗 → 详情页）

- 日期：2026-10-28
- 规格：`docs/ui/page-specs/agent-def-detail-v2.md`（信息架构 v2；v1 弹窗版 `agent-def-generation-params-v1.md` 已废弃）
- 原型：`docs/ui/prototypes/admin-agent-def-detail.html`（屏② 高级 · 模型参数调试）
- 拍板依据：2026-10-28 用户意见「调参配置界面不是新页面，是弹窗，不是最开始的设计定义的交付」→ 形态回归 v2
- 评审方式：git diff 审计 + vue-tsc + jest 独立复跑 + Chrome 无头逐项断言（25/25）+ 截图目检

## 一致性矩阵

| 规格条目 | 实现落点 | 结论 |
|---|---|---|
| IA-1 列表「编辑」进入独立详情页（非弹窗），面包屑可回列表 | `AgentDefList.vue` `goEdit()` → `router.push('/agents/definitions/:id')`；`AgentDefDetail.vue` `a-page-header @back` 返回列表；编辑弹窗代码整体删除，无双入口 | ✅ 一致 |
| IA-2 表单拆两卡：基础配置（默认展开）/ 高级（默认折叠） | `AgentDefDetail.vue` `a-collapse` 两 panel，`activeCards=['basic']`；基础卡含 ID/名称/用途说明/路由关键词/模型/能力配置/System Prompt/记忆/流式 | ✅ 一致 |
| IA-3 高级卡内「模型参数调试」工作台 = 左参数面板 + 右调试台 | 高级 panel 内 `a-row` 两列：左 `AgentTuningPanel`（五控件+三联动+策略预览），右调试台（本期占位，含 §2.1 组件契约标注） | ✅ 一致（调试台分期，见下方边界声明） |
| 五控件 + budget 只读展示 + 三联动 + 超管门禁 + 审计 diff | `AgentTuningPanel.vue` / `TuningAuditList.vue` 原组件迁移挂载（控件语义/校验/接口沿用 `tuning-params.ts` T1–T10 口径）；高级卡整体 `v-if="isSuperAdmin"` | ✅ 一致 |
| 契约 C7-b 互斥 / C7-c null 语义 / C7-e 不预填 0.7 / C7-h 传了才覆盖 | `agent-def-form.ts` `defToForm`/`defaultAgentForm`（temperature 空值保持 null）；`tuning-params.ts` `validateTuning` 同填报错不清值；`thinkingToApi` 显式三态 | ✅ 一致 |
| v1 弹窗版废弃 | `AgentDefList.vue` 编辑/新建弹窗已删；新建走 `/agents/definitions/new`（同详情页组件 create 形态） | ✅ 一致 |
| 无弹窗残留（表单路径） | 无头断言 IA-1a/IA-1c/IA-4：列表与详情页 `.ant-modal` 均为 0（版本历史弹窗与编辑表单无关，保留） | ✅ 一致 |

## 独立验证记录

- `npx vue-tsc --noEmit`（apps/admin）：0 error
- apps/admin jest 全量：7 套件 / 82 用例绿（tuning-params 45 + agent-def-form 12 + 既有 25）
- lint:ci：0 error / 75 warnings（较改动前 86 净降，新文件 0 warning）
- 无头 Chrome 断言 25/25：编辑=路由跳转 / 两卡默认态 / 高级内左参数右调试台 / 无弹窗残留 / S1 带工具默认 enabled+budget 公式 / S2 空值不预填 / S3 误配红字 / S4 同填拒存不清值 / S5 普通管理员无高级卡 / S6 保存 Toast+审计 diff+payload 无 budget_tokens / 新建路由可达
- 截图目检：页面头（返回/标题/状态版本/放弃更改/保存）+ 两卡布局正常，浅色 admin 风格（--ws-* token）

## 附带修复（预存缺陷，本次依赖其可见性）

| 问题 | 修复 | 影响面 |
|---|---|---|
| `PageHeader` 未注册（7 个视图 `a-page-header` 的标题/操作按钮此前从未渲染，保存按钮不可达） | `plugins/antd.ts` 注册 `PageHeader` | 全 admin 页头恢复渲染（预期行为） |
| `Collapse` 未注册（两卡形态依赖） | `plugins/antd.ts` 注册 `Collapse` | 新增能力 |
| `token-separators` 传字符串致 `some is not a function` | 改数组绑定 `:token-separators="[',','，','、']"` | 修运行时报错 |

## 边界声明

1. **调试台（对话试跑 / 调参测试用例表）本期为占位**（分期二期）：右列空态 + §2.1 消息组件契约标注（Turn/Bubble/AnswerBlocks/ProcCard 同构、blocks 渲染禁 `<br>` 拼串）。表单两卡形态与参数面板本期交付。
2. v2 §3.2 label 左置栅格（84px flb）未逐像素复刻——沿用 admin 既有 antd vertical 表单排版；信息架构与字段集一致。
3. v2 §4 三级参数对比（字段级 diff badge / sticky 变更条 / 结果级双列）未含在本期（与调试台同属二期）；审计 diff 已具备字段级改前→改后 + 运行时生效值。
4. 预设档位（§3.1）为 v1 遗留演进项，B3 五控件口径不设预设下拉，未实现。

## 阻塞项

**0**。
