---
name: wb-auto-deliver
kind: orchestrator
description: web_system 全自动交付编排中枢 — 把一句自然语言需求接到 rd-* 全链路（需求→方案→实现→测试→发布 dev），自动 git 收口到 feature/<slug> 触发 CI；按改动类型分 Tier1(零人) / Tier2(人审卡点)。人审节点通过企业微信/WorkBuddy 通知推到手机确认，发布目标为 dev（dev.kedouai.com 可公网访问，手机随时远程校验）。本 skill 只编排，不写业务代码，具体环节委派 rd-digital-agent 子技能。
version: 0.2.0
loads: rd-digital-agent（委派子技能）
---

# WB 全自动交付编排中枢（v0.2 — 发布 dev + 手机远程校验 + 企业微信确认）

> 本 skill 是**编排者**，不是实现者。它把 web_system 已有的 `rd-*` 全链路 + GitHub Actions 收口串成一条从"需求"到"发布 dev"的自动线。
> 真正的设计/编码/测试由 `rd-digital-agent` 的子技能完成；本 skill 负责：分档、人审卡点（推企业微信/WorkBuddy 通知、等手机确认）、git 收口、发布 dev、汇报。

## 两个核心设计点（来自用户拍板）

1. **发布目标 = dev（不是只发 local）**：合并后通过既有 `release.yml`（`workflow_dispatch env=local`）把代码部署到 dev 机（`175.27.189.123` = `dev.kedouai.com`）。手机开 `https://dev.kedouai.com/...` 即可随时远程校验功能。
2. **人审卡点 = 推到手机确认**：方案确认 / 放行上线等人审节点，先把 artifact（方案/原型/发布评审报告）推到**企业微信 + WorkBuddy 通知**，你在手机上看到后回"通过"流程才继续。不在电脑前也能审。

## 触发

- 用户派活："实现 X" / "自动交付 Y" / 周期性需求（由 `automation` 触发）。
- 加载方式：直接调用本 skill；内部按需加载 `rd-digital-agent` 并委派其 `requirement-translation` / `rd-brainstorm` / `rd-plan` / `rd-execute` / `rd-review` / `test-verification`。

## 编排流程（顺序不可跳）

| 步 | 做什么 | 委派 / 动作 |
|----|--------|-------------|
| 0 | 需求 intake | `requirement-translation` → 产出需求 spec（验收判据 + 反例 + 待确认） |
| 1 | 方案 + 验证判据表 V1…Vn | `rd-brainstorm` → `rd-plan` |
| 2 | **[人审① 方案确认]** | 暂停 → 推**企业微信/WorkBuddy 通知**呈交方案/原型 → 等手机回"通过" |
| 3 | 实现（TDD）+ 自查 | `rd-execute` → `rd-review` |
| 4 | 测试（独立盲测） | `test-verification`（按 V1…Vn 构造反例打产物） |
| 5 | **[人审②/③ 视改动类型]** | 命中 UI/契约/发布门禁才需要，同样推通知等确认 |
| 6 | 收口 | `git commit` + `git push feature/<slug>` → 建 PR（auto-pr/auto-merge 兜底） |
| 7 | **[发布 dev 远程校验]** | 合并后 `gh workflow run release.yml -f env=local` 部署到 dev.kedouai.com → 推通知 + dev URL → 手机校验后回"确认" |
| 8 | 汇报 | PR 链接 + CI 状态 + dev 探活证据 + 校验链接 |

## 门禁与分档（核心，不可省略）

在**步骤 1 末尾**判定改动类型，写入摘要，决定人审节点是否等人：

- **Tier1 零人**：纯后端 / 内部 / 配置改动（**不命中**下方任何门禁路径）→ 步骤 2/5 的人审节点**自动通过**（仍跑机器门禁 quality-gate），直达收口。
- **Tier2 人审**：命中任一门禁路径 → 步骤 2/5 在对应节点**暂停**，用消息 / `AskUserQuestion` 呈交 artifact（方案 / 原型稿 / 发布评审报告）等你确认，确认后才继续。

门禁路径（命中即归 Tier2，细则见项目 `.codebuddy/rules/` 与 `docs/`）：

- **UI 门**：`apps/admin/**` `apps/deploy-console/**` `apps/mcp-admin/**` 的 `.vue`、`packages/ui/**`、`apps/kedou-ai-minigram/**`（页面/组件/`app.json`/`*.wxml`/`*.wxss`）、`apps/portal/**` 的 `.vue`
- **契约门**：`packages/types/**`、`packages/agent-core/src/interfaces/**`、`scripts/migrations/**`、`servers/mcp-gateway/src/*/tools/**`、`servers/*/src/*/*.controller.ts`（对外接口）
- **发布/环境/数据门**：`ecosystem.config.cjs|js`、`servers/*/.env*`、`scripts/pipeline/**`、`servers/deploy-console/src/pipeline/**`、`scripts/publish-*.sh|deploy-*.sh|bootstrap.sh`、`scripts/migrations/**`、`.github/workflows/**`

> 红线（rd-digital-agent 硬规则）：**AI 无权替自己确认任何一件**。Tier1 的"自动通过"仅指不强制等人；Tier2 必须等人确认。删除契约前必须查 import 型消费方（grep `from '<包名>'` 后看 `switch case`）。

### 人审节点通知机制（推到手机确认）

Tier2 的每个暂停点（步 2 / 步 5 / 步 7 放行）必须做到：

