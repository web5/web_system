# .codebuddy/agent-kit · 上游 AI 协作资产（来源声明）

> 本目录**只放声明，不落内容**。AI 协作资产（常驻总则 / 红线 / 方法论）的唯一来源是上游仓库：
> **`https://github.com/web5/ai-agent-kit`**（`git@github.com:web5/ai-agent-kit.git`）

## 为什么不落内容

CodeBuddy 只按**仓库内路径**加载（根 `CODEBUDDY.md`、`.codebuddy/rules/`、`.codebuddy/skills/`），没有任何「按 URL 加载」的通道；方法论类文件属**按需读取**。因此本地不再保留副本，需要时按下表取用：

| 场景 | 怎么取 |
|---|---|
| 需要读方法论 / 红线 / 常驻总则 | `git clone https://github.com/web5/ai-agent-kit`（或直接在 GitHub 上打开对应文件） |

> 本文件不记录任何本地路径 —— 路径因机器而异，声明只写来源。

## 上游目录对应关系（本仓库不再落地）

| 上游路径 | 内容 | 本仓库现状 |
|---|---|---|
| `AGENT.md` | 常驻总则（资产分层 / 工作流 / 人审 / 产出纪律 / 工程纪律 / 红线） | 仅上游 |
| `rules/general/01–05` | 5 条机器化红线 | 仅上游 |
| `references/` | 方法论与通用能力包（`ai-methodology` / `code-discipline` / `eval-framework` / `be-dev-common` / `fe-dev-common` 等） | 仅上游 |
| `skills/` | 工作流技能（`rd-*` 等） | 本地实体在 `.codebuddy/skills/`（工具扫描路径） |
| `evals/` · `scripts/` · `.github/` | 评测体系与工具链 | 仅上游（本仓库不设评测报告区） |

## 契约

- 通用技能 / 规则 / 方法论**只在上游演进**，本项目只消费，不在此复制第二份。
- **技能实体只有一份**：`.codebuddy/skills/`。通用技能不得在本地改写；项目专属只允许 `be-developer`、`fe-developer`、`rd-digital-agent/references/project-context.md`。
- 本地不再保留 `AGENT.md` / `rules/` / `references/` 副本；引用它们的地方一律指向上游仓库。
