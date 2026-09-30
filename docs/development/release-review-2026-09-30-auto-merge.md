# 发布评审报告 · PR 自动合入兜底（2026-09-30）

阻塞: 0
重要: 2

> 触发面：`.github/workflows/**`（发布门禁触发面第 3 条）+ `docs/**`（判据文档）。
> 变更：新增 `.github/workflows/auto-merge.yml`；`auto-pr.yml` 的 `merge_method` squash → merge；
> `release-review-checklist.md` 新增判据 E4；`auto-merge-setup.md` 补合并形态说明。

## A. 运行面

| # | 结论 | 依据 |
|---|---|---|
| A1 | ✅ 通过 | workflow 由 GitHub Runner 从 `master` 分支的 `.github/workflows/` 加载，不依赖发布目录/工作区，无「改了不生效」风险 |
| A2 | ✅ 通过 | 文件在仓库默认分支；本地分支已 `git reset --hard origin/master`（9014d711）后再改动 |
| A3 | — | 不涉及 `packages/*` 构建 |
| A4/A5 | — | 不涉及端口与服务进程 |

## B. 配置面

| # | 结论 | 依据 |
|---|---|---|
| B1 | — | 不涉及 pm2 / 进程环境 |
| B2 | ⚠️ **重要 1**：依赖 Secret `AUTO_PR_TOKEN` | 与 `auto-pr.yml` 同源。该 PAT 为 fine-grained 且**会过期**；过期后本 workflow 与 auto-pr 会**双双显式失败**（有 `::error::` 修法文案），不会静默降级。已有先例（2026-09-24 事故）证明「静默回退 GITHUB_TOKEN」危害更大，故本 workflow 同样**不回退** |
| B3 | ✅ 通过 | 缺失即失败并给出配置路径，不做空值兜底 |
| B4 | ✅ 通过 | 无占位符密钥 |
| B5 | ✅ 通过 | 唯一配置源 = 仓库 Secret |

## C. 数据面

| # | 结论 | 依据 |
|---|---|---|
| C1–C5 | — | 无迁移、无 DB 改动 |
| C6 | ✅ 通过 | 变更可逆：删 workflow 文件即回到原状；`auto-pr.yml` 改动为单行参数，回滚成本一行 |

## D. 前端面

| # | 结论 | 依据 |
|---|---|---|
| D1–D4 | — | 不涉及版本指针与静态产物 |

## E. 特殊通道

| # | 结论 | 依据 |
|---|---|---|
| E1 | ✅ 通过 | 与 deploy-console 自部署链路无关（不碰 pm2/服务） |
| E2 | — | 不涉及后端 restart |
| E3 | ⚠️ **重要 2**：上线后须留验证证据 | 合并后需确认：新建测试分支 → `auto-pr`/`auto-merge` 均出现 job 且日志含「已启用自动合入（merge）」；对非 `fix/* feature/*` 分支（如本 PR 的 `chore/*`）验证兜底生效。若 `AUTO_PR_TOKEN` 过期，job 会红并给出修法 —— 属预期行为 |
| E4（新增判据） | ✅ 已纳入 | 本次同时在判据清单加入 E4「PR 已挂自动合入且方式为 merge commit」，后续发布评审可机检 |

## 安全边界

- 事件用 `pull_request`（非 `pull_request_target`），**不 checkout 任何被改动代码**，只调 REST API。
- `if` 限定 `head.repo.full_name == github.repository` → fork PR 直接跳过（也拿不到 Secret，不会误合外部代码）。
- draft PR 不挂自动合入。
- **不绕过任何门禁**：`enableAutoMerge` 只是「等绿了自动合」，branch protection 的必需 checks 与「分支与 master 同步」要求仍然生效；`enableAutoMerge` 调用失败降级为 `core.warning`，不阻断 CI。

## 合并形态决策（记录）

- 实测 `origin/master~0..7` 中 7/8 为双父节点 merge commit → 仓库惯例为 **merge commit**。
- 故 `auto-pr.yml` 由 `squash` 改为 `merge`，与新 workflow、与本地 `gh pr merge --auto --merge` 三者一致。
- `auto-merge-setup.md` 中「建议只保留 squash」已更正。

## 放行

阻塞项 0，重要项 2（均为需观察/留证，不阻断）。结论：**放行**，commit trailer 用 `Release: pass`。
