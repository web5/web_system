# AI Native SDLC 落地计划（Anthropic Playbook）

> 来源：Anthropic《The AI Native SDLC playbook》（2026-08-26 转载于腾讯新闻）。
> 本文档是把方法论映射到 web_system 研发体系后的落地结论，作为后续工程化任务的 backlog。

## 一、方法论核心（摘要）

- 瓶颈已从「写代码」转移到「流程」：评审、测试、发布仍停留在人工作业速度。
- 核心架构：从「单向流水线」改为「循环（Loop）」，每个阶段提交**版本控制的产物**，下一阶段自动读取：

| 阶段 | 产物 |
|------|------|
| Plan | intent.md（意图文档） |
| Design | spec.md（规格文档） |
| Build | plan.md（实现计划）+ 代码 + 测试 |
| Deploy | 带审查记录的 PR |
| Maintain | 事故记录 → 新 intent.md → 重新进入循环 |

- 人从「事事亲力亲为」变为「在关键节点审核 AI 的产出」。
- 三层规则体系：CLAUDE.md（项目避坑指南）→ Skill（某类活怎么干）→ Hook（红线自动拦截）。
- 注意：方法论带 Claude 产品生态路径，应**吸收流程判断，用现有工具实现**，不原封照搬。

## 二、现状映射（2026-09 盘点）

| Anthropic 方法论 | 现有体系 | 状态 |
|---|---|---|
| CLAUDE.md | CODEBUDDY.md + `.codebuddy/rules/tcb/`（100+ 规则） | ✅ 已具备 |
| Skills | 7 个 rd-* skills + 多个 user skills | ✅ 已具备 |
| Subagents | rd-digital-agent team 模式（brainstorm/plan/execute/review 独立上下文） | ✅ 已具备 |
| Plan Mode | rd-plan 输出 TODO 后等待用户确认 | ✅ 已具备 |
| spec.md | `specs/<feature>/{requirements,design,tasks}.md` | ✅ 已具备 |
| Test 反馈 | rd-execute TDD（红→绿→重构） | ✅ 已具备 |
| intent.md | brainstorm 结论仅在对话中，不落盘 | ❌ 缺口① |
| Hook | 无；红线靠 AI 自觉遵守规则 | ❌ 缺口② |
| Evals | 无；换模型/改规则无回归评测 | ❌ 缺口③ |
| REVIEW.md | 有 auto-pr.yml 自动建 PR，但无审查顺序规范 | ⚠️ 缺口④ |
| Deploy 权限门 | 有 `pub:dev`/`pub:prod` 脚本，无具名授权 | ⚠️ 缺口⑤（暂缓） |
| Maintain 监控回灌 | 无 | ❌ 缺口⑥（暂缓） |

**结论：已完成方法论 1/2/3 层主体，落地重点是三个缺口 + 审查规范。**

## 三、落地路线（按性价比排序）

### 第一批：低成本高价值（建议优先）

#### 任务 1：intent.md 版本化
- 目标：每个需求留下人机同读的版本化意图轨迹。
- 做法：
  - `rd-brainstorm/SKILL.md` 增加规则：输出方案前落盘 `docs/intents/<yyyy-mm-dd>-<feature>.md`（解决什么 / 给谁 / 哪些不做 / 成功标准）。
  - 与 `specs/<feature>/` 目录串联：intent 是 spec 的上游。
- 验收：任意新需求走 brainstorm 后，`docs/intents/` 下存在对应文件，且 spec 引用其路径。
- 涉及：`.codebuddy/skills/rd-brainstorm/SKILL.md`、`docs/intents/`

#### 任务 2：Hook 等效实现（git + CI 守门）
- 目标：红线从「规则文本」变成「机器检查」，治微前端部署等反复踩坑问题。
- 做法：
  - 加 `pre-commit` hook：拦截 `.env`、token 类敏感文件进 git（根 `.env` 有 `GITHUB_PR_TOKEN`）。
  - 加 lint-staged：commit 前自动跑 eslint + typecheck。
  - `auto-pr.yml` 增加 CI 门禁：`pnpm build` + 单测必须绿才可 merge（当前仅自动建 PR，无检查）。
- 验收：提交含 `.env` 的变更被拒；PR 未过 lint/build 无法 merge。
- 涉及：根 `.git-hooks/` 或 husky、`lint-staged`、`.github/workflows/auto-pr.yml`

#### 任务 3：REVIEW.md（PR 审查顺序）
- 目标：PR 审查有固定顺序，不凭经验。
- 做法：`docs/development/REVIEW.md` 规定：**先逻辑错误 → 再安全（对照 CODEBUDDY.md 安全铁律）→ 最后对照 spec/plan 确认没跑偏**；并把该顺序写入 `rd-review/SKILL.md`。
- 验收：rd-review 输出报告按三段式结构。
- 涉及：`docs/development/REVIEW.md`、`.codebuddy/skills/rd-review/SKILL.md`

### 第二批：需投入但收益稳定

#### 任务 4：Evals（回归评测）
- 目标：换模型/改规则后防退步。
- 做法：从归档踩坑提炼 8-10 个高频场景（CORS 硬编码 `*`、异常过滤器缺失、微前端版本表写错库、console.log 残留、`.env` 提交…），做成 `scripts/evals/` 下的检查清单 + 自动检测脚本。
- 验收：`pnpm evals` 一键跑完场景集，输出通过率。
- 涉及：`scripts/evals/`、根 `package.json` scripts

### 第三批：暂缓（成本 > 当前收益）

- 任务 5：发布权限门（已有人审环节 `pub:prod` 手动执行，暂不上具名授权机制）
- 任务 6：线上监控自动回灌（等有监控告警体系后再做）

## 四、成本提示

- 方法论最大争议：token 与账单暴涨。控制手段：Evals 只跑场景集不跑全量；intent/spec 文件控制篇幅；子代理完成即释放上下文（现有 team 模式已具备）。

## 五、参考

- 方法论原文：《The AI Native SDLC playbook》（Anthropic 应用 AI 团队博客）
- 本文档对应的项目体系：`.codebuddy/CODEBUDDY.md`、`.codebuddy/skills/rd-digital-agent/`、`specs/`、`.github/workflows/auto-pr.yml`
