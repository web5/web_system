# 机器化红线 + Evals 运行体 · git/CI 部署设计

> 配套 `ai-native-sdlc-playbook.md` 第二批任务（缺口② Hook 机器化 + 缺口③ Evals）。
> 依据 `.codebuddy/agent-kit/`（红线 05-red-line-check、references/eval-framework.md §6 CI 门禁）设计。
> 本文是**工程化任务的 spec**：给出每个落地物的路径、内容要点与验收标准；实施时按仓库实际微调，但设计决策与文件位置以此为准。

## 0. 现状基线（2026-09-07 实测）

| 项 | 现状 | 影响 |
|---|---|---|
| git hooks | 无（`.git/hooks` 全为 `.sample`，无 husky/lint-staged） | 需新建，零依赖原生 `.githooks` |
| CI | 仅 `.github/workflows/auto-pr.yml`（push 时建 PR，**无任何检查 job**） | 门禁需新挂 `pull_request` workflow |
| 子包 lint | `apps/admin`、`apps/portal`、各 server 的 `lint` 脚本**全带 `--fix`** | 不能直接作 CI 门禁（会改文件） |
| typecheck | 仅 `apps/admin` 有独立 `type-check`；其余内嵌在 `build`（vue-tsc/tsc/nest build） | CI 以跑 `build` 代替 typecheck |
| 测试 | 10 个子包有 jest，其余无 | 门禁只对「有 test 的改动包」跑 |
| 聚合入口 | 根 package.json 无 lint/test/build 聚合 | 需补根级 `check:*` 聚合脚本 |
| 敏感文件 | `.gitignore` 已忽略 `**/.env*`、`*.pem/key/cert`、agent key 配置 | 基线好，hooks 双保险 |
| 源 kit | `/Users/geekwen/workspace/ai-agent-kit` 已有 `evals/`、`scripts/`、`eval-gate.yml` | web_system 只做消费方守护，不重复搭完整评测 |
| 同步覆盖 | `sync-to-target.sh` 用 `rm -rf .codebuddy/agent-kit` 后回拷 `skills/rules/references/AGENT.md/README.md` | **评测报告/本地脚本不得放 `.codebuddy/agent-kit/` 内** |

## 1. 总架构

```
A. 代码质量红线（对工程代码）                        B. Evals 运行体（对数字人行为）
┌──────────────────────────────┐      ┌──────────────────────────────────┐
│ L0 本地 pre-commit（秒级）     │      │ 评测本体（在 ai-agent-kit 源跑）     │
│  .githooks/ + install 脚本    │      │  run-eval.sh / check-artifacts.sh │
│  只查 staged diff 的 5 条红线  │      │  报告落源仓库 evals/reports/        │
└──────────────┬───────────────┘      └───────────────▲──────────────────┘
               │ 部署引导                          │ 评审门禁
┌──────────────▼───────────────┐      ┌───────────────┴──────────────────┐
│ L1 CI quality-gate.yml（强制） │      │ L1' CI kit-gate.yml（守护运行时）   │
│  PR 触发：静态红线扫描 +        │      │  PR 改动 .codebuddy/skills 等时：   │
│  改动包 build+test            │      │  结构完备检查 + 强制附评测报告      │
└──────────────────────────────┘      └──────────────────────────────────┘
```

设计分工：**工程代码的「红线机器化」落在 web_system**；**数字人行为的「回归评测」权威在 ai-agent-kit 源仓库**（干净上下文 + AGENT_CMD 无头跑），web_system 侧以 `kit-gate.yml` 守住运行时结构不退化 + 强制「改了行为定义必须附报告」。

## 2. A 部分：机器化红线

### 2.1 红线清单（8 条，源自 CODEBUDDY.md 铁律，机器可判定）