1. **产出 artifact**：方案 spec / 原型稿链接 / 发布评审报告（落盘到 `docs/` 或 `specs/`，给可点开的路径）。
2. **推企业微信 + WorkBuddy 通知**：在对话里发出结构化确认请求（标题 + 摘要 + artifact 链接 + 待确认问题）。WorkBuddy 会把该消息推送到你的手机；`wecom` 企业微信若已绑定也会同步到达。
3. **等待确认**：**暂停流程，不继续**。直到你在对话里回"通过 / 确认 / approve / OK"才进入下一步；回"驳回 / 改"则回到被审环节重出 artifact。
4. **超时**：若 24h 无回复，发一次提醒通知；仍无回复则挂起并汇报，不擅自放行（安全护栏）。

> 说明：当前平台机制下，确认动作在**对话里回复**即生效（WorkBuddy 通知 + 企业微信同步送达手机）。若未来要做"企业微信里直接点按钮回执驱动 agent"，需接 wecom 回调钩子（见 §待办），本期不阻塞。

## git 收口规范（触发 CI 的关键）

- 分支命名：`feature/auto-<YYYYMMDD>-<slug>`（slug 用改动域，如 `auth-refresh`）。
  - ⚠️ **不能用** `feature/test` / `feature/kedou-ai-minigram`：`auto-pr.yml` 跳过这两者（不建 PR、不走评审）。
- commit trailer 按命中门补（CI R10–R16 兜底）：`Proto: <sha>` + `Design: pass` / `Release: pass` / `Contract: pass` / `Code: pass`；纯微调 `Micro-exempt: <理由>`；应急出口 `UI_GATE=off`。
- push 后**本 skill 不轮询 CI**（GitHub 自动合 + 发布）；汇报时给 `gh pr view --json url,state` 结果即可。
- 合并惯例为 **merge commit**（与仓库 `auto-pr.yml` / `auto-merge.yml` 一致）。

## 发布 dev 接线点（远程手机校验 · 默认启用）

目标：**合并后把代码部署到 dev 机（`dev.kedouai.com`，公网可达），手机随时打开就能校验功能**。

`release.yml` 的 self-hosted runner 就跑在 dev 机上（`RELEASE_HOOK_URL=http://127.0.0.1:6200` 即 dev 机的 deploy-console），故"发布 local"等价于"发布 dev"。触发方式（走治理路径，含审计/回滚）：

- **合并到 master 后**，用 `workflow_dispatch` 触发（不误用 `feature/test`，否则跳过 PR/评审）：
  ```bash
  # 在仓库根执行；env=local 即部署到 dev 机
  gh workflow run release.yml -f env=local -f modules="<改动模块,逗号分隔>"
  # 等发布完成并取状态
  gh run watch $(gh run list --workflow=release.yml --limit=1 --json databaseId --jq '.[0].databaseId')
  ```
- 模块 key 取 `servers/<svc>` 与 `apps/<app>` 的目录名（如 `gateway,auth-service,portal`）；不传 `modules` 时 release.yml 自动按最近一次 commit 的改动目录解析。
- **探活证据**（发布后必给）：`curl -sS -m 10 https://dev.kedouai.com/health` 或对应服务的 `/docs` 可达；并把校验用的具体 URL（如 `https://dev.kedouai.com/portal/xxx`）随通知推到手机。

> 设计取舍：dev 发布走 `workflow_dispatch env=local`（治理路径），**不**走 push `feature/test`（那会跳过 PR 与评审，破坏回滚能力）。feature 分支只用于开发 + PR。
> prod 发布：本 skill **不自动发 prod**（deploy-console 不在 prod，既定安全设计）。需要时在控制台手动审批。

### 备选：SSH 直发 dev（快速迭代，绕开治理）

若只要极速验证、不在乎审计/回滚，可 SSH 到 dev 机直接跑一键部署（凭证见 `~/env_config/servers.env`）：
```bash
ssh -i ~/.ssh/id_ed25519_servers ubuntu@175.27.189.123 \
  "cd /data/web_system && git pull && ./scripts/deploy-dev.sh <module>"
```
仅用于个人开发期快速看效果；正式交付仍走上面 `release.yml` 治理路径。

## 最小禁项（继承项目规则）

- 禁 `pm2 restart --update-env`（会固化错误配置来源）
- 迁移必须声明 `-- @database <db>`（否则落默认库）
- 发布 / 重启后必须有探活 / 冒烟证据
- 公开仓库 `web5/web_system` 去敏：脚本 / commit / 文档不写 IP、用户名、密钥路径、口令（见 `public-repo-secret-scrub`）

## 失败回流

- 任一子技能**阻塞项未清零** → 回到对应环节重做。
- `test-verification` 给出可复现反例 → 回 `rd-execute` 修复，测试不改码。
- 人审驳回 → 回到被审环节重出 artifact，评审不改码。

## 待办 / 增强（未阻塞本期）

- **企业微信原生回执**：当前确认靠"对话里回通过"；若要让企业微信消息本身带"通过/驳回"按钮并驱动 agent 继续，需接 wecom 回调钩子（workflow_dispatch 触发 agent 续跑）。本期用 WorkBuddy 通知 + 对话回复已满足"手机上确认"。
- **Tier2 异步化**：人审卡点目前暂停在对话上下文；若由 `automation` 触发，建议 automation 只跑 Tier1，Tier2 在交互会话里跑（否则 automation 难以等手机确认）。
- **dev 发布模块自动解析**：`workflow_dispatch` 的 `modules` 若不传，依赖 release.yml 按最近 commit 解析；多模块合并时建议显式传 `modules` 避免漏发。
