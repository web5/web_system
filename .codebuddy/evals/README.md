# web_system · Evals 评测运行区

> 本目录是 web_system（消费方）的评测报告存放区。方法论文档：`.codebuddy/agent-kit/references/ai-methodology.md` §六（红线机器化）、`eval-framework.md`（评测定稿）。

## 本目录与 ai-agent-kit 源仓库的分工

| 对象 | 位置 | 职责 |
|---|---|---|
| 完整评测运行体 | `/Users/geekwen/workspace/ai-agent-kit/evals/` | `cases/`、`golden-tasks/`、`run-baseline.md`、`scripts/{run-eval,check-artifacts,gen-report}.sh` |
| **web_system 报告区** | 本目录 `reports/` | 评测报告落盘（**不放在 `.codebuddy/agent-kit/` 内**——那是同步覆盖区，`sync-to-target.sh` 会 `rm -rf`） |
| CI 结构守护 | `.github/workflows/kit-gate.yml` | PR 改 `.codebuddy/skills/` 等行为定义时：L1 结构检查 + 强制附报告 |

## 什么时候要评测（kit-gate 门禁）

PR 修改了数字人行为定义（`.codebuddy/skills/`、`.codebuddy/agent-kit/AGENT.md|skills/|rules/|references/`）时，**必须同时**在本目录 `reports/` 新增一份评测报告，否则 `kit-gate.yml` 拦截。

- 行为定义变更 = 可能改变 AI 产出方式 → 需要回归证据证明没退化
- 纯排版 / 错别字 / 不影响行为的改动 → PR 描述注明 `skip-eval` 并在 commit message 说明即可豁免

## 怎么评测（步骤）

1. 改动大多发生在 ai-agent-kit **源仓库**（`.codebuddy/agent-kit/` 是同步镜像）→ 评测在源仓库按 `ai-agent-kit/evals/README.md` 跑，报告再复制到本目录。
2. 直接改了 web_system 运行时 `.codebuddy/skills/`（含项目专属 fe/be 路由）→ 无头 Agent 可用时：
   ```bash
   # 在 ai-agent-kit 源仓库
   AGENT_CMD='<你的无头 agent 命令模板>' bash scripts/run-eval.sh -c <kit短hash> -m <模型>
   ```
   无 AGENT_CMD 时按 `ai-agent-kit/evals/run-baseline.md` 手动档执行。
3. 核对产物 → 评分（RUBRIC D1~D5）→ 复制 `reports/TEMPLATE.md` 为 `reports/<hash>-<日期>.md` 填写。

## 文件规则

- 历史报告**落盘后不改写**（回归证据，防漂移）
- 每次评测新开一个 `<hash>-<日期>.md`，保留时间序列用于趋势对比
- 文件命名：`<git短hash>-<YYYY-MM-DD>.md`
