# 多会话并行开发纪律（web_system 工程真源）

> **定位**：web_system 工程内「多个 AI 会话 / 多 agent 并行 vibe coding」时的**执行纪律真源**。
> **方法论（五层模型、为什么这么分）**：跨项目规范 `~/AiWorkspace/20-私域资产/Vibe Coding 治理规范.md`（v1.0，444 只读），尤其 **③ 执行隔离层**。
> 本文只讲 web_system 的**具体怎么做**：当前 worktree 舰队、分支/提交纪律、构建源错位坑、端口/孤儿进程纪律、验证手段。
> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on

---

## 0. 为什么需要这份（一句话）

多会话并行 vibe coding 最大的坑是**静默互覆**：两个会话共用或抢同一份工作目录，`git checkout` / `reset` / `stash` 会静默把对方的 HEAD 与改动带走，**当场不报错**，发现时对方改动已丢。web_system 当前有 **13 个 worktree** 在跑（实测 2026-11-09，见 §1），纪律不挂闸门就会出事。这对应五层模型第 ③ 层「执行隔离」。

---

## 0.5 协作态信号三层（A+B+C）：让总控和每个 agent 都「知道」在协作

纪律文件只解决「知道规则」，不解决「知道此刻在跑多 agent」。补三层互补的信号机制（方法论见 20-私域资产规范 §协作态信号三层模型）：

| 层 | 方案 | 信息处理性质 | 谁消费 |
|---|---|---|---|
| **C · repo 持久真源** | `web_system/.agent-roster/<session-id>.json`（每会话一个自有文件，免并发锁） | 跨会话持久、结构化、可查询的「谁在活跃」真源 | 任意 agent `ls .agent-roster/` 即得 |
| **A · agent 自发现** | 开工前必 `git worktree list`，非主仓 worktree >1 即判定多 agent 模式 | 无状态、即时派生信号，C 的轻量兜底 | 当前 agent 自己 |
| **B · 总控上报** | 协作起始往 `~/AiWorkspace/.workbuddy/memory/YYYY-MM-DD.md` 追加一行（worktrees + roster 路径） | 把 repo 信号抬升到总控上下文，跨 workspace 协调时知情 | AiWorkspace 总控 / SuperAgent |

🔴 **一致性互校**：`.agent-roster/` 文件数 应与 `git worktree list` 非主仓数一致；差太多 = 有人没注销，告警并人工核对。三者正交互补，不是重复——C 是 repo 侧持久真源，A 是其即时派生+兜底，B 是向上汇报。

---

## 1. 当前 worktree 舰队（实测 `git worktree list`，**会过期，以实时输出为准**）

> ⚠️ 下表是 2026-11-07 快照。开工前必跑 `git worktree list`（见 §0.5 A）拿实时清单，别盲信本表。

| 路径 | 当前分支 | 角色 |
|---|---|---|
| `~/workspace/web_system` | ✅ `master`（2026-11-09 甲方案已切回） | 🔴 发布源，只留 master；不要在上面直接开发或切分支改代码 |
| `~/workspace/web_system-sdd` | `feat/approval-lifecycle` | 🔴 **长期保留的开发 worktree**（用户 11-06 拍板）；不要当临时目录清掉 |
| `~/workspace/web_system-b2a` | `feat/b2c-and-gate-fixes` | 隔离工作区 |
| `~/workspace/web_system-fix-d1d2` | `fix/runtime-payload-deterministic` | 隔离工作区 |
| `~/workspace/web_system-gcscope` | `feat/gc-node-scope` | 隔离工作区 |
| `~/workspace/web_system-r1` | `feat/storage-allowed-roots` | 隔离工作区 |
| `~/workspace/web_system-staticroot` | `fix/static-public-root-injection` | 隔离工作区 |
| `~/workspace/web_system-w3` | `feat/storage-temp-dir` | 隔离工作区 |
| `~/workspace/web_system-wecom` | `feature/wecom-approval-identity` | 隔离工作区 |
| `~/workspace/web_system-wecom-approval` | `fix/wecom-console-link-template` | 隔离工作区 |
| `~/workspace/web_system-nce34` | `feat/nce-multibook` | 隔离工作区 |
| `/private/tmp/web_system-redline-fix` | `fix/redline-gates-hint` | ⚠️ 在 `/tmp`，会被系统回收，勿长期依赖 |
| `~/workspace/web_system-assetorigin` | `feat/assetorigin`（2026-11-09 从 master 移出，腾 master 给主仓） | 隔离工作区 |

🔴 **铁律**：每个并行会话 / 任务认领**自己**的 worktree。主仓 `web_system` 当作发布源——**不要在上面直接开发或切分支改代码**（除非你就是在发布源发版）。从主仓抢 HEAD 是头号互覆现场（11-06 实测：commit 落到别人的 `feature/nce-lessons-calibration`）。