| # | 红线 | 扫描规则 | 拦截层 |
|---|---|---|---|
| R1 | 无调试残留 | diff 含 `console.log|debugger|print(`（.ts/.tsx/.vue/.js） | L0 + L1 |
| R2 | 无敏感信息入库 | 新增 `.env*`/`*.pem`/`*.key`/`*cert*`；或硬编码 `(password\|secret\|token\|api_?key)\s*=\s*['"]...` | L0 + L1（gitignore 已兜底） |
| R3 | 无占位残留 | `TODO|FIXME|TEMP|TBD`（模板文件白名单豁免） | L0 + L1 |
| R4 | TS 铁律 | `@ts-ignore|@ts-nocheck`、`: any`（白名单排除 test 夹具） | L0 + L1 |
| R5 | CORS 安全 | 新增 `enableCors(` 无参 / 无 `origin` 来自 config、或 `origin: '*'` | L1（代码扫描） |
| R6 | 类型/构建通过 | 改动包的 `build`（含 vue-tsc/tsc/nest build） | L1 |
| R7 | 测试通过 | 有 jest 的改动包跑 `test` | L1 |
| R8 | 异常过滤器/日志合规 | grep 新增 server 文件：注册 `useGlobalFilters`、无裸 `console`（R1 已覆盖） | L1（引导性，warning） |

### 2.2 L0 本地 pre-commit（零依赖原生 hooks）

不引入 husky/lint-staged（当前仓库无此依赖、无 `packageManager` 锁版本），用 git 原生 `core.hooksPath`，**hook 脚本本身入库版本化**。

新建：

```
.githooks/
└── pre-commit          # 入口：调用 scripts/redline/check-commit.sh
scripts/redline/
├── check-commit.sh     # L0 本体：staged diff 静态红线（R1~R4），exit 1 拦截
├── scan-rules.sh       # L1 共享：全仓/PR-diff 红线扫描函数库（R1~R5+R8 warning）
└── install-git-hooks.sh # 一键安装：git config core.hooksPath .githooks
```

要点：
- `check-commit.sh` 只查 `git diff --cached`（快，秒级），失败打印违规行并 `exit 1`。
- 提供 `--skip` 逃生阀？**不提供**——红线应有绕不过的强制性（必要时 `git commit --no-verify` 是有意为之的破坏，不算逃生阀）。
- `install-git-hooks.sh` 幂等，重复执行安全：
  ```bash
  git config core.hooksPath .githooks
  echo "已启用 .githooks（当前: $(git config core.hooksPath)）"
  ```

### 2.3 L1 CI 门禁：`.github/workflows/quality-gate.yml`

新增独立 workflow（不改 auto-pr.yml，职责分离：它只负责建 PR）：

```yaml
name: quality-gate
on:
  pull_request:
    branches: [master, main]
  workflow_dispatch:

jobs:
  redline-scan:            # 静态红线扫描（近零成本，秒级）
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - name: PR diff 红线扫描（R1~R5 + R8 warning）
        run: bash scripts/redline/scan-rules.sh diff origin/master...HEAD

  changed-packages:        # 对改动波及的包跑 build(R6) + test(R7)
    runs-on: ubuntu-latest
    needs: redline-scan
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: pnpm/action-setup@v4        # 用与本地一致的 pnpm 版本
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: 提取改动包并逐个 build/test
        run: bash scripts/ci/changed-packages.sh origin/master...HEAD
```

`scripts/ci/changed-packages.sh` 核心逻辑（动态读包名，避免硬编码）：

```bash
set -euo pipefail
BASE="${1:?用法: $0 <git-ref-range>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

changed=$(git diff --name-only "$BASE" | cut -d/ -f1-2 | sort -u)
for dir in $changed; do
  [ -f "$dir/package.json" ] || continue
  name=$(node -p "require('./$dir/package.json').name")
  scripts=$(node -p "Object.keys(require('./$dir/package.json').scripts||{}).join(',')")
  echo "== $name ($dir) scripts: $scripts =="
  if [[ "$scripts" == *"build"* ]]; then
    (cd "$dir" && pnpm build)          # 内含 vue-tsc/tsc/nest build = R6
  fi
  if [[ "$scripts" == *"test"* ]]; then
    (cd "$dir" && pnpm test -- --runInBand)   # jest CI 模式 = R7
  fi
done
```

