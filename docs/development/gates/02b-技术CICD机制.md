# 02b · 技术 CI/CD 机制（赛道二 · 要改技术门时读这份）

> 读者：要理解、修改或扩展**技术 CI/CD 门禁**的人。回三个问题：**流水线几层？哪些技术门？warning 怎么升 error？**
> 总入口见 [../质量门禁总纲.md](../质量门禁总纲.md)；日常用法见 [01-日常使用.md](01-日常使用.md)；需求流程机制见 [02a-需求流程机制.md](02a-需求流程机制.md)；治理与编号索引见 [03-治理与索引.md](03-治理与索引.md)。

---

## 1 四层模型：每一层到底拦得住谁

| 层 | 载体 | 时机 | 拦得住 | 拦不住 | 可信度 |
|---|---|---|---|---|---|
| **L1 编辑器层** | `.codebuddy/settings.json` 的 4 个 PreToolUse hook + 2 个 SessionStart + 1 个 PostToolUse | AI 每次写文件 / 执行命令**之前** | 只有 AI 的写入与命令 | 人手动编辑、人手动执行、其他 IDE | 对 AI **高**；对人 **零** |
| **L2 本地 git 层** | `.githooks/`（`core.hooksPath` 指向） | `git commit` | 所有本地提交（含 AI 提交） | `--no-verify`、`UI_GATE=off` | **已启用（2026-10-22 补齐 pre-commit）** |
| **L3 PR CI 层** | `quality-gate.yml` 4 个 job | 每次 PR 更新 | 所有进 master 的改动（前提：分支保护要求该 workflow 通过） | Admin merge、直推 master | **唯一硬门**，但仅 8 项阻断 |
| **L4 发布层** | `release.yml` + deploy-console `release_plan` / `release-verify` | 发布动作 | 发布流水线本身 | 手工 SSH 上机、绕过流水线改文件 | 中（不变量校验，非内容校验） |

> **设计含义**：L1 是"越早越便宜"的反馈，不是安全边界；L2 是快反馈（可被 `--no-verify` 绕过）；**L3 是唯一契约**。
> 「本地会拦住」只在「没加 --no-verify」的前提下成立——所以本地绿灯不等于可合并，CI 绿灯才是。

### 1.1 L3 的两个隐藏契约（改 CI 前必读）

这两条都不写在任何 workflow 文件里，但违反了就会让门禁**静默失效**——CI 页面全绿，PR 却合不进去，或者反过来。

| 契约 | 表现 | 怎么发现的 | 正确做法 |
|---|---|---|---|
| **job `name` 就是分支保护 required check 的键** | 把 `改动包 build/test` 改成 `改动包 build/test/lint` 后，四个 job 全 `pass`，PR 依然 `BLOCKED`，`gh pr merge` 只说「加 --auto」；GitHub **不提示缺哪个 check** | 2026-10-22 实测：改回原名后同一 PR 立刻 `BLOCKED → CLEAN` | 改 job name 必须同步改 Settings → Branches → required checks；或干脆不改名（把新步骤塞进旧 job） |
| **workflow 必须真被 branch protection 引用** | 新增了 workflow / job，但它不在 required 列表里 → 红了也能合 | `quality-gate.yml` 头部注释「启用要求：master 分支保护开启，要求本 workflow 通过才可 merge」 | 新增 job 时确认它进 required 列表，否则它只是"参考信息" |

> 这两条合起来说明一件事：**L3 的强制力来自分支保护配置，不是来自 workflow 文件本身**。
> 所以「我加了 CI 检查」不等于「门禁生效」——必须验证一次「故意让它红，能不能拦住合并」。

---

## 2 A 类 · 行级静态规则（逐行扫**新增行**）

共同约定：
- **只看新增/变更行**，存量违规不背锅（这是全仓门禁的第一原则）
- 注释行跳过（`//` `#` `/*` `*` `<!--`）——但 R3 占位规则**不跳**，因为 TODO 常写在注释里
- 豁免目录（R1 专用）：`scripts/*.mjs|cjs`、`apps/*/scripts/*`、`archive/migrations/*.mjs|cjs`、`.codebuddy/[agent-kit/]skills/*/scripts/*`
  → 判据是**「脚本的 stdout 就是产品输出」**，不是「这个目录比较特殊」

| 机制 | 编号 | 级别 | 判什么 |
|---|---|---|---|
| A1 调试残留 | R1 | error | `console.log` / `console.debug(` / `debugger` |
| A2 硬编码凭据 | R2b | error | `password\|secret\|api_key\|token\|private_key` 后跟 8 位以上字面量 |
| A3 敏感文件入库 | R2 | error | `*.pem` / `*.key` / `.env*`（`.env.example` 除外） |
| A4 占位残留 | R3 / R3b | error / warn | TODO·FIXME（error）；TEMP·TBD·HACK·XXX（warn） |
| A5 TS 铁律 | R4 | error | `@ts-ignore` / `@ts-nocheck`；`: any` 类型标注 |
| A6 CORS | R5 | warn | `enableCors()` 无参 / `origin: '*'` |
| A7 全局异常过滤器 | R8 | warn | `main.ts` 有 `enableCors` 却无 `useGlobalFilters` |

