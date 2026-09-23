# 后端远端（dev / prod）发布能力补齐

> 建立：2026-09-23 ｜ 状态：**B1 / B2 已实施并在 dev 实证通过**（含受控回滚演练）；B3~B5 待做
> 授权记录：Q1~Q5 按本文推荐执行；需要动目标机 / 库的操作已获授权（执行时会先打印将要变更的内容）
> 实现：`scripts/migrations/p26-remote-backend-release.mjs`（PR #132）｜实证、事故与教训见 §11
> 相关：`specs/pipeline-restart-verify-as-action/design.md`（本方案的前身与留白出处）、
> `specs/pipeline-node-model/design.md`、`specs/pipeline-env-scripts/design.md`、
> `specs/release-platform/design.md`、`docs/development/local-release-runbook.md`、
> `docs/development/deploy-target-knowledge.md`

## 1. 问题：dev 上后端"发得出去、上不了线"

### 1.1 现象（2026-09-23 实测，system-service → dev）

把 `master` 的 `system-service` 发到 dev，流水线终态 **succeeded**，但：

| 检查 | 结果 |
|---|---|
| 产物 | 已投到目标机 `/data/web_system/servers/system-service/system-service-dev/3d5ce61`（268 文件） |
| 目标机运行中的 `dist` | 仍是 **旧时间戳**（未替换） |
| 进程 | pid / 启动时间 **未变**（未重启） |
| 新接口 | `GET /internal/storage/path` → **404**（旧代码在跑） |
| 版本指针 | **已指向新版本**（`[orchestration] 版本指针已指向 …`） |

最后一行是**状态撕裂**：版本记录说已上线，进程跑的还是旧代码 —— 只查「版本」会误判，必须以「进程启动时间 + 接口探活」为准。

### 1.2 根因（4 项，互相独立）

| # | 缺口 | 证据 |
|---|---|---|
| 1 | 模板的 **`dev` 分支任务没有 `restart` / `verify` 动作** | 14 条模板：`local` 分支 10 条挂有 `restart · 落地并重启（后端）` + `verify · 部署验证`；`dev` 分支 **0 条**，只有 `发布` + `write-version` |
| 2 | 控制台的独立「部署」入口已移除 | `apps/deploy-console/src/views/ServiceDetail.vue`：*"自 2026-09-21 起控制台不再有独立的「部署」动作…流水线跑完即上线"*；`api/index.ts` 同口径。只剩一个页面已不调用的 `POST /deploy/modules/:key/envs/:env/deploy` |
| 3 | 流水线 **`git` 节点不更新目标机仓库** | dev `/data/web_system` 仍停 `f05e12e`（旧），而本地发布目录已 `3d5ce61` |
| 4 | **目标机 workspace 包不随发布重建** | dev 的 `packages/shared/dist` 里没有 `SERVICE_URL_DEFAULTS` → 新产物启动即崩：`TypeError: Cannot read properties of undefined (reading 'auth')`（`auth.guard.ts:43`） |

> 出处：`pipeline-restart-verify-as-action/design.md` 当时状态为「已实施（local）…（dev / prod 待后续批次）」，并明确
> **"不做后端远程（dev/prod）发布的 restart/verify（远程后端发布能力本身就未实现）"**、Q5「后端远程发布本次不做 —— 确认」。
> 其后 `p18-backend-release-target` / `p19-backend-release-by-env` 补上了**远程投递**（版本目录 + scp），
> 但**生效（restart/verify）与目标机依赖完整性**始终没补 —— 本方案就是这两块。

### 1.3 影响面
- 只影响**后端**的 dev/prod 发布；前端（micro-frontend）「切指针即生效」不受影响；`deploy-console` 自身走传统发布脚本。
- 目前状态：**dev 上任何后端模块发布都无法真正上线**（要么停在旧版本，要么像 system-service 那样指针先行、运行落后）。

## 2. 目标 / 非目标

**目标**
1. dev 的后端发布恢复「审批一次 → 投递 → 落地 → 重启 → 探活 → 切指针」的完整语义（与 local 等价）。
2. 任何阶段失败：**不切指针**、目标机回滚到上一份 `dist`、流水线终态 `failed` 且日志给出可执行原因。
3. 目标机的运行依赖（`packages/*/dist`）与服务产物保持一致，消除「启动即崩」。
4. local 行为不变（回归零影响）。

**非目标（本次）**
- prod 发布（端口 3000 系差异、主密钥域、多机）→ 另轮，但设计需预留。
- 灰度 / promote / 回滚编排（已有能力，不重做）。
- 控制台前端改造（除非 Q1 选择"恢复手动部署入口"）。