> 边界：未匹配到任何子包（只改 docs/、.codebuddy/）时脚本自然空跑通过；`packages/*` 改 shared/types 时依赖方不受影响（lint 语义上需全量，M2 演进）。

### 2.4 手动待办（工程化任务需在 GitHub 仓库设置）

- master 分支保护（Settings → Branches → Add rule）：要求 PR 通过 `quality-gate` / `kit-gate` + 1 个 review 才能 merge（人守最后一关，对应方法论「Review 先逻辑→安全→对照 spec」）。

## 3. B 部分：Evals 运行体

### 3.1 分工与存放规则（关键约束）

- **报告存储**：`.codebuddy/agent-kit/` 是同步覆盖区（`sync-to-target.sh` 会 `rm -rf`），**评测报告/本地脚本一律放 `.codebuddy/evals/`**，与 agent-kit 平级、不受同步影响。
- **完整评测**（L2 路由/L3 陷阱/L4 任务卡，需 AGENT_CMD 无头调 agent + judge）：在 ai-agent-kit 源仓库跑（工具已齐），报告落源 `evals/reports/`。web_system 不重复建设。
- **web_system 承担**：L1 结构守护 + 评测报告门禁（对运行时 `.codebuddy/skills` 的直接改动）。

### 3.2 落地物

```
.codebuddy/evals/
├── README.md                # web_system 侧评测手册：什么时候跑、报告放哪、如何引用源仓库工具
├── reports/TEMPLATE.md      # 复制源 evals/reports/TEMPLATE.md 的评测报告模板
scripts/redline/check-kit-structure.sh   # L1 结构完备检查（适配 web_system 双 skills 根）
.github/workflows/kit-gate.yml           # L1' 守护：结构检查 + 报告门禁
```

### 3.3 L1 结构检查（`check-kit-structure.sh`，适配 web_system 实际）

web_system 有**两个 skills 根**：运行源 `.codebuddy/skills/`（**12 个**：rd-* + tech-review + user-memory + 项目专属 be/fe-developer + karpathy-* 3 个）与镜像 `.codebuddy/agent-kit/skills/`（11 个，纯通用层）。检查规则（对应 eval-gate.yml 的 S1~S6 但按 web_system 裁剪）：

- S1 必需文件齐全：`.codebuddy/agent-kit/AGENT.md`、`references/ai-methodology.md`、`references/eval-framework.md`、`rules/general/01~05` 共 5 条红线齐全
- S2 无孤儿 skill：两个 skills 根下每个目录都在白名单（运行源 12 个 + 镜像 11 个）
- S3 frontmatter `name:` 与目录名一致（对每个 `*/SKILL.md`）
- S4 占位残留禁止（镜像 `references/` 与 `rules/` 不允许 `<your-team>/<your-project>`；运行源 skills 内允许项目占位）
- S5 决策树引用存在：`rd-digital-agent/SKILL.md` 路由提到的子技能文件须存在
- S6 红线绑定：AGENT.md 新增红线须在对应 skill 检查清单有执行项（防「只有口号、无执行」）

### 3.4 CI：`.github/workflows/kit-gate.yml`