> **A5 的实现坑（已修，勿回退）**：`: any` 原字符类 `[[:space:],);\]}]` 在 POSIX 里 `\]` 不是转义 → 整类解析错 → `const a: any = 1` / `any[]` / `x: any;` 全部漏报。现用词界 `([^0-9A-Za-z_]|$)`。**禁止改回 `[[:alnum:]]`**：UTF-8 下汉字算字母，`中文TODO中文` 会漏报。

---

## 3 B 类 · 技术结构门

| 机制 | 编号 | 级别 | 触发面 → 要求 |
|---|---|---|---|
| B4 双源同源 | R12 | warn | `.codebuddy/agent-kit/skills` ↔ `.codebuddy/skills` 内容一致（项目专属技能与下游定制文件白名单跳过） |
| B5 SSE 契约一致 | R16 | warn | 消费方手写事件联合 ↔ `packages/agent-core` 的 `StreamEventType` 真相源（由 `check-sse-contract.py` 输出） |
| B6 原型体系静态三件套 | —（job: proto-static-check） | error | ① `build-agents-hub` 后生成物必须与提交一致；② 散落稿必须为 0 或已登记；③ 已并入稿的可并入性回归 |
| B7 流水线脚本静态体检 | L1/L5/L6/L9 | error / error / warn / error | L1 `bash -n`；L5 ssh 行尾缺续行符；L6 危险命令提示；L9 调 `$CONSOLE_API` 的 curl 缺 `-f` |

> B6 的判据源不在本文，在 skill `ux-prototype-designer/references/proto-adoption.md`。本文只保证「散落 = 0」这个不变量被 CI 守住。
> B1/B2/B3（原型门）归赛道一，见 [02a-需求流程机制.md §2](02a-需求流程机制.md)。

---

## 4 D 类 · 构建与测试门

| 机制 | 实现 | 级别 | 说明 |
|---|---|---|---|
| D1 类型检查 / build | `scripts/ci/changed-packages.sh` | error | 从改动路径反推子包；**先按拓扑序构建其工作区依赖**（`<name>^...`），否则 CI 全新 checkout 必报 `TS2307` |
| D2 单元测试 | 同上（有 `test` 脚本的包跑 `jest --runInBand`） | error | `set -e`，任何包非零即整体失败 |
| D3 ESLint | 两道：`changed-packages --lint`（拦 error）+ 根 `pnpm lint:ci`（warning 水位 328） | error | 2026-10-22 开启。子包 lint:ci 只拦 error；warning 用**总量水位**（只降不升），因为 ESLint 不提供「只报新增行」，按文件判会误伤存量大户 |
| D4 生成物一致性 | proto-static-check 第一步 | error | build 后 `git diff --quiet` 校验，防「改了源稿没重跑 build」与「手改生成物」 |

---

## 5 E 类 · 发布门

| 机制 | 载体 | 校验什么 |
|---|---|---|
| E1 发布流水线 | `.github/workflows/release.yml` | 只在发布源分支触发；master 合并不自动发布 |
| E2 发布方案不变量 | deploy-console `release_plan`（L1 只读 dry-run） | 模块在册 / **目标产物存在** / 发布锁空闲 / 环境健康 / 回滚点存在 |
| E3 发布后验证 | deploy-console `release-verify` | 按用例矩阵自动验证，替代人工点 |

> E2 的「目标产物存在」是唯一能抓住「流水线成功但前端产物没投递」的检查——2026-09 的事故正是这一类。这也是为什么 C7（`Plan` 凭证）必须存在：`release_plan` 只验不变量，不验「方案里到底写没写发布清单」。

---

## 6 升级路径（技术门口径）

一条技术门 warning 要升 error，必须**同时**满足：

| 条件 | 要求 | 怎么算 |
|---|---|---|
| **样本量** | ≥20 个 commit（`--first-parent`） | 观察日志累计 |
| **命中量** | ≥5 次真实命中 | 人工核对每条命中 |
| **误报率 < 30%** | 非真残留（人工判） | 触发面没画宽 |
| **豁免趋势** | 未出现暴增 | `Micro-exempt` 使用率 |

**水位门的特殊规则**：ESLint warning 水位（当前 328）**只降不升**。每次降低水位后反向验证（调低 1 应 FAIL），确认是真门。

---

## 7 判据源

| 编号 | 实现位置 |
|---|---|
| A 类行级 | `scripts/redline/scan-rules.sh` |
| B4 双源同源 | `scripts/redline/scan-rules.sh` |
| B5 SSE 契约 | `scripts/redline/check-sse-contract.py` |
| B6 原型体系 | `scripts/redline/proto-static-check`（CI job） |
| B7 流水线体检 | `scripts/redline/scan-rules.sh` |
| D1/D2 构建测试 | `scripts/ci/changed-packages.sh` |
| D3 ESLint | `quality-gate.yml` → `pnpm lint:ci` + `changed-packages --lint` |
| E1 发布流水线 | `.github/workflows/release.yml` |
| E2/E3 发布门 | deploy-console `release_plan` / `release-verify` |