## 3. 现状机制（实现者须对齐的事实）

- **脚本都在本机（控制台所在机）执行**：远端分支脚本自己 `ssh` 出去（现有 `发布`（dev/prod 远程）脚本即如此）。
- **步骤按 `condition` 选分支任务**（`pipeline/steps/step-branch.ts`）：命中第一个条件为真的任务，否则用条件为空的那条兜底。
- **可用变量**（`resolveStageVars`，节选）：`DEPLOY_ENV / MODULE_KEY / MODULE_TYPE / MODULE_DIR / BRANCH / COMMIT_ID / RELEASE_DIR / STAGE / PM2_NAME / PM2_SCRIPT / PM2_CWD / PORT / BUILD_OUTPUT_DIR / DEPLOY_ROOT / DEPLOY_TARGET / CONSOLE_API / CONSOLE_TOKEN` + 配置中心同名键 +流水线变量（如 `PUBLISH_HOST / PUBLISH_USER / PUBLISH_KEY / PUBLISH_PATH`）。
- **改动作 = 改数据**：action 正文与挂载都在库（`deploy_pipeline_actions` / `deploy_pipeline_tasks`），因此变更必须做成**幂等迁移脚本**（沿用 `scripts/migrations/pXX-*.mjs` 惯例），否则别的环境（dev/堡垒机共用云库）不可重复。
- **local 版脚本语义**（作为对照，不照抄）：
  - `restart · 落地并重启（后端）`：依赖校验 fail-fast → 配置下发（仅 local）→ 产物守卫 → `dist.bak` 轮转（留 3 份）→ `版本目录 → dist` → `pm2 delete + start` 干净重启（规避 `--update-env` 污染与孤儿进程）。
  - `verify · 部署验证（后端）`：进程 online 轮询（12×2s）→ 端口 TCP 探活（3 次）→（MCP 相关服务）AI 链路端到端 → **通过后才切指针**。

## 4. 方案设计

### 4.1 新增 action：`restart · 落地并重启（后端，远端）`

对 `DEPLOY_ENV != local` 生效（挂到各模板的 dev/prod 分支任务，排在 `发布` 之后）：

1. **前置守卫（fail-fast，不落地）**
   - `MODULE_TYPE=backend`；`COMMIT_ID` / `PUBLISH_HOST` / `PUBLISH_PATH` 齐备；
   - 远端版本目录存在且**非空**（忽略 `*.tsbuildinfo`，沿用 local 版判据）；
   - 必要环境变量存在性校验（按模块，沿用 local 版那套 `case "${MODULE_KEY}"` 校验，如 `ai-agent` 的 `MCP_GATEWAY_URL`）。
2. **落地**（远端，一次 ssh 内完成，尽量原子）
   ```bash
   cd <PUBLISH_PATH>/servers/<MODULE_DIR>
   [ -d dist ] && mv dist dist.bak-$(date +%s)
   cp -R <COMMIT_ID>/. dist/
   ls -1dt dist.bak-* | tail -n +4 | xargs -r rm -rf      # 只留最近 3 份
   ```
3. **重启（候选名链）**：`pm2 restart ${PM2_NAME} || pm2 restart ${MODULE_KEY}`（沿用 `applyBackendRemote` 的候选链思路；dev 实际进程名为短名，本机为 `web-*`）。
   - 建议维持与 local 一致的**干净重启**（`delete + start`）语义；若目标机 pm2 记录不完整（脚本路径/cwd 依赖现状），则退化为 `restart` 并在日志里标注 —— 见 Q3。
4. **失败即回滚**：任一步失败 → 恢复 `dist.bak-*` → `pm2 restart` 回旧版本 → 退出码非 0（不切指针）。

### 4.2 新增 action：`verify · 部署验证（后端，远端）`

1. `ssh` 轮询进程 `online`（默认 12×2s，可通过变量覆盖）；
2. `ssh` 端口 TCP 探活（`/dev/tcp` 或远端 `ss/lsof`），**必须轮询 + 超时**，禁止固定 `sleep`；
   > 实测教训：dev 上 Nest 启动约 **14s**，固定 7s 判断会误判为失败。
3. 可选按模块做业务探活（内部接口带 `x-internal-key`，如本次的 `GET /internal/storage/path` 200）；
4. 通过后由平台 `pointer` 步骤切指针；不通过 → 退出非 0，**指针不前进**（旧版本继续服务）。

### 4.3 目标机依赖完整性（缺口 3 + 4）

两种做法，推荐 **A**（快、改动小），B 作为后续增强：

