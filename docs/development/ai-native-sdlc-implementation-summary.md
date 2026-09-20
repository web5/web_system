# AI Native SDLC 落地 · 实施总结

> 时间：2026-09-07
> 性质：将 Anthropic《AI Native SDLC playbook》方法论落地到 web_system 研发体系的 git/CI 层。
> 关联：总纲 `docs/development/ai-native-sdlc-playbook.md`；实施 spec `docs/development/ai-native-sdlc-ci-deployment.md`。
> 代码提交：`383f4e7` feat(ci): 机器化红线 + Evals 运行体部署到 git/CI 层（24 files，+1112/-22，已提交未推送）
>
> ⚠️ 2026-09-10 变更（本文为 2026-09-07 历史快照）：数字人能力收敛为「唯一能力源 `.codebuddy/agent-kit/` + 运行源 `.codebuddy/skills/` 镜像」；
> **`.codebuddy/evals/` 与 kit-gate 的评测报告门禁已下线**（评测回归 ai-agent-kit 源仓库），kit-gate 现为 S1~S7 结构检查（含 S7 零漂移）。
> 下文涉及 `.codebuddy/evals/` 的描述仅作历史记录。

---

## 一、背景

方法论核心：瓶颈已从「写代码」转移到「流程」，把 AI 不只嵌入写代码，而是嵌入整个 SDLC 每一环；把"反复提醒"变成"随代码版本化、可审计的机制"（红线机器化 + 版本化产物链）。

对 web_system 的盘点结论：已有 Superpowers 工作流、specs/、agent-kit 方法论库，覆盖方法论 60-70%；缺的是三块——**版本化闭环、机器化守门、回归评测**。本次落地聚焦后两块。

## 二、改动清单

### 新增脚本 / 配置文件

| 文件 | 作用 |
|---|---|
| `.githooks/pre-commit` | 本地提交前红线检查入口（git 原生 hook，`core.hooksPath=.githooks`） |
| `scripts/redline/scan-rules.sh` | 红线扫描核心库 R1~R8，支持 cached/diff/files/tree 四模式 |
| `scripts/redline/check-commit.sh` | L0 封装：扫描 staged 变更 |
| `scripts/redline/install-git-hooks.sh` | 一键安装/查看/卸载 hook（幂等） |
| `scripts/redline/check-kit-structure.sh` | 数字人 kit 结构守护 S1~S6 |
| `scripts/ci/changed-packages.sh` | CI 提取改动波及子包，跑 build/test（--lint 可选） |
| `.github/workflows/quality-gate.yml` | PR 门禁：红线扫描 + 改动包 build/test |
| `.github/workflows/kit-gate.yml` | kit 结构检查 + 改行为定义须附评测报告 |
| `.codebuddy/evals/README.md` | web_system 侧评测运行说明（与源仓库分工） |
| `.codebuddy/evals/reports/TEMPLATE.md` | 评测报告模板 |

### 修改文件

| 文件 | 改动 |
|---|---|
| 10 个子包 `package.json`（apps/admin、apps/portal、servers/ai-agent/ai-service/auth-service/gateway/mcp-gateway/todo-service/upload-service/user-service） | 注入只读 `lint:ci`（eslint 去 `--fix`） |
| 根 `package.json` | 新增 `redline:local/scan/tree`、`hooks:install/status` 5 个聚合命令 |
| `.codebuddy/CODEBUDDY.md` | 「提交 & 提 PR 铁律」区追加 git/CI 红线门禁 + skip-eval 约定 |
| `docs/development/ai-native-sdlc-playbook.md` | 任务 2/4 标注已细化，指向部署 spec |
| `docs/development/ai-native-sdlc-ci-deployment.md` | 实施 spec + 任务状态（新增任务 10：ESLint 配置存量） |

## 三、改动后的效果（核心）

### 红线从「AI 自觉遵守」→「机器强制拦截」

