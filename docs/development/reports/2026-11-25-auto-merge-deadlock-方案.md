# auto-merge 自指死锁治本修复 · 技术方案 · 2026-11-25

阻塞: 0

| 项 | 值 |
|---|---|
| 版本 | v1.0 |
| 负责人 | rd-engineer（研发部 · bug 修复链路 B） |
| 关联需求 | PR #666 自动合入挂载失败（`unstable status`）；lead 一手诊断 run 45548361139 |
| 目标分支 | `fix/auto-merge-unstable-deadlock-20261125`（基于 origin/master `c9684908`） |
| worktree | `/Users/geekwen/workspace/web_system-automerge` |
| 改动面 | `.github/workflows/auto-merge.yml` + `scripts/verify-workflows.mjs`（测试） |
| 凭证 | 本文件（Plan/方案）；实现 commit 带 `Release: pass` + `TestScope: pass` |
| 状态 | 方案先行落盘（R1/R3 门禁：方案 commit 必须早于代码 commit） |

---

## 1. 背景与目标

### 1.1 现象

PR #666 打开后自动合入挂载失败：

```
PR #666 启用自动合入失败：Request failed due to following response errors:
  - Pull request Pull request is in unstable status
```

日志定位到 run 45548361139 / 04:40:14Z，失败在 `enable-auto-merge` job 的「启用自动合入（merge）」step。

### 1.2 根因（自指死锁，已确诊）

1. `enable-auto-merge` 在 `pull_request`（opened/reopened/ready_for_review/synchronize/labeled/unlabeled）**瞬间**执行；此刻本 PR 的必需检查（`红线扫描（R9–R14）`、`改动包 build/test`，见 `docs/development/auto-merge-setup.md` §2）通常仍 pending → `mergeStateStatus=UNSTABLE`；
2. GitHub 拒绝对 unstable PR 执行 `enablePullRequestAutoMerge`（返回 `unstable status`）；
3. 脚本 `core.setFailed` → 该 job 自身变 failed check；
4. 这个 failed check 又反过来维持 PR 的 unstable 状态；
5. **致命点：没有重试触发点** —— 后续 CI 全绿后没有任何事件重新触发 enable 挂载 → 永久卡在「全绿但没挂自动合入」。

配置三项（`Allow auto-merge=true`、merge commit 允许、token `pull_requests:write`）已由 lead 核实满足，**不是根因，本次不动**。

### 1.3 目标

- **G1**：CI 全绿后可靠挂上 auto-merge（补上缺失的重试触发点）。
- **G2**：时序性 unstable 不再制造永久自锁（不判红、不留下 failed check）。
- **G3**：真失败（配置/权限/其他非时序错误）仍必须判红暴露 —— 不倒退 #396「降级 warning → 全绿静默不合半年没人发现」的教训。
- **G4**：保留全部既有安全承诺（见 §3.4 逐条）。

### 1.4 Non-goals（明确不做）

- 不改分支保护必需 check 配置、不改仓库 Settings、不碰 Secret。
- 不改业务代码、不改 `auto-pr.yml`（理由见 §2.4）。
- 不合并 PR、不发布、不部署。
- 不追求「挂载失败时自动降级为人工合入」—— 那是语义倒退，不是治本。

---

## 2. 方案设计

### 2.1 架构与数据流（改后）

```
PR opened/synchronize/labeled/... ──┐
                                    ├─► enable-auto-merge job ──► 读 PR（GraphQL）
quality-gate completed=success ─────┘         │
        (workflow_run，新增重试点)              ├─ 已挂 → 幂等跳过
                                               ├─ 非 OPEN/draft/manual-review/no-automerge → 跳过
                                               ├─ enablePullRequestAutoMerge（GraphQL）
                                               └─ 结果分类：
                                                    ├ 成功 → 回查 autoMergeRequest 非空 → 绿
                                                    ├ 时序性 unstable → notice（不判红），等下一次事件重试
                                                    └ 其它错误（配置/权限/…）→ setFailed（判红）
```

关键点：**判红与否按错误性质分流**，而不是「一律红」或「一律 warning」。

### 2.2 页面清单

无（纯 CI workflow 改动，无 UI 改动，无 page-spec 需求）。

### 2.3 接口清单（GraphQL，沿用既有）

| 用途 | 类型 | 名称 | 变量 | 变化 |
|---|---|---|---|---|
| 读 PR 状态 | query | `repository.pullRequest{ id state isDraft labels headRefName autoMergeRequest }` | `$owner:String! $repo:String! $num:Int!` | 增加 `isDraft/labels/headRefName`（供 workflow_run 路径复核逃生口） |
| 挂载 | mutation | `enablePullRequestAutoMerge` | `$id:ID! $m:PullRequestMergeMethod!` | 不变；带有限重试 |
| 同步 | mutation | `updatePullRequestBranch` | `$id:ID! $oid:GitObjectID!` | 不变（本次不碰） |
| 撤销 | mutation | `disablePullRequestAutoMerge` | `$id:ID!` | 不变（本次不碰） |