---

## 2. 分支与提交纪律（③ 执行隔离层落地）

| 纪律 | 为什么 |
|---|---|
| 提交前必 `git branch --show-current` | 确认在自己分支，别把改动落到别人的分支 |
| `git add` 永远逐路径，**禁 `-A`** | `-A` 会把同目录别人未提交的改动一并加进来 → 污染 / 串分支 |
| 落错分支**禁 `reset --hard`**（会清掉对方未提交改动） | 改用 `worktree add` + `cherry-pick` + `reset --soft` + 精确 `restore` |
| 同名但不同物理目录的 worktree，改动**不自动合并** | 别以为"都在 `feature/xxx`"就是同一份；`git worktree list` 看清物理路径 |

- 🔴 **派子代理时同样适用「一分支一 worktree」**。2026-11-27 实测：在同一工作区并行派两个写操作子代理，其中一个切分支并提交，另一个开工时发现 HEAD 已不是预期的 master。虽然逐字节比对源码无差异、产物有效，但这是可控范围内的侥幸。**同一工作区同一时刻只让一个子代理动 git 状态**；需要并行写操作时，各自 `git worktree add` 独立目录。

---

## 3. 构建源错位（头号静默坑）

- **构建必须在你自己 worktree 的 cwd 里跑。** 流水线 / 脚本若默认在发布目录（常停在 master）构建，你的分支改动永远进不了产物——表现「发布成功但没变」且**无任何报错**。
- 主仓 `web_system` 当前已回到 `master`（2026-11-09 甲方案修复）；**构建/发布只在 master 工作树做**，别在它上面切分支改业务代码。
- 验版本（确认构建源没错）：`curl -s http://127.0.0.1:6000/__manifest__` 看网关实际会加载哪个 commit；`bash scripts/health-check.sh local` 做全量巡检。

### 3.1 `pnpm --filter` 静默假成功（包名不匹配、脚本名不存在都返回 0）

2026-11-27 实测：执行 `pnpm --filter @kedouai/ai-agent build`，输出 `No projects matched the filters`，但**退出码是 0**。在 `set -e` 或 CI 里看起来是构建成功，实际一个包都没构建，产物时间戳不变。

原因是包名写错：`@kedouai/` 前缀只属于 `packages/agent-core`，服务包实名是 `@web-system/ai-agent`。

**但包名只是第一种成因。** `--filter` 的「脚本通道」还有第二种静默：**包名全对、只是脚本名不存在时，退出码同样是 0**。下面五形态实测把两类一起摆出来。

**五形态实测**（全部 `out=$(cmd); c=$?` 捕获，**未走管道**）：

| # | 形态 | 命令 | 退出码 | 输出 | 判定 |
|---|---|---|---|---|---|
| 1 | `--filter` + `run` + 缺脚本 | `pnpm --filter deploy-console-server run __no_such_script__` | **0** | `None of the selected packages has a "__no_such_script__" script` | ❌ 静默 |
| 2 | 形态 1 + `--fail-if-no-match` | 同上加该 flag | **0** | 同上 | ❌ **flag 不覆盖** |
| 3 | `--filter` **简写**（本节示例就是这种写法） | `pnpm --filter deploy-console-server __no_such_script__` | **0** | 同上 | ❌ 静默 |
| 4 | 包目录内直跑 | `cd servers/deploy-console && pnpm run __no_such_script__` | **1** | `ERR_PNPM_NO_SCRIPT  Missing script: …` | ✅ 正确失败 |
| 5 | `--filter` + `exec` 子进程失败 | `pnpm --filter deploy-console-server exec node -e "process.exit(3)"` | **1**（非 3） | `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command failed with exit code 3` | ⚠️ 失败可见，退出码被压成 1 |

**第二种成因与判据的关系（判据本身没错，是覆盖不全）**：

- **现象**：`pnpm --filter <pkg> <script>`（简写、不带 `run`）在**脚本名不存在**时，打印 `None of the selected packages has a "<script>" script`，但**退出码 0**。包名全对也一样。
- **位置**：这正是下方判据 1 示例所用的形态，**读者最容易顺手沿用**。
- **缺口只在判据 1**：判据 1 只防「包名写错」，对「包名对、脚本名错」不覆盖。判据 2（验产物时间戳）与判据 3（`--reporter=append-only` 看有没有真的执行 build 步骤）**对两类成因都有效**——脚本没跑，产物就不会更新，append-only 下也看不到任何 build 步骤。
- **所以判据 2/3 是必守项，不因其「看起来像辅助手段」而省略**；要根治则改用安全形态（见判据 4）。