| 场景 | 改动前 | 改动后 |
|---|---|---|
| 本地提交 | 带 `console.log`、硬编码密码、`.env`、`@ts-ignore` 也能 commit | **pre-commit 秒级拦截**（R1~R4，实测含 console.log 的 commit 被拒 exit 1） |
| 开 PR | 无任何检查，质量问题可能直接进 master | PR 自动扫红线 + 改动波及包跑 build（含类型检查）/test，失败无法 merge |
| 改数字人行为（`.codebuddy/skills/`） | 改了就改，无回归证据 | 必须附评测报告到 `.codebuddy/evals/reports/`，否则 CI 拦截；纯排版可 `skip-eval` 豁免 |
| kit 结构完整性 | 删 skill 文件、frontmatter 不一致无人知 | 每次 PR 结构检查 S1~S6 守护 |
| 团队约定传承 | 靠文档 + 记忆 | 部分红线进 git hook 版本化，随仓库走 |

### 8 条机器红线（R1~R8）

| 规则 | 拦截内容 | 级别 |
|---|---|---|
| R1 | `console.log/debug/debugger` 调试残留 | error |
| R2 | 敏感文件（`.env`/`*.pem` 等）入库、硬编码凭据 | error |
| R3 | TODO/FIXME 占位残留（TEMP/TBD/HACK/XXX 为弱占位） | error / warning |
| R4 | `@ts-ignore`/`@ts-nocheck`、裸 `: any` | error |
| R5 | CORS 硬编码 `*`、`enableCors()` 无参 | warning |
| R6 | 改动包 build（内含 vue-tsc/tsc 类型检查） | CI 强制 |
| R7 | 改动包单测 | CI 强制 |
| R8 | main.ts 启用 CORS 但无全局异常过滤器 | warning |

### 已实测验证

- 18 项红线拦截/放行功能测试全过（临时 git 仓库）
- 真实仓库 commit 拦截 + 放行端到端验证
- kit 结构检查：删 SKILL.md → exit 1；加 `<your-team>` 占位 → S4 报错
- 当前分支 diff origin/master 的 **10 处真实 console.log 被扫出**（红线确实生效）
- 提交 `383f4e7` 自身通过 pre-commit hook 自动检查

## 四、遗留事项（诚实说明）

1. **子包 ESLint 配置缺失（存量问题，任务 10）**：10 个子包 ESLint 9 无 `eslint.config.*`，原 `lint` 脚本本就跑不通（非本次引入）。`lint:ci` 已就位但**未挂 CI**（避免卡死所有 PR）；补 flat config 后 quality-gate 的 changed-packages 加 `--lint` 即激活。
2. **GitHub master 分支保护（手动）**：需在 Settings → Branches 开启（要求 quality-gate/kit-gate 通过 + review），否则门禁可被绕过。
3. **完整 Evals（L2~L4）**：依赖 ai-agent-kit 源仓库无头 Agent 运行，web_system 只做结构守护与报告区。
4. **本地 hook 需团队安装**：`pnpm hooks:install` 一次，此后提交自动检查。

## 五、如何验证 / 使用

```bash
# 本地红线
pnpm redline:local     # 检查当前 staged 变更
pnpm redline:scan      # 全量 staged 扫描
pnpm redline:tree      # 全仓巡检（较慢，本地用）
pnpm hooks:status      # 查看 hook 是否启用
# kit 结构自检
bash scripts/redline/check-kit-structure.sh -v
```

## 六、参考

- 方法论原文：Anthropic《The AI Native SDLC playbook》
- 总纲：`docs/development/ai-native-sdlc-playbook.md`
- 实施 spec（含 M1/M2 任务与验收）：`docs/development/ai-native-sdlc-ci-deployment.md`
- 红线定义：`.codebuddy/agent-kit/rules/general/05-red-line-check.md`
- 评测定稿：`.codebuddy/agent-kit/references/eval-framework.md`
