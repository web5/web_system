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
| CLAUDE.md | CODEBUDDY.md（+ 触发规则 `.codebuddy/rules/ui-interface/`） | ✅ 已具备 |
| Skills | agent-kit 13 个技能（rd-* / 需求 / 原型 / 调试 / 验证…）+ 项目专属 be/fe-developer | ✅ 已具备 |
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

> ⚠️ 2026-09-07 更新：机器化红线（任务 2 改造版）+ Evals 运行体（任务 4 改造版）已有**完整部署设计**，
> 见 `docs/development/ai-native-sdlc-ci-deployment.md`（M1/M2 任务拆分 + 验收 + 落地方位）。下方为原任务简述。
>
> ⚠️ 2026-09-10 收敛：数字人能力统一为**唯一能力源 `.codebuddy/agent-kit/` + 运行源镜像**；
> `.codebuddy/evals/`、`.codebuddy/rules/tcb/`、`.codebuddy/archived/` 已删除，kit-gate 的评测报告门禁改为 S7「运行源 ↔ 能力源零漂移」检查。
> 后续专项能力（如日志排查）按需再加。

#### 任务 2：Hook 等效实现（git + CI 守门）→ 已细化为 CI 部署文档 §2（M1）
- 目标：红线从「规则文本」变成「机器检查」，治微前端部署等反复踩坑问题。
- 做法：零依赖原生 `.githooks/pre-commit`（本地秒级 R1~R4）+ `.github/workflows/quality-gate.yml`（PR 门禁：R1~R5 红线扫描 + 改动包 build/test）+ `scripts/redline/*` + `scripts/ci/changed-packages.sh`。
- 验收：提交含 `console.log`/`.env` 被拦；改动包 build 失败 → PR 无法 merge。
- 涉及：`.githooks/`、`scripts/redline/`、`scripts/ci/changed-packages.sh`、`.github/workflows/quality-gate.yml`

#### 任务 3：REVIEW.md（PR 审查顺序）
- 目标：PR 审查有固定顺序，不凭经验。
- 做法：`docs/development/REVIEW.md` 规定：**先逻辑错误 → 再安全（对照 CODEBUDDY.md 安全铁律）→ 最后对照 spec/plan 确认没跑偏**；并把该顺序写入 `rd-review/SKILL.md`。
- 验收：rd-review 输出报告按三段式结构。
- 涉及：`docs/development/REVIEW.md`、`.codebuddy/skills/rd-review/SKILL.md`

### 第二批：需投入但收益稳定

#### 任务 4：Evals（回归评测）→ 已细化为 CI 部署文档 §3（M2）
- 目标：换模型/改规则后防退步。
- 做法（web_system 作为消费方）：`scripts/redline/check-kit-structure.sh`（S1~S7 结构守护，含运行源↔能力源零漂移）+ `.github/workflows/kit-gate.yml`（CI 执行同一份检查）。**完整评测（L2~L4）全部在 ai-agent-kit 源仓库跑**（工具已齐），本仓库不再设评测报告区。
- 验收：运行源与能力源不一致 → PR 被拦；删 skill 文件 → 结构检查失败。
- 涉及：`scripts/redline/check-kit-structure.sh`、`scripts/sync-agent-kit.sh`、`.github/workflows/kit-gate.yml`

### 第三批：暂缓（成本 > 当前收益）

- 任务 5：发布权限门（已有人审环节 `pub:prod` 手动执行，暂不上具名授权机制）
- 任务 6：线上监控自动回灌（等有监控告警体系后再做）

## 四、成本提示

- 方法论最大争议：token 与账单暴涨。控制手段：Evals 只跑场景集不跑全量；intent/spec 文件控制篇幅；子代理完成即释放上下文（现有 team 模式已具备）。

## 五、参考

- 方法论原文：《The AI Native SDLC playbook》（Anthropic 应用 AI 团队博客）
- 本文档对应的项目体系：`.codebuddy/CODEBUDDY.md`、`.codebuddy/skills/rd-digital-agent/`、`specs/`、`.github/workflows/auto-pr.yml`