REST 侧无 enable 动作、octokit 无 `enableAutoMerge` 方法（#396），继续只用 GraphQL。

### 2.4 配置清单 / 为什么只改 auto-merge.yml

| 文件 | 改什么 | 理由 |
|---|---|---|
| `.github/workflows/auto-merge.yml` | ① `on` 增加 `workflow_run`（`workflows: [quality-gate]`, `types: [completed]`）；② enable job 的 `if` 兼容两种事件；③ enable 脚本支持两种 payload 取 PR 号、逃生口复核、unstable 分类与有限重试；④ 校验 token step 对 workflow_run 也执行 | 治本主战场 |
| `scripts/verify-workflows.mjs` | 新增静态断言 + mock 行为用例（含两种 payload、unstable 可恢复、真失败判红、逃生口复核）+ 变异验证 | TDD 测试，随代码同 commit |
| `.github/workflows/auto-pr.yml` | **不改** | 它的 enable 逻辑只在 `push` 建 PR 时跑一次，本来就是「只 warning、由 auto-merge.yml 兜底并判红」的辅助角色（文件内注释已声明）。本修复把兜底与判红集中在 auto-merge.yml，auto-pr.yml 的 warning 语义无需变化；改它反而扩大改动面、引入第二套 payload 兼容逻辑。质量门静态断言继续覆盖它没回归。 |

### 2.5 依赖系统

- GitHub Actions `workflow_run` 事件：payload 与 `pull_request` 不同，PR 号来自 `workflow_run.pull_requests[].number`（不是 `payload.pull_request.number`）。
- `quality-gate` workflow（`name: quality-gate`，`on: pull_request: branches:[master,main]` + `workflow_dispatch`）完成且 `conclusion=success` 时触发本 workflow 的 enable job。
- `AUTO_PR_TOKEN`（PAT）：`pull_requests:write` 挂载、`contents:write` 同步，沿用，不改。

### 2.6 关键设计决策（正面论证 + 被否方案对比）

| 决策 |  chosen | 为什么 |
|---|---|---|
| 重试触发点 | `workflow_run`（quality-gate `completed` + `conclusion=success`） | GitHub 一等事件，payload 自带 `pull_requests[]` 与 `conclusion`，语义正好是「必需检查跑完了」；从 default branch 的 workflow 定义生效，合并到 master 后自动生效 |
| unstable 分类 | 匹配 `unstable status` → notice 不判红；其余 → setFailed | 满足 G2+G3：时序性不制造 failed check，真失败照红 |
| 是否 wait 轮询 | 最多 3 次、5s 间隔的**有限重试**（仅对 unstable） | 覆盖「quality-gate 刚绿、GitHub mergeStateStatus 尚未刷新」的传播窗口；有限次避免长挂 |
| 是否改 `pull_request` 触发 | 不改，保留 | labeled/unlabeled 给 disable job 用；去掉会破坏双向标签逃生口 |

**被否方案**：

1. **仅把 enable 失败降级为 warning**（历史 #396 做法）—— 直接违反 G3；#396 已证明会导致「全绿静默不合半年没人发现」。否。
2. **只加 workflow_run，不处理 unstable 判红** —— 首次 `pull_request` 事件仍 setFailed，留下 failed check；按 lead 诊断该 failed check 仍参与构成 unstable，后续 workflow_run 重试仍会被拒 → 死锁未解。否。
3. **`check_suite` completed 触发** —— 更底层、更吵（每个 suite 都触发），payload 取 PR 号更绕；`workflow_run` 是 GitHub 推荐的一等模式，直接用。否。
4. **在 enable job 内长轮询等 CI 绿** —— 占 runner 分钟、超时即红、遇到「永不绿」或 BLOCKED 无解；有限重试 + 事件驱动更稳。否。
5. **把 enable 触发整体挪到 checks 后（删 pull_request 触发）** —— 破坏 labeled/unlabeled 的 disable 链路，且失去 opened 时「CI 已绿则立即挂」的快速路径。否。

### 2.7 逃生口语义保留清单（G4，逐条可验）