- **A（推荐）：远端分支的 `git` / `build` 补目标机步骤**
  - `git`（远端分支）：在目标机 `git fetch` → `git checkout -B <branch> origin/<branch>` → `git reset --hard`。
    ⚠️ **不得 `git clean -fd`**：目标机存在未跟踪目录（如 `servers/ai-agent/ai-agent-dev/`、各模块的 `<module>-dev/<commit>/` 版本目录），clean 会把它们删掉。
  - 新增 `deps · 预构建依赖包（远端）`（放在 `build` 之后、`发布` 之前）：在目标机按需重建 workspace 包
    `pnpm --filter @web-system/shared build`、`pnpm --filter @web-system/types build`（及其它被服务运行时 require 的包）。
    触发条件建议用**指纹**（`pnpm-lock.yaml` + 各包 `src` 摘要）判断，无变化即跳过，避免每次都编译。
- **B（增强，可后置）：产物自带依赖**
  把 `packages/*/dist` 一并打进投递 tar（或让服务产物不再依赖目标机包产物）。
  优点：目标机零 toolchain 依赖、可重复性最强；缺点：产物变大、需处理 pnpm 链接布局。

### 4.4 变量补充（新增，避免歧义）
| 变量 | 含义 | 来源 |
|---|---|---|
| `REMOTE_DIR` | 目标机发布根（`/data/web_system`） | 流水线变量 / 环境配置（复用 `PUBLISH_PATH` 的父目录语义） |
| `REMOTE_PM2_CANDIDATES` | 远端 pm2 候选名（空格分隔） | 默认 `"${PM2_NAME} ${MODULE_KEY}"` |
| `REMOTE_ONLINE_WAIT_TRIES` | online 轮询次数（默认 12） | 流水线变量，可覆盖 |
| `DEPS_REBUILD` | 是否强制重建目标机 workspace 包 | 默认按指纹判断 |

### 4.5 失败与回滚语义（强约束）
| 阶段 | 失败时行为 |
|---|---|
| `deps`（远端） | 不投递；目标机 `packages` 保持原样（先备份后替换，失败还原） |
| `发布`（投递） | 目标机版本目录可能残留半份 → 下次同 commit 覆盖（`rm -rf` 后重建，现有脚本已如此） |
| `restart`（远端） | 恢复 `dist.bak-*` → 重启旧版本 → 失败退出；指针不动 |
| `verify`（远端） | 视为失败：回滚 `dist` 并重启旧版本 → 指针不动 |

### 4.6 幂等与并发
- 发布锁已按 `(env, moduleKey)` 生效，无需新增。
- 脚本自身幂等：同 `COMMIT_ID` 重复执行不产生额外副作用；`dist.bak-*` 仅保留 3 份；`packages/*/dist` 替换前先备份（`dist.bak-<ts>`）并轮转。

## 5. 决策（已拍板：2026-09-23 全部按"推荐"列执行）
| # | 决策 | 推荐 | 理由 |
|---|---|---|---|
| D1 | 生效语义：补 `restart/verify`（发布即生效）**vs** 恢复控制台手动「部署」入口 | **补 restart/verify** | 与 2026-09-21 的既定方向一致；审批/审计/锁语义不变；手动入口会让"谁在什么时候上的线"离开流水线记录 |
| D2 | 依赖来源：目标机就地重建 **vs** 产物自带 | **先就地重建（A）**，prod 再评估自带（B） | 见效快、改动小；自带依赖涉及产物形态变更，宜单独论证 |
| D3 | 目标机仓库更新边界 | `fetch + checkout -B + reset --hard`，**不 clean** | 既保证源码与产物同源，又不动版本目录/未跟踪目录 |
| D4 | 回滚实现 | 脚本内 `dist.bak` 恢复 + 重启 | 与 local 一致、简单可审计 |
| D5 | 审批节点 | dev **保留**「发布确认」审批（现状不动） | 与本次目标无关；若要 dev 免审，用节点的 `condition` 单独一轮（`DEPLOY_ENV == "prod"`） |