判据（建议 1+2 叠加；构建/测试一律追加 4）：

1. 先在 workspace 里确认包名存在：`pnpm ls --filter @web-system/ai-agent --depth -1`。命令侧可加 `--fail-if-no-match`，让「无匹配」直接非零退出（pnpm 9.15.0 实测生效；注意**顶层 `pnpm --help` 不列该 flag**，要看 `pnpm run --help`）。
   ⚠️ 该 flag 只守「没有项目匹配到 filter」，**不覆盖**「匹配到项目但脚本不存在」——后者仍是 exit 0（形态 1/2/3）。**它不是解法，只是补丁；不要理解成「加了 flag 就安全」。**
2. 构建后**必须验产物**，不要只看退出码：`ls -l servers/ai-agent/dist/main.js`（时间戳应为本次）+ `grep -c "TOKENHUB_API_KEY" packages/agent-core/dist/clients/hy3.client.js`
3. 用 `--filter ... --reporter=append-only` 观察是否真的执行了 build 步骤
4. **命令形态本身就是判据**：构建/测试优先 `cd <pkg> && pnpm run <script>`（缺脚本 exit 1，错误自动暴露）或 `pnpm --filter <pkg> exec <cmd>`（失败非零，`set -e` 抓得住）；**只要用了 `--filter` 的脚本通道（含简写），就必须配判据 2 的产物校验，不认退出码。**

**包名不能从目录名推**（27 个 workspace 包里有 4 个例外，2026-11-27 实测）：`deploy-console` 出现两次且两个包名都无作用域 —— `servers/deploy-console` → `deploy-console-server`、`apps/deploy-console` → `deploy-console-web`；`packages/kedou-agent` → `kedou-agent`；`packages/agent-core` → `@kedouai/agent-core`（全仓唯一 `@kedouai`）。猜 `--filter @web-system/deploy-console` 会两个都匹配不到、都 exit 0。

**取证方法**（管道会吞掉退出码，本案两个角色各踩过一次，是高频陷阱而非个人粗心）：

- ❌ `cmd | tail -5; echo $?` —— 拿到的是 **`tail`** 的退出码。曾因此差点把「缺脚本 exit 0」这个结论建在假数据上。
- ✅ `out=$(cmd 2>&1); c=$?`
- 必须用管道时：`zsh` 是 `$pipestatus`（小写、1-based），`bash` 是 `PIPESTATUS`（大写、0-based），两者不可混用。

**CI 现状（恰好安全，不是按安全形态写的）**：`quality-gate.yml:204-205` 用 `pnpm --filter … exec vite build`，落在形态 5（失败可见），当前不需要改。第 203 行的多包简写 `pnpm --filter … build` 落在形态 3，现值涉及的 4 个包（shared / types / ui / agent-message）都确有 `build` 脚本，所以**暂时**不会静默 —— 这是「恰好安全」：任一包把脚本改名，该行就会不报错地跳过它。

同一模式适用于所有 `--filter` 用法，不限于构建。

---

## 4. 端口 / 孤儿进程纪律

| 端口 | 服务 | 谁依赖它 | 冲突点 |
|---|---|---|---|
| **6000** | gateway（基座 + API + 微前端 manifest） | 所有前端 / API | 全停 = 全部白屏 |
| **6200** | deploy-console | 发布工具自身 | restart 自杀式；孤儿进程最多 |
| 5180 | shell vite dev | 基座开发 | 与 5173/5174 同机并存 |
| 5173 / 5174 | portal / admin vite dev | 单模块 HMR | `scripts/start-frontend.sh` 会 kill 这三个端口 |

🔴 **纪律**：
- 杀进程前先 `lsof -ti:<port>` 探清楚持有者，**禁 `kill -9` 别人正在用的共享服务**（6000 / 6200）。
- 自己的临时 dev server（5173/5174/5180）用 `start-frontend.sh` 自己管理；别顺手杀 6000/6200。
- 真要重启 6000/6200，先跟占用方（其他会话）打招呼——它是**共享基础设施**，不是你一个人的。

---

## 5. 微前端本地验证（看页面 / 验收）

四步铁律（`docs/development/admin-dev.md` §一·C，权威）：**构建(mf) → 拷贝到发布目录 → 改版本表 `web_system_deploy.deploy_deployments.currentVersion` → 等 10s 缓存或 `pm2 restart web-gateway`**。纯看页面直接访问 `https://local.kedouai.com/admin/`，不需要起 vite dev。

- 前端 mf 构建：`pnpm --filter <模块> build --mode mf`（普通 `build` 出的是 SPA，shell 加载不了）。
- 发布入口：`web-system-deploy` skill（agent 唯一发布入口）；deploy-console 自身**永远手动**（`scripts/publish-deploy-console.sh`）。
- vite dev（单模块 HMR）：`bash scripts/start-frontend.sh` 起 portal 5173 / admin 5174 / docs 4173；shell 自带 5180 反代 `/api` `/static` 到 6000。这是辅助通道，**不是**集成微前端 shell 体验。