```yaml
name: kit-gate
on:
  pull_request:
    branches: [master, main]
  workflow_dispatch:

jobs:
  structure:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - name: L1 结构完备检查
        run: bash scripts/redline/check-kit-structure.sh

  eval-report-gate:          # 改了行为定义必须附评测报告
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - name: 检查行为改动是否附报告
        env:
          BASE_SHA: ${{ github.event.pull_request.base.sha }}
        run: |
          changed=$(git diff --name-only "$BASE_SHA" HEAD -- \
            .codebuddy/skills/ .codebuddy/agent-kit/AGENT.md \
            .codebuddy/agent-kit/skills/ .codebuddy/agent-kit/rules/ \
            .codebuddy/agent-kit/references/ | grep -v '\.codebuddy/agent-kit/README.md' | wc -l | tr -d ' ')
          report=$(git diff --name-only "$BASE_SHA" HEAD -- .codebuddy/evals/reports/ \
            | grep -v TEMPLATE | wc -l | tr -d ' ')
          echo "行为定义变更文件: $changed；新增评测报告: $report"
          if [ "$changed" -gt 0 ] && [ "$report" -eq 0 ]; then
            echo "::error::PR 修改了数字人行为定义（.codebuddy/skills 或 agent-kit 规则）但未附评测报告。"
            echo "请在 ai-agent-kit 源仓库跑 run-eval.sh，把报告复制到 .codebuddy/evals/reports/（模板：TEMPLATE.md）。"
            echo "纯排版/不影响行为的改动，在 PR 描述注明 skip-eval 并在 commit message 说明。"
            exit 1
          fi
          echo "评测报告门禁通过。"
```

> `eval-report-gate` 的"评测报告从哪来"：行为定义改动若发生在镜像区（agent-kit），源头在 ai-agent-kit 仓库，由源仓库的 `eval-gate.yml` 管；运行源 `.codebuddy/skills/` 的直接改动才需本地评测。设计上 kit-gate 只做**存在性守护**，真正的评测动作人执行（无 AGENT_CMD 时跑 `run-baseline.md` 手动档）。

## 4. 根 package.json 聚合脚本（M1 落地即加）

```jsonc
"scripts": {
  // 现有保留
  "redline:local": "bash scripts/redline/check-commit.sh",        // 本地 staged 扫描（可手动跑）
  "redline:scan": "bash scripts/redline/scan-rules.sh diff origin/master...HEAD", // CI 同款
  "kit:check": "bash scripts/redline/check-kit-structure.sh",      // kit 结构自检
  "hooks:install": "bash scripts/redline/install-git-hooks.sh",   // 启用 .githooks
  "evals:manual": "bash .codebuddy/evals/run-manual.sh"           // （M2）手动评测引导，调用源仓库 run-eval.sh
}
```

## 5. 任务拆分与验收

### M1（第一批，纯增量、不动现有逻辑）
| # | 任务 | 验收 |
|---|---|---|
| 1 | `.githooks/pre-commit` + `scripts/redline/check-commit.sh`（R1~R4） | 造一个含 `console.log` 的 staged 文件，`git commit` 被拦并打印违规行；删除后通过 |
| 2 | `scripts/redline/scan-rules.sh`（R1~R5+R8 扫描，支持 diff/全仓模式） | CI 同款命令本地跑 PR diff 输出 PASS/FAIL |
| 3 | `scripts/redline/install-git-hooks.sh` | 运行后 `git config core.hooksPath` = `.githooks`，幂等可重复 |
| 4 | `.github/workflows/quality-gate.yml` + `scripts/ci/changed-packages.sh` | 本地验证脚本对 `feature/*` 改动包正确圈定；workflow push 到分支后 PR 上出现 green check |
| 5 | 根 package.json 聚合脚本（4 条） | `pnpm redline:local` 可跑 |

### M2（第二批）
> 状态：2026-09-07 已实施任务 6/7/9 与任务 8 的 lint:ci 拆分；**任务 8 的 CI lint 档暂缓**（见下方任务 10 的 ESLint 配置存量问题）。M2 完成后 M1 的 §6 注意事项 2/5 需按实际刷新。