## 6. 分批实施（每批独立可验证、可回退）
| 批 | 内容 | 验证 |
|---|---|---|
| B1 | 写 `restart（远端）` / `verify（远端）` 两条 action，**只挂 `system-service` 的 dev 分支** | ✅ **已实施并实证**（2026-09-23）：真实发布 succeeded；目标机 `dist` 时间 = 本次、进程重启时间 = 本次、`/internal/storage/path` **200**、指针与运行版本一致。**B1 同时承担原 A 的验收**（dev 上 system-service 真正上线）。受控回滚演练见 §11.3 |
| B2 | 目标机依赖完整性：`git` + `deps`（合并为一条 `sync（远端）`，按指纹短路） | ✅ **已实施并实证**（2026-09-23）：目标机仓库 `f05e12e → 3d5ce61`、`.env` 前置校验通过、首次重建 5 个包、第二次「指纹未变，跳过」；流水线内一次完整发布全链通过 |
| B3 | 推广到其余后端模块（`gateway` / `upload-service` / `user-service` / `ai-service` / `todo-service` / `mcp-gateway` / `content-hub` / `ai-agent` / …），逐模块各发一次验证 | 每模块终态 succeeded + 探活通过 + 版本指针与进程一致 |
| B4 | 导出**幂等迁移脚本**（`scripts/migrations/pXX-remote-backend-release.mjs`），供 dev / 堡垒机云库导入 | 在干净库上跑一遍，结果与本地库一致 |
| B5 | 文档：`local-release-runbook.md` 补 dev/prod 发布流程与失败排查；`deploy-target-knowledge.md` 记目标机边界 | 文档可照做 |

## 7. 验收判据（EARS）
1. 当对 dev 发布某后端模块且审批通过时，系统应在目标机把版本目录落地为 `dist` 并重启该服务，最终流水线 `succeeded`。
2. 当目标机重启后服务未在配定窗口内 online，或端口无响应、业务探活失败时，系统应恢复上一份 `dist` 并重启，流水线 `failed`，且**版本指针不前进**。
3. 当服务产物依赖的 workspace 包有新导出时，系统应在 `restart` 之前使目标机依赖与之匹配（否则不允许进入 `restart`）。
4. 当发布目标是 `local` 时，系统行为不得改变（含既有 `restart/verify` 脚本与模板）。
5. 当同一次发布（同 `COMMIT_ID`）重复执行时，不产生额外副作用（幂等）。
6. 每次发布完成后，版本指针所指示的版本必须等于目标机实际运行的 `dist` 来源（消除状态撕裂），且可由日志逐步核对。

## 8. 风险与缓解
| 风险 | 缓解 |
|---|---|
| 目标机 `reset --hard` 覆盖人工改动 | 变更前记录远端 HEAD 并打印；禁止 clean；文档写明"目标机不再接受手工改源码" |
| 目标机包重建耗时/失败 | 指纹判断跳过无变化；失败即终止（不投递/不重启），不影响在跑服务 |
| `pm2` 名不一致（`web-*` vs 短名） | 候选名链 + 失败日志列出候选项；B1 阶段在 dev 实测记录 |
| prod 与 dev 差异（端口 3000 系、密钥域、多机） | 本方案只对 dev 落地；prod 进 B1 的"同构性评估"清单，单独评审 |
| 与本次手工临时操作的**双轨** | 见 §9，B 落地后必须验证"从零状态可发布"，并回退手工痕迹 |

## 9. 本次已手工绕过的清单（B 落地后需收敛）
为把 `system-service` 发上 dev，本次在**目标机**做了如下临时动作（均为可回退）：
1. `upload-service/.env` 追加 `INTERNAL_API_KEY`（与 system-service 同值）、`STORAGE_ALLOWED_ROOTS=/data/web_system`、`STORAGE_UPLOAD_DIR=/data/web_system/uploads`（备份 `.env.bak-*`）；
2. `/data/web_system/packages/{shared,types}/dist` 替换为 master 构建产物（旧产物在 `dist.bak-1790132049`）；
3. `servers/system-service/dist` 的落地与回滚（`dist.bak-*` 轮转）；`system-service` 因失败重试导致 `restarts` 计数偏高（可 `pm2 reset`）。
> B2 完成后应验证：**在一台仓库落后、包产物陈旧的机器上，仅靠流水线即可完成发布**，然后回退上述手工痕迹。

## 10. 待确认问题（已全部拍板，2026-09-23）
| # | 问题 | 结论 |
|---|---|---|
| Q1 | 目标机是否允许流水线做 `reset --hard`？ | **允许**（按 D3：`fetch + checkout -B + reset --hard`，**不 clean**；执行前打印远端原 HEAD） |
| Q2 | `deps（远端）` 是否用指纹跳过？ | **用指纹跳过**：口径 = `pnpm-lock.yaml` 摘要 + 相关包 `src` 摘要（写入目标机 `.deps-fingerprint`）；无变化即跳过 |
| Q3 | 远端重启是否沿用 local 的干净重启？ | **沿用** `pm2 delete + start`：先 `pm2 describe` 快照现有记录（脚本路径 / cwd / name）用于构造 `pm2 start dist/main.js --name <名>`，并在日志打印；失败则按 §4.1 回滚（PORT 由服务自身 `.env` 提供，无需注入进程环境） |
| Q4 | 云库（dev / 堡垒机共用）由谁改？ | **授权执行**：先出幂等迁移脚本（`scripts/migrations/pXX-*.mjs`），本地库先跑；云库执行前**打印将变更的行**并留导出备份 |
| Q5 | prod 是否同批做？ | **不同批**：本次只落 dev；prod（多机、3000 系端口、主密钥域）在 B1 完成后单独评审 |