| # | 语义 | 保留方式 |
|---|---|---|
| 1 | `no-automerge` 标签双向（enable 排除 + disable job 撤销） | pull_request 路径 `if` 排除不变；workflow_run 路径在脚本内复核 `labels.nodes[].name` 含标签则跳过；disable job 完全不动 |
| 2 | draft PR 不挂 | pull_request 路径 `if` 不变；workflow_run 路径脚本复核 `isDraft` 跳过 |
| 3 | fork PR 跳过 | pull_request 路径 `if` 不变；workflow_run 路径 job `if` 校验 `head_repository.full_name == github.repository` |
| 4 | `feature/manual-review/` 前缀跳过 | pull_request 路径 `if` 不变；workflow_run 路径 job `if` 校验 `head_branch` 前缀 + 脚本复核 `headRefName` 前缀 |
| 5 | `sync-behind-on-master` commit 比较判据（不用 mergeable_state）+ warning 不判红 | 该 job 一个字不动，静态断言继续守护 |
| 6 | disable job 422「已进合并流程」降级 warning | 该 job 一个字不动 |
| 7 | 幂等：已挂 `autoMergeRequest` 跳过 | 两条路径共用「先读后挂」逻辑 |
| 8 | 挂载/同步 GraphQL + `GitObjectID!` | mutation 不变，静态断言继续守护 |

### 2.8 数据结构 / 初始化数据 / 权限

无 DB / 无迁移 / 无权限项变更。workflow 的 `permissions` 块保持不变。

### 2.9 接口设计约束

- 读 query 新增字段均为 PullRequest 标准字段，变量类型 `$num:Int!` 不变。
- workflow_run 的 `pull_requests` 可能是空数组（如 `workflow_dispatch` 触发 quality-gate）→ 脚本必须安全结束，不得报错。
- 对读到的每个 PR 逐个复核逃生口，任一不满足即跳过该 PR，不影响同批次其它 PR。

---

## 3. 影响面与风险

| 面 | 影响 | 风险级别 |
|---|---|---|
| CI workflow 触发频率 | 每次 quality-gate 成功多跑一次 enable job（只读 + 可能一次 mutation） | 低（本仓库 PR 个位数） |
| 分支保护 | 不变 | 无 |
| 既有 PR 行为 | pull_request 路径：unstable 从「判红」变「notice」；其它错误仍判红 | 中（需靠变异测试守住真失败判红） |
| workflow_run 安全 | 从 default branch 定义生效；fork PR 在 job `if` 被挡；不 checkout 任何代码 | 低 |
| 回滚 | revert 单个 commit 即恢复旧行为 | 低 |

**兼容性**：`workflow_run` 事件下 `sync-behind-on-master` / `disable-auto-merge` 的 `if` 因 `github.event.pull_request` 为空而自动跳过，不会误跑；已用表达式语义核对。

---

## 4. 测试方案（TDD）

### 4.1 测试基建

沿用 `scripts/verify-workflows.mjs`（离线 YAML 解析 + 内嵌 script 语法 + vm mock 行为 + 可选 `--schema` 线上 introspection）。**先写失败用例（红）→ 改 workflow（绿）→ 变异验证**。

### 4.2 新增静态断言（离线）

- S1：`on.workflow_run` 含 `workflows: [quality-gate]` 与 `types: [completed]`。
- S2：enable job `if` 同时覆盖 `pull_request` 与 `workflow_run` 两条路径，且 workflow_run 分支含 `conclusion == 'success'` 与 `head_repository.full_name == github.repository`。
- S3：enable 脚本含 unstable 分类判据（`unstable status` 匹配），且区分 notice 与 setFailed 两条出口。
- S4：既有断言全绿（无 `rest.pulls.enableAutoMerge`、`$oid:GitObjectID!`、无 `pr.base.sha`、无 `mergeable_state`、master push 触发仍在）—— 证明未倒退。

### 4.3 新增行为用例（mock）

| ID | 场景 | 期望 |
|---|---|---|
| B1 | workflow_run payload（`pull_requests[].number`）| 正确取到 PR 号并挂上，无 setFailed |
| B2 | workflow_run `conclusion != success` | 不挂、不判红 |
| B3 | workflow_run 关联 PR 带 `no-automerge` 标签 | 跳过该 PR，不发 mutation |
| B4 | workflow_run 关联 PR 是 draft | 跳过 |
| B5 | workflow_run 已挂 `autoMergeRequest` | 幂等跳过 |
| B6 | enable mutation 首次返回 `unstable status`，第二次成功 | 有限重试后挂上，**setFailed=0** |
| B7 | enable mutation 持续 unstable（超过重试上限） | **setFailed=0**，留下 notice（不制造 failed check，等下次事件） |
| B8 | enable mutation 返回真失败（权限/配置错误，非 unstable） | **setFailed>0**（判红，不倒退 #396） |
| B9 | mutation 名被改错（负向回归 #396） | setFailed>0（已有用例 4 覆盖 pull_request 路径） |

### 4.4 变异红绿验证（证明测试真的会抓）

- **M1（unstable 可恢复）**：把 workflow 里的 unstable 分类删掉（让它走真失败分支）→ B6/B7 必须由绿转红（证明测试能抓「自锁回流」）。
- **M2（真失败判红）**：把 `core.setFailed` 删掉（模拟 #396 降级 warning）→ B8 必须由绿转红（证明测试能抓「静默不合」）。
- 两者都在临时副本上变异、跑测试、记录输出，不改最终交付文件。