| # | 任务 | 验收 | 状态 |
|---|---|---|---|
| 6 | `.codebuddy/evals/`（README + reports/TEMPLATE.md） | 目录就位，README 写清与源仓库工具关系 | ✅ 已落地（README 说明放 `.codebuddy/evals/` 因 agent-kit 是同步覆盖区） |
| 7 | `scripts/redline/check-kit-structure.sh` + `.github/workflows/kit-gate.yml` | 故意删一个 skill 的 SKILL.md → CI 结构检查失败；改 skills 不附报告 → 门禁拦截 | ✅ 已落地（脚本含 S1~S6；删文件实测 exit 1） |
| 8 | 子包 `lint` 脚本拆 `lint:ci`，quality-gate 加 lint 档 | 全仓无 `--fix` 的 lint 检查跑绿 | 🟡 lint:ci 已注入 10 包；**lint 档未挂 CI**（被任务 10 阻塞） |
| 9 | 手动：GitHub master 分支保护 + PR 描述 `skip-eval` 约定写入 CODEBUDDY.md | 无保护分支可绕过的门禁 | 🟡 skip-eval 约定已写入；**分支保护需在 GitHub Settings 手动开** |
| 10 | **新发现（存量）**：子包 ESLint 9 全部无配置文件 | 抽查 apps/portal、servers/* 均无 `eslint.config.*`/`.eslintrc*`/`eslintConfig` 字段；原 `lint` 脚本本就失败（ESLint 9 需 flat config） | ⏳ 待补：为各子包补 `eslint.config.*`（Vue 用 `@vue/eslint-config-typescript` flat preset，Nest 用 `typescript-eslint`），补完才可挂 CI lint 档 |

> 结论：ESLint 配置缺失是**存量问题**（lint 脚本历史上一跑就挂），不是 M2 引入。`lint:ci`（只读）已就位、工具已支持 `--lint`，待各包补 flat config 后，quality-gate 的 changed-packages job 加 `--lint` 即可激活。

## 6. 注意事项（避免踩坑）

1. **报告/脚本不要放 `.codebuddy/agent-kit/` 内**：同步脚本会 `rm -rf` 覆盖，放 `.codebuddy/evals/`。
2. **lint 脚本全带 `--fix`**：不能直接挂 CI，M2 拆 `lint:ci` 之前 CI 只跑 `build`（含 tsc/vue-tsc 已覆盖类型检查）。
3. **pnpm 版本未锁**：CI 用 `pnpm/action-setup@v4` 时显式写 `version:`（与本地 `pnpm -v` 一致），避免 lockfile 兼容漂移。
4. **Nest 子包 `build` 可能吞错**（`build-all.sh` 曾 `2>/dev/null || echo skip`）：changed-packages.sh 必须 `set -e`，任何包 build 非零即整体失败——这正是门禁要抓的，不能学 build-all.sh 吞错。
5. **`kit-gate` 不要照抄 eval-gate.yml 白名单**：源仓库有 14 个 skill，web_system 两个根分别只有 7/11 个，按实际目录生成白名单（M2 任务 7 实施时用 `ls .codebuddy/skills` 动态核对）。
6. R5 CORS 检查依赖 grep 模式，有误报可能：只对**新增行**判定 + 标注 `::warning::` 提示人工确认，不作为硬失败（避免阻塞合法 config 读取写法）。

## 7. 关联文件

- 方法论：`.codebuddy/agent-kit/references/ai-methodology.md`（红线机器化 §六）
- 红线定义：`.codebuddy/agent-kit/rules/general/05-red-line-check.md`（含最小实现示例）
- 评测定稿：`.codebuddy/agent-kit/references/eval-framework.md` §6 CI 门禁、§8 落地结构
- 源仓库工具（引用不拷贝）：`/Users/geekwen/workspace/ai-agent-kit/scripts/{run-eval,check-artifacts,gen-report}.sh`
- 工程铁律来源：`.codebuddy/CODEBUDDY.md`「AI 编程规范」「部署铁律」