---

## 6. 与其他文档的关系（不复制正文）

| 文档 | 角色 |
|---|---|
| `~/AiWorkspace/20-私域资产/Vibe Coding 治理规范.md` | 🔴 方法论真源（五层模型，尤其 ③ 执行隔离层） |
| `~/AiWorkspace/30-任务产物/2026-11-06-vibe-coding五层治理/`（00–08 + 图） | 历史记录 / 分析归档（19 条自检 × 真实载体、热力图、实践方案），已冻结，引用上方真源 |
| `docs/development/local-dev-guide.md` | 本地开发总入口（端口 / 服务清单 / 脚本索引） |
| `docs/development/admin-dev.md` §一·C | 微前端四步铁律（权威） |
| `docs/development/dev-workflow.md` | 三区分离工作流 ⚠️ **其中 `web_system_dev` worktree 已不存在**，以本文 §1 舰队为准 |

---

## 7. 自查清单（每次开并行会话前过一遍）

- [ ] **A**：开工前跑了 `git worktree list`，确认非主仓 worktree >1 → 进入多 agent 模式，本纪律全员适用
- [ ] **C**：已在 `web_system/.agent-roster/<session-id>.json` 注册自己（只写自己的文件）
- [ ] **B**：协作起始已往 `~/AiWorkspace/.workbuddy/memory/YYYY-MM-DD.md` 追加一行（worktrees + roster）
- [ ] 我认领了自己的 worktree，没在主仓（发布源，只留 master）直接开发或切分支改代码
- [ ] 提交前 `git branch --show-current` + 逐路径 `git add`（禁 `-A`）
- [ ] 构建在自己 worktree cwd（不是发布源）
- [ ] 不 `kill -9` 6000/6200；要重启共享服务先打招呼
- [ ] 改完 `curl http://127.0.0.1:6000/__manifest__` 或 `bash scripts/health-check.sh local` 验版本

---

## 8. 协作态信号操作（A/B/C 落地命令）

### C · 注册 / 注销（repo 持久真源）
- 开工（认领 worktree 后）：写 `web_system/.agent-roster/<session-id>.json`
  ```json
  {
    "sessionId": "<唯一，如 workbuddy-<timestamp>-<rand>>",
    "worktree": "web_system-sdd",
    "branch": "feat/approval-lifecycle",
    "task": "<一句话任务>",
    "startedAt": "2026-11-07T07:40:00+08:00"
  }
  ```
- 收工 / 会话结束：删掉自己的文件 `rm web_system/.agent-roster/<session-id>.json`（**只删自己那份**，禁批量 `rm -rf`）。
- 查活跃：`ls web_system/.agent-roster/`。`.agent-roster/` 已加 `.gitignore`，绝不入仓。

### A · 自发现（每次开工第一步）
```bash
cd ~/workspace/web_system && git worktree list
# 非主仓 worktree > 1 → 处于多 agent 模式，本文件纪律全员强制适用
```

### B · 总控上报（协作起始一次）
往 `~/AiWorkspace/.workbuddy/memory/YYYY-MM-DD.md` 追加：
> web_system 多 Agent 协作活跃 · worktrees: `<git worktree list 输出>` · roster: `~/workspace/web_system/.agent-roster/` · 任务: <简述>

---

## 9. 惨痛教训 · 2026-11-09 纪律曾失效（印证 §0 静默互覆）

纪律文件（本文 + `AGENTS.md`）曾于 11-07 被提交到 `feat/mf-browser-safety` 分支，而主仓 `web_system` 被切到 `docs/nce-spec-copyright-fix`（feature 分支）。后果：**进主仓的 agent 完全读不到纪律，闸门在发布源失效**——正是 §0 警告的「静默互覆」现场（治理文件被分支漂移冲走，无报错）。

修复（甲方案）：将纪律 commit 通过 `git cherry-pick` 引入 master，把 `web_system-assetorigin` 从 master 移出到 `feat/assetorigin` 腾出 master，主仓切回 master。闸门恢复。

🔴 **纪律**：治理 / 纪律类文件（含 `AGENTS.md`、本文）**必须始终活在 master（发布源）**，禁止只留在某个 feature 分支。任何把主仓切到 feature 分支的动作，都等于主动撤掉闸门。

---

**维护**：本文是 web_system 工程内执行纪律真源。方法论变动去改 20-私域资产规范；本工程内的 worktree 舰队 / 端口 / 构建坑变动改本文。两类都不复制对方正文。