### 4.5 功能测试用例矩阵（人工走查 / 上线后观察）

| 用例 | 场景 | 预期 |
|---|---|---|
| TC-01 | 新 PR 打开，CI pending | enable job 绿（notice unstable），不出现 failed check |
| TC-02 | 该 PR quality-gate 全绿 | workflow_run 触发 enable，autoMergeRequest 挂上 |
| TC-03 | 已挂 PR 再推提交 | 幂等，重复挂载不报错 |
| TC-04 | 打 `no-automerge` 标签 | enable 跳过、disable job 撤销；workflow_run 后也不重新挂 |
| TC-05 | 权限错误（token 缺 pull_requests:write） | enable job 判红暴露 |
| TC-06 | fork PR / draft / manual-review 前缀 | 全程跳过 |

### 4.6 回归范围

`node scripts/verify-workflows.mjs`（全部既有用例）+ `--schema`（线上 GraphQL 类型核对，需 gh 登录；失败如实记录不伪造）。

---

## 5. 发布任务清单（本任务为 workflow 改动）

- 阶段 0：方案凭证落地并先于代码 commit（本文件）。
- 阶段 1：TDD 实现（红→绿），commit 带 `Release: pass` + `TestScope: pass`。
- 阶段 2：只出 PR，不合并；PR 用 **draft** 或打 `no-automerge` 标签（刚踩过的坑：改 workflow 的 PR 自己被秒合）。
- 阶段 3：跑 `node scripts/verify-workflows.mjs [--schema]` 与变异验证，逐条落 V1…Vn 证据。
- 阶段 4：本任务**不做发布/部署**（按 lead 指令）。workflow 改动在 PR 合并到 master 后由 GitHub 自动生效（workflow_run 从 default branch 读取定义）。

---

## 6. 回滚预案

| 层 | 回滚方式 | 限制 |
|---|---|---|
| workflow | revert 实现 commit（单个 commit） | 回滚后恢复旧行为（含原死锁），仅作应急 |
| PR | 关闭 / draft 化 | 立即阻止自动合入 |

无数据层变更，无不可回滚项。

---

## 7. 验收标准（V1…Vn）

| 判据 | 内容 | 通过标准 |
|---|---|---|
| V1 | worktree/分支/基线 | 分支名与 worktree 路径正确，基线 commit `c9684908`，方案 commit 早于代码 commit |
| V2 | YAML + 脚本语法 | `verify-workflows.mjs` 的 yaml/syntax 用例全绿 |
| V3 | 静态回归未倒退 | 既有无 `rest.pulls.enableAutoMerge`、`$oid:GitObjectID!`、无 `pr.base.sha`/`mergeable_state`、master push 触发全绿 |
| V4 | 新增 workflow_run 触发与 payload 兼容 | S1/S2/B1/B2 全绿 |
| V5 | unstable 可恢复（不判红） | B6/B7 全绿（setFailed=0） |
| V6 | 真失败判红（不倒退 #396） | B8/B9 全绿（setFailed>0） |
| V7 | 逃生口语义保留 | B3/B4/B5 + 既有 disable/sync 用例全绿 |
| V8 | 变异红绿 | M1、M2 均「变异后测试由绿转红」 |
| V9 | 门禁 trailer | 实现 commit 带 `Release: pass` + `TestScope: pass`，本地 hooks 不拦 |
| V10 | PR 状态安全 | PR 为 draft 或带 `no-automerge` 标签，有证据 |

---

## 8. 附录：追溯矩阵

| 需求 | 设计项 | 改动项 | 测试用例 | 发布项 | 验收 |
|---|---|---|---|---|---|
| G1 CI 全绿可靠挂载 | §2.1/2.6 | workflow_run 触发 + 脚本双 payload | S1/S2/B1 | PR 合并到 master 后生效 | V4 + V10 |
| G2 unstable 不自锁 | §2.6/2.7 | unstable 分类 + 有限重试 | B6/B7 + M1 | 同上 | V5 + V8 |
| G3 真失败判红 | §2.6 | 非 unstable → setFailed | B8/B9 + M2 | 同上 | V6 + V8 |
| G4 逃生口保留 | §2.7 | 双路径复核 + 不动 disable/sync | B3/B4/B5 + 既有用例 | 同上 | V7 |
| #396/#409 不回归 | §2.3/4.3 | 静态断言 | 既有 S4 + 用例 4 | 同上 | V3 |

---

## 9. 阻塞与待确认

阻塞: 0

无待确认项。若 `--schema` 因本机 gh 未登录失败，如实记录为「未含线上 schema」，不伪造通过。