> 补充授权记录：本次在目标机上的手工动作（§9 清单）已获授权执行；B2 完成后按 §9 收敛并回退双轨。

## 11. 实施进度与实证（2026-09-23）

### 11.1 落地物
| 物 | 位置 |
|---|---|
| 迁移（幂等，含 `bash -n` 自检 / `DRY_RUN` / `ROLLBACK` / 动库前打印将变更行） | `scripts/migrations/p26-remote-backend-release.mjs` |
| 挂载结果（`tpl-system-service-dev` 的 `dev` 分支任务） | `发布(0) → write-version(1) → sync(5) → restart(11) → verify(21)` |
| 模块范围可覆盖 | `MODULES=a,b,c node scripts/migrations/p26-remote-backend-release.mjs`（B3 用） |

### 11.2 两次真实事故（都已修，教训写进脚本注释）
| # | 事故 | 根因 | 修法 / 影响 |
|---|---|---|---|
| 1 | 首次发布 `restart（远端）` 立即 exit 1 | `SSH="ssh -i …"` 后用 `"$SSH" host` 调用 —— 带引号的变量被当成**一个命令名** | 改 `rssh()` 函数；**目标机零影响**（ssh 未连出，已核对） |
| 2 | 第二次发布"succeeded"但服务 **crash-loop**（restarts 199、6004 无监听），且 `verify` 打印了"验证通过" | ① 目标机 `.env` 缺 `AUTH_SERVICE_URL`（master 起 production 强制 fail-fast，见 `packages/shared/src/services.ts:49`）→ 新产物启动即退；② `verify` **未检查 ssh 退出码**（会说谎）；③ 回滚只 `pm2 restart` 不够（实测须 `delete + start`） | ① 目标机 `.env` 补 `AUTH_SERVICE_URL=http://127.0.0.1:6001`（值取自该机 auth-service 的 PORT）；② `verify` 改为检查退出码 + **失败即回滚 dist 并重启旧版本**；③ 回滚加干净启动兜底 + 打印远端 pm2 日志尾部 |

### 11.3 受控回滚演练（B2 收尾，已通过）
流程：造一个"启动即崩"的版本目录 → 用落库后的 `restart` 脚本落地 → 用落库后的 `verify` 脚本判定。
实测：
- 坏版本落地后 `status=errored`、`restarts=18`、端口无监听（确认真的打坏了）；
- `verify`：`进程未 online（status=errored，已等 30s）` → `验证未通过 → 回滚` → `已回滚 dist ← dist.bak-…` → `回滚后进程状态 = online` → 打印远端 pm2 日志 → **退出码 1**（平台侧由此保证"指针不前进"）；
- 演练后清理，服务恢复 `restarts=0 / 6004 监听 / A2 200`。

### 11.4 目标机 `.env` 前置变量（B2 已加自动校验；**B3 需逐模块补齐**）
- 当前必需清单：`AUTH_SERVICE_URL`（dev/prod = `http://127.0.0.1:6001`；本机 = 6101）
- `sync（远端）` 会在 `NODE_ENV=production` 时校验并在缺失时 **fail-fast（不换 dist、不重启）**；
- B3 铺开时，**每个后端模块的 dev `.env` 都要先补齐**，否则会停在 `sync` 阶段（这是设计意图：宁可停在发布前，也不要"崩了再回滚"）。

### 11.5 与 §9 手工痕迹的收敛关系
- `packages/{shared,types}/dist` 的手工替换 **已被 `sync` 的自动重建取代**（指纹口径 = lock + 各包 src 与 package.json）；
- 目标机仓库陈旧（`f05e12e`）**已由 `sync` 的 `fetch + reset --hard` 治好**；
- 仍保留的手工项：`upload-service/.env` 的 `INTERNAL_API_KEY` / `STORAGE_ALLOWED_ROOTS` / `STORAGE_UPLOAD_DIR` —— 属 A3 的部署前置（不是 B 的范围），发 `upload-service` 前仍需；`system-service/.env` 的 `AUTH_SERVICE_URL` 属 11.4。

