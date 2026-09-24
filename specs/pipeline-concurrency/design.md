# 流水线并发：显式队列 + 按运行隔离工作区

> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
> **定位**：用「显式执行队列（下称 D）+ 每条流水线独立构建工作区（下称 B）」解决单机单发布目录的并发冲突；不引入运行时兼容模式，顺路拆掉改动路径上的历史包袱（§6.4）。
> 建立：2026-09-24 ｜ 状态：待确认 ｜ 范围：先 local 验证，dev/prod 后续
>
> 前置阅读：`specs/pipeline-node-model/design.md`（节点 / host 演进）、`specs/pipeline-step-task/design.md`（三层执行模型）、`specs/release-platform/design.md`（流水线执行与发布锁）
> 相关：`specs/deploy-console/artifact-path-and-deploy-model.md`、`specs/app-artifact-env-dir/design.md`、`specs/config-driven-deploy/design.md`

---

## 1 问题

### 1.1 现象

同一台机器上多条流水线并发推进时失败或产出串味。已观察到的形态：

- A 流水线在 `reset --hard` / `clean -fd`，B 流水线正在生成的 `dist` 被删除 → 构建产物残缺但未必报错；
- 两条 `admin` / `portal` 流水线各自 `pnpm --filter @web-system/shared build`，把对方刚建好的 dist `mv` 到 `/tmp` 再重建 → vite 解析失败（`servers/deploy-console/src/pipeline/steps/pull.executor.ts:11-18` 已作为既有并发缺陷记录）；
- 同一分支被反复 checkout，出现「构建通过但产物内容与 commit 不符」这类不可归因结果。

### 1.2 根因

**冲突资源的粒度与互斥粒度不对齐。**

| | 现状 | 证据 |
|---|---|---|
| 共享资源 | 发布目录是**全局单例**：`RELEASE_WORKSPACE` | `servers/deploy-console/src/pipeline/release-paths.ts:4-10`；读取点唯一且无参 `pipeline.service.ts:597-606` |
| 互斥粒度 | 发布锁键为 `moduleKey@env` | `servers/deploy-console/src/release-lock/release-lock.service.ts:32-34` |
| 结果 | `admin@dev` 与 `portal@dev`、同模块不同 env，**同时操作同一个目录**，锁不生效 | — |

会改动该目录状态的命令清单：

| 命令 | 位置 | 破坏性 |
|---|---|---|
| `git checkout -B` | `servers/deploy-console/src/git/release-git.service.ts:138-141` | 重写 HEAD / index / worktree |
| `git reset --hard` | `release-git.service.ts:144` | 丢弃工作区改动 |
| `git clean -fd` | `release-git.service.ts:147` | **删除未跟踪文件——含正在生成的 dist** |
| `git fetch` | `release-git.service.ts:74,137`；`pipeline.service.ts:1437-1439`（后台 fire-and-forget） | 写 `.git` 引用，与其他 git 操作重叠 |
| `pnpm install` + `.deploy-lock-hash` | `release-git.service.ts:10,161-166` | 重建共享 `node_modules` |
| 产物区写入 `artifacts/<module>/<env>/<version>` | `release-paths.ts:56-58` | 覆盖同名版本目录 |

### 1.3 影响面

| 受影响角色 | 影响 |
|---|---|
| 本地联调 | 一次改动引发多模块发布时，只能人工串行排队；并发必炸 |
| CI 触发 | `specs/ci-cd/gh-actions-release.md:84-86` 目前靠 GH `concurrency` group + 串行提交规避，**平台侧无能力，风险外移** |
| 远程发布（P1） | `specs/pipeline-node-model/design.md:261` 已记录「同一 host 上的发布需串行，否则互相覆盖产物 / 打架重启」，与本问题是同一个根因在远端的投影 |
| 手工运维 | `scripts/publish-deploy-console.sh:151`、`scripts/publish-ai-agent.sh:86` 对同一目录写操作，**完全绕过平台** |

---

## 2 目标 / 非目标

**目标**

- G1 多条流水线可同时提交并**排队可见**，而不是第二条直接 `failed`；
- G2 不同流水线之间**不共享可变状态**；
- G3 「多模块并发发布」的正确性由结构保证，不依赖使用纪律；
- G4 为后续多 worker / 多节点（`pipeline-node-model` P1 的 host + SSH）预留地基；
- G5 结构要经得起「真并行」——不是把并行挡住，而是让并行安全；
- G6 **不留历史包袱**：本次改动路径上的兼容分支、双写、旧变量一律顺手拆除（§6.4）。

**非目标**

- N1 不做分钟级构建加速（缓存 / CDN 类优化）；
- N2 不引入 RabbitMQ / Redis 等新中间件（队列存 DB，理由见 §5 D2）；
- N3 不重写 `orchestration-engine.ts`（三层 DAG 语义保持不变，只换它的 DI 注入面）；
- N4 不动 `pipeline-node-model` 的 step/task/action 三层模型本身；
- N5 **不引入运行时双路径**：不做 `off` / `new` 模式开关，不做兼容 shim（§5 D7、H1/H2）。

---

## 3 业界方案全景

业界处理「同一份资源被多个构建争抢」有五种范式。**结论先行：主流做法从来不是「加锁」，而是「隔离 + 只对真正的临界资源加锁」。**

### 3.1 五种范式

| 范式 | 代表 | 机制 | 并发能力 | 适用与代价 |
|---|---|---|---|---|
| **① 资源互斥（串行化）** | GitLab `resource_group`（作业级互斥队列）、GitHub Actions `concurrency` group（`cancel-in-progress` 可选）、Jenkins *Lockable Resources* / *Throttle Concurrent Builds* | 给作业声明它要独占的资源，调度器保证同时只有一个拿到 | 无，只是**排队**而非拒绝 | 改动最小；吞吐不提升，且救不了共享目录里的副作用 |
| **② 每作业独立工作区** | GitLab Runner `builds_dir` + `$CI_CONCURRENT_PROJECT_ID`（含 `builds_dir_is_shared` 配置项）、Jenkins Pipeline `ws()` / node 级 workspace、Buildkite agent checkout hook | 每个 job 有自己的 checkout + 构建目录，典型形态 `<builds_dir>/<project-slug>-<concurrent-id>` | **可并行**（受 runner `concurrent` 上限约束） | 主流基线。代价：依赖要重装（靠 store / cache 缓解）、磁盘 ×N |
| **③ 容器即工作区** | Concourse（官方口径 *Everything in Concourse runs in a container*，Task 的 inputs/outputs 显式传递）、Tekton（Task → Pod，Step → Pod 内容器） | 构建环境本身是一次性的；跨步骤数据必须**显式声明传递** | 高，天然隔离 | 上限最高，需要容器运行时 / K8s；当前单机场景不划算 |
| **④ 无共享可变状态（内容寻址）** | Bazel remote cache / sandbox、Nix store | 输入哈希 → 输出缓存，构建在只读沙箱里，产物按内容寻址 | 天然幂等可并行 | 最干净，但要求整套构建描述 Bazel 化，是重建级改造 |
| **⑤ GitOps 拉取式** | Argo CD / Flux | 没有「推送式发布工作区」；集群侧 controller 自己读 git 并应用 | N/A（消解问题） | 消灭了「发布机上的 git 工作区」这个角色，但要把发布模型改成声明式 |

### 3.2 业界的实际组合

没有大厂单用 ①。成熟组合是 **②（拿并行）+ ①（保临界资源）**：

- GitLab：默认每 job 独立 `builds_dir`（②）；同一环境的 deploy job 再用 `resource_group` 串行（①）。
- Jenkins：默认 job workspace（②）；需要独占设备/环境时用 *Lockable Resources*（①）。
- Atlantis / Terraform Cloud：默认每 PR 一个 workspace（②）；apply 前对本 workspace 加锁（①）。

**本设计的 D+B 正是这个组合在本仓库的落地**——它不是妥协，而是标准答案的本地化。

### 3.3 为什么不用 ①-only

锁粒度只能往粗推（全局只有一份目录），代价是把总吞吐压到单机串行；而且它**不解决 §1.2 里那些命令本身的破坏性**——锁只是让它们不同时发生，一旦有人手工或走旁路脚本执行，破坏立即回来。

### 3.4 为什么暂不做 ③

③ 需要容器运行时，且 `scripts/migrations/p26-remote-backend-release.mjs` 已落的远程发布、pm2 起停属宿主机语义。保留为长期方向：**本文的 worker 抽象按「可以在别的机器」设计（§5 D2），届时把 worker 进程换成 Pod 即可**。

---

## 4 方案设计（D + B）

### 4.1 核心切分：把流水线切成「便宜构建段」与「昂贵生效段」

现有流水线已隐含这个二分（`release-paths.ts:56-58`「产物区：投递到这里，**不直接生效**」），本文把它显式化为三类空间：

| 区 | 位置 | 谁写 | 生命周期 | 并发属性 |
|---|---|---|---|---|
| **构建区（新增）** | `<ws>/.runs/<pipelineId>/` —— per-run 的 git worktree | 拉码 / 安装依赖 / 构建 / 自检动作 | 单次运行，终态后 GC | **完全隔离 → 可并行** |
| **产物区（已有）** | `<ws>/artifacts/<moduleKey>/<env>/<version>/` | 投递动作 | 长期（版本保留） | 只增不改；同名 `moduleKey@env` 的**写入串行** |
| **部署区（已有）** | `<deployRoot>` + 版本表 + 磁盘指针 + pm2 | 切指针 / 重启 / 清理 | 长期 | **真临界资源 → 串行** |

于是：

- §1.2 里那些危险命令（`checkout -B` / `reset --hard` / `clean -fd` / `pnpm install`）**全部退到构建区**，在 per-run worktree 里变成对自身无害的操作 —— 这是 B 的附加收益：**它顺带消除了「在共享目录上做破坏性 git 操作」这个固有风险**，而不只是防并发。
- 部署区的操作（写指针、upsert 版本表、pm2 起停）耗时在毫秒~秒级，串行代价很低，却是唯一必须互斥的地方 → 由 D 的资源锁精确覆盖。

净效果：**长操作并行，短临界区串行**。

### 4.2 D：显式执行队列与 worker

#### 4.2.1 替换点

现状：`submit` 成功后 `this.trackRun(id, this.run(entity))`（`pipeline.service.ts:831-834`），`trackRun` 只把 promise 存进进程内 `Map`（`:618-625`）——无队列、无并发上限、进程重启即失。

改为：

```
submit / approve / retry
      ↓ (写库)
status = 'queued'，入队
      ↓
PipelineQueue worker loop（受 PIPELINE_WORKER_CONCURRENCY 限制）
      ↓ 取一条 queued 且能拿到其首个 action 所需资源锁的 run
      ↓ PipelineService.run(entity)  ← 内部逻辑不变
```

- worker loop 跑在 deploy-console 进程内，**不阻塞请求线程**；轮询间隔 2s（首批实现）。
- `run()` 的 DAG 语义（`orchestration-engine.ts`）保持不变，仅把注入面的 `runScript` / `waitApproval` 换成感知 workspace 的版本。

#### 4.2.2 状态机

在现有枚举（`deploy-pipeline.entity.ts:73`，`varchar(24)`）新增 `queued`：

```
pending ──► queued ──► running ──► succeeded / failed / cancelled
   │                       │
   └─► pending-approval    └─► awaiting-approval ──(approve)──► queued
```

两条约束：

- **`pending-approval` 不入队**（门禁级：提交即阻断，沿用 `P0-handoff.md:37` 语义）；`approve` 后置 `queued` 而非直接 `run`。
- **`awaiting-approval` 必须出队**：节点级挂起可能持续数小时，挂起期间不占 worker slot。恢复时重新入队（`specs/pipeline-node-model/tasks.md:113` 已确认「挂起应释放发布锁」这一原则，此处对象换成资源锁）。

#### 4.2.3 资源锁（取代 `deploy_release_locks`）

> **这与方案 ①-only 的区别**：它是**按资源声明的动作级锁**，只在真正共享的临界操作上互斥，粒度比 `moduleKey@env` 整条流水线低一到两个数量级。部署区天然是临界资源（两个 run 同时写指针就是互相覆盖），互斥不可消除，能改的只有粒度。

新增 `deploy_resource_locks`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `lock_key` | varchar(191) PK | `<kind>:<moduleKey>@<env>` |
| `pipeline_id` | varchar(64) | 持有者 |
| `acquired_at` / `expires_at` | bigint | lease 语义，TTL 兜底防进程被杀留死锁 |
| `worker_id` | varchar(64) | 便于归因与 reconcile |

原子抢占沿用已被合入的正确写法（`release-lock.service.ts:85-93` 的单条 `INSERT ... ON DUPLICATE KEY UPDATE` + `IF` 条件）。

**kind 与取值规则**（动作粒度，由迁移脚本 `p29` 打标；未打标的动作按所在 task 继承）：

| kind | lock_key | 覆盖的动作 | 说明 |
|---|---|---|---|
| `artifact` | `artifact:<moduleKey>@<env>` | 投递产物到 `artifacts/` | 防同名版本目录覆盖 |
| `pointer` | `pointer:<moduleKey>@<env>` | 写磁盘指针 / upsert 版本表 / gateway reload | 防互相覆盖版本指针 |
| `runtime` | `runtime:<moduleKey>@<env>` | pm2 起停 + 健康探活 | 防并发起停导致服务抖动 |
| `cleanup` | `cleanup:<moduleKey>@<env>` | 旧产物回收 | 防删到正在生效的版本 |

**构建类动作（拉码 / 安装依赖 / build / 自检）一律不持锁** —— 它们跑在各自的 worktree 里。这是吞吐的来源。

粒度收益示例：A 正在给 `admin@dev` 切指针（持 `pointer:` 锁数秒），B 的 `portal@dev` 可以照常构建；而现状是 B 直接被判 `failed`。

#### 4.2.4 `deploy_release_locks` 的处置

退役并 DROP，**不做兼容层、不做双写**（D6）。

- `specs/pipeline-node-model/design.md:261` 里「锁键从 `module×env` 扩展为 `module×host`」的 P1 计划由 `runtime:` kind 承接（`<...>@<env>` 换成 `env@host` 即可），实现时将该 spec 对应条目指向本文。
- 迁移：`scripts/migrations/p29-pipeline-concurrency.mjs`（幂等，惯例见 `specs/remote-backend-release/design.md:63,189`），含 `DRY_RUN`、动库前打印将变更行、`bash -n` 自检；**不提供 `ROLLBACK` 脚本**（Q5），改以 T0 数据快照为唯一止损。

### 4.3 B：按运行的隔离工作区

#### 4.3.1 机制选型

| 候选 | 做法 | 判定 |
|---|---|---|
| **W1 `git worktree add --detach`** | `<ws>/.runs/<pipelineId>/` 挂到目标 commit | ✅ **采用**。与主仓库共享 `.git` object store → **免二次 fetch、几乎零额外 git 磁盘**；detached HEAD 天然规避「同一分支被两个 worktree 检出」的限制 |
| W2 `git clone --shared` | 用 alternates 复用 objects | ⚠️ 效果同 W1，但每个 clone 仍是一份独立 `.git` 元数据管理，且 `remote` / hooks 需重建 |
| W3 `cp -al` 硬链复制 | 整目录硬链 | ❌ `node_modules` 里存在写入型文件路径，硬链有跨写风险 |

#### 4.3.2 目录布局

```
<RELEASE_WORKSPACE>/
├── .git/                      主仓库 object store（唯一 fetch 入口）
├── .runs/<pipelineId>/        ← per-run worktree（构建区，隔离）
│   ├── apps/<module>/dist/    构建产物
│   └── servers/<module>/dist/
├── artifacts/<module>/<env>/<version>/   产物区（已有，写需持 artifact 锁）
└── servers/gateway/public/static/modules/…  部署区（已有，写需持 pointer 锁）
```

#### 4.3.3 注入变量

路径派生不得再依赖无参 getter。新增一个贯穿整条 run 的 `WorkspaceContext`：

| 变量 | 值 | 取代 |
|---|---|---|
| `WS_BUILD_DIR` | `<ws>/.runs/<pipelineId>` | 脚本里 `cd "$RELEASE_DIR"` 的全部语义（如 `p21-pipeline-node-scripts.sql:27-31`） |
| `WS_ARTIFACT_DIR` | `<ws>/artifacts/...` | 现有 `ARTIFACT_DIR` / `ARTIFACTS_DIR` / `PUBLISH_PATH` 注入（`pipeline.service.ts:406-410`，见 H3） |
| `WS_DEPLOY_TARGET` | `deployTargetAbs(...)` | 现有 `DEPLOY_TARGET` |
| `RELEASE_DIR` | **保留 = `<ws>` 根**（部署区语义） | 语义明确为「部署区根」，不再承担构建 cwd |

代码侧：`resolveStageCwd`（`pipeline.service.ts:108-111`）改为接收 `WorkspaceContext`；扩散点 `:1757`、`:2271`、`:2336`、`:2499-2500`。

#### 4.3.4 依赖安装成本

per-run 装依赖是主线风险，三个缓解手段（缺一不可）：

1. **共享 pnpm store**：统一 `--store-dir`（默认 `~/.local/share/pnpm/store`）。store 是内容寻址 + 硬链 → 多个 worktree 的 `node_modules` **磁盘增量趋近零**。
2. **workspace 包预构建**（现状：`pull.executor.ts:84-99` 的 `pnpm --filter @web-system/{shared,types} build`）改为**一次构建产出归档 → 每 run 解包**，而不是每 run 重新 build。
3. **同 `<commit>` 的 worktree 复用**（可选优化，后续批次）：已完成 install 的 worktree 作为 warm pool 继承。

#### 4.3.5 生命周期与 GC

| 事件 | 处理 |
|---|---|
| run 终态 `succeeded` | 立即回收专属工作目录 |
| run 终态 `failed` / `cancelled` | 保留最近 N 条（默认 3，`PIPELINE_WORKSPACE_RETAIN`）用于现场排查，超出 GC |
| deploy-console 重启 | 启动时 reconcile：清理无对应运行中 run 的 `.runs/*`，并 `git worktree prune` |
| 队列中的 run (`queued`) | **不预先创建 worktree**，避免队列堆积占满磁盘；出队时才建 |

---

## 5 决策表

| # | 决策 | 选择 | 理由 | 被否决项 |
|---|---|---|---|---|
| D1 | 解决路径 | **隔离（B）+ 精确互斥（D）**，即业界 ②+① | 标准答案的本地化（§3.2）；既拿并行又保正确性 | 粗粒度工作区锁（压吞吐、管不住旁路脚本）；文件锁（跨机/手工失效） |
| D2 | 队列存储 | **DB（`deploy_pipeline_runs` 扩展列）** | 与现有锁表同栈；`pipeline-node-model` P1 要上 host/SSH 多节点，届时 worker 不止一个进程——**DB 队列是唯一能直接演进到多 worker 的形态** | 内存 `Map`（现状，重启即失）；BullMQ / Redis（引入新中间件，违反 N2） |
| D3 | worker 形态 | deploy-console 进程内 pool，`PIPELINE_WORKER_CONCURRENCY` 控制（默认 2） | 单机场景无需独立进程；抽象按「worker 可以在别的机器」设计（lease 持有者即可） | 独立 worker 进程（当前无多机需求） |
| D4 | 抢不到锁的行为 | **排队**（`queued`）而非判 `failed` | 现状抛 `ConflictException`（`pipeline.service.ts:701-708`）是「抢不到就拒绝」的语义，多流水线场景体验与正确性都不好 | 保持 failed；直接抢占（会造成覆盖） |
| D5 | 工作区机制 | **git worktree `--detach`** | 共享 object store，免二次 fetch；detached 规避同分支冲突 | `--shared` clone；硬链复制 |
| D6 | `deploy_release_locks` | **退役并 DROP**，语义并入 `deploy_resource_locks` 的 `runtime:` kind | 同一概念（原子的 lease），粒度从「整条流水线」下沉到「动作」；留着才是包袱 | 双锁并存；保留旧表；兼容 shim |
| **D7** | **回滚方式** | **不引入运行时开关（N1）**：回滚 = `git revert` + T0 数据快照恢复 | 运行时双路径（开关 / 兼容模式）本身就是本次要拆的包袱：它让每处改动多写一个分支、多维护一套实现、多测一遍（§6.4 H1/H2） | 保留 `PIPELINE_WORKSPACE_MODE` 双路径；兼容 shim（原 Q7 的 R-a / R-b，两者都是兜底） |
| D8 | 迁移载体 | `scripts/migrations/p29-pipeline-concurrency.mjs`（幂等） | 惯例 `specs/remote-backend-release/design.md:63`；dev / 堡垒机共用云库，动数据必须幂等 | `migrations/*.sql`（该目录由 apply-migrations 扫描，非本类变更载体） |
| D9 | 编排模型 | **不动** step/task/action 三层，也不动 `orchestration-engine` 的 DAG 语义 | N3/N4；只替换注入面与新增 kind 打标 | 借机重构编排模型 |

---

## 6 实施方式（一次性交付）

> **Q1 已决策（2026-09-24）：不分期。一次性实现、一次性验收。**
> 下文阶段 A / B 是**推进顺序**（自底向上，B 依赖 A 的 slot 与 lease 语义），**不是交付批次**。
> 唯一交付点：V1–V10、V12、V13 全部勾核（判据表见 `requirements.md` §6）。

### 阶段 A｜队列地基（D）

目标：把「fire-and-forget 直跑」换成「入队 + worker 领取」，为阶段 B 提供 slot 与 lease 语义。

- 新增 `queued` 状态 + `deploy_pipeline_runs` 扩展列（`queue_seq`、`worker_id`、`lease_until`）。
- `trackRun` → `PipelineQueue.enqueue`；进程内 worker pool + 启动 reconcile。
- `submit` 软校验从「存在 `running` 则 Conflict」改为「同一 resourceKey 已有 queued/running 则**复用或提示排队**」。
- 建立 `deploy_resource_locks` 与四类 kind，接入 `acquire/release`。
- `deploy_release_locks` 退役并 DROP（D6）。

### 阶段 B｜per-run 工作区（B）

- `WorkspaceContext` + `WS_BUILD_DIR` 注入，替换 `resolveStageCwd` 的全局依赖。
- worktree 生命周期管理（创建 / GC / reconcile），目录 `<ws>/.runs/<pipelineId>/`（Q2 已决策）。
- 把 `checkout -B` / `reset --hard` / `clean -fd` 从「操作主工作区」改为「在自己的 worktree 内操作」。
- 共享 pnpm store + workspace 包预构建改为「一次产出归档 → 每 run 解包」（同时消除 R5）。
- 迁移脚本 `p29` 给现有 action 打 resource kind 标记，并改造硬 `cd "$RELEASE_DIR"` 的脚本（R3）。
- 构建类动作去锁、`PIPELINE_WORKER_CONCURRENCY` 放开（默认 2）。

### 6.3 回滚方式（无运行时兼容模式）

D7 选定 N1 之后，回滚是两件标准动作：

| 层 | 手段 | 耗时 |
|---|---|---|
| 代码 | `git revert` + 重新发布 deploy-console | 本机分钟级；dev/prod 走一次正常发布 |
| 数据 | T0 快照恢复（`p29` 执行前导出，见 `tasks.md` T0 / V8） | 分钟级 |

由此产生两条硬约束：

1. **执行 `p29` 之前必须先完成 T0 数据快照**——这是「不要 `ROLLBACK` 脚本」（Q5）的对价，设为 G0 门禁，不可跳过。
2. **代码中不得残留读 `deploy_release_locks` 的路径**——否则 `git revert` 回到的旧版本会读一张已 DROP 的表。这条由 **V13（grep 断言）**机器校验。

### 6.4 历史包袱清理清单（H1–H7）

> 判据：**是否在同一改动路径上**。在同路径上 → 留着它就要为它写判断分支 + 多维护一套 + 多测一遍，留着的成本高于拆掉，必须顺手拆；不在本次路径上的另开 spec（§6.5）。
> 这七项是各任务的**同行义务**（写在 `tasks.md` 对应任务里），不是追加任务。

| # | 包袱 | 位置 | 处置 | 随何任务拆 |
|---|---|---|---|---|
| **H1** | `off` 模式双路径（运行时开关） | 本设计曾提议的 `PIPELINE_WORKSPACE_MODE` | **不引入**（D7 / N1） | —（设计层已消除） |
| **H2** | `deploy_release_locks` 兼容 shim（旧 key → 新 key 映射） | 同上的配套设施 | **不需要了**，直接 DROP | T2 |
| **H3** | artifacts 双轨（「只做补充注入，不覆盖 `PUBLISH_PATH` 等旧变量：旧模板行为完全不变」） | `pipeline.service.ts:406-410` | 统一走 `WS_ARTIFACT_DIR`，删 `PUBLISH_PATH` 等旧变量注入 | T5 |
| **H4** | `.deploy-lock-hash` 指纹文件（为协调 shared 包并发构建打的补丁） | `release-git.service.ts:10,161-166` | 删除；per-run worktree + 归档解包已让它无用 | T7 |
| **H5** | `WS_SAFE_DELETE` / `SAFE_DELETE_STRATEGY`（`mv` 到 `/tmp` vs `rm`） | `pipeline.service.ts:2279` | 删除策略开关；per-run 直接删**自己**的目录，不存在「会不会删到别人」 | T8 |
| **H6** | `parseReleaseRef` 的 legacy 分支（纯 commit vs `<pipelineKey>/<commit>`） | `release-paths.ts:109-116` | 统一 `<pipelineKey>/<commit>` 一种写法 | T5 |
| **H7** | 后台 fire-and-forget `execAsync git fetch`（与流水线自身 git 操作天然重叠） | `pipeline.service.ts:1437-1439` | 删除；拉码由 worktree 管理后不需要抢跑 | T3 |

> H5 的额外收益：那条 `mv` 到 `/tmp` 的策略当初是为绕开批量删除审批，per-run 目录是自有的，该问题自动消失。

### 6.5 后续（本期不做，另开 spec）

- **legacy 九阶段执行链路**（`steps/*.executor.ts` + `commandMode` 四态 + `orchestration == null` 回退旧时间线）——全仓最大的包袱，但不在本次路径上，动它需先迁移 dev/prod 全部流水线模板到三层模型。
- **`deploy_deployments` 退役**（与 `deploy_app_env_versions` 双源真相归一，现挂 P4）。
- 旁路脚本纳入同一 Resource 模型（V11）。
- warm pool（同 commit worktree 复用）。
- 与 `pipeline-node-model` P1 的 host/SSH 对接：`runtime:` kind 的 key 扩为 `env@host`，届时 worker 可跨机。
- CI 侧（`specs/ci-cd`）放宽 `concurrency` group。

---

## 7 验收判据

> 判据表（**V1…V13**）的唯一真相源在 [`requirements.md` §6](./requirements.md)，本文不复制——避免双份事实漂移。
> 设计侧与交付侧共用同一套编号：`tasks.md` 每项绑定 V#，`rd-execute` 收尾的完成验证门按同一编号逐条给证据。

本文只给出「设计要点 → 判据」的映射：

| 设计要点 | 章节 | 对应判据 |
|---|---|---|
| 三类目录切分（构建区 / 产物区 / 部署区） | §4.1 | V3, V4 |
| 队列 + worker lease + `queued` 状态 | §4.2.1, §4.2.2 | V1, V2, V5 |
| 精确资源锁（artifact / pointer / runtime / cleanup） | §4.2.3 | V10, V12 |
| git worktree 生命周期与 GC | §4.3.2, §4.3.5 | V6, V9 |
| 依赖安装走共享 store + 包归档解包 | §4.3.4 | V6 |
| 幂等迁移 `p29` + T0 快照 | §4.2.4, §6.3 | V8 |
| 无运行时兼容模式下的可恢复性 | §6.3 | **V7′** |
| 历史包袱清零（H1–H7） | §6.4 | **V13** |

---

## 8 风险与缓解

| # | 风险 | 缓解 |
|---|---|---|
| R1 | **`.runs/` 磁盘膨胀**（多个 run 的 worktree 同时存在） | V6 硬链验证 + V9 GC + 队列中不预创建 workspace |
| R2 | worker slot 泄漏（进程被杀，lease 未释放） | lease TTL + 启动时 reconcile 重置孤儿 run 为 `queued` |
| R3 | 部分 action 脚本硬 `cd "$RELEASE_DIR"` 后按相对路径做事（已知 `p21-pipeline-node-scripts.sql:27-31`） | `p29` 扫描全部 `deploy_pipeline_actions.script`，注入 `WS_BUILD_DIR` 覆盖 |
| R4 | pnpm store 并发写 | pnpm 自带 store 锁，天然安全；只需保证 store-dir 统一并被 `RELEASE_PNPM_BIN` 使用 |
| R5 | workspace 包（`@web-system/{shared,types}`）交叉构建竞态（现状缺陷，见 §1.1） | 改为「一次构建产出归档 → 每 run 解包」，彻底消除并发构建同一包 |
| R6 | 审批挂起期间变量变化，导致恢复后环境漂移 | 沿用现状：运行参数已随实例快照固化（`pipeline.service.ts:831` 注释「投递目标已随实例快照 runTarget 固化」），本设计不改动该前提 |
| R7 | 「部署区」串行成为新瓶颈 | 部署区操作均为毫秒~秒级；V10 要求确认瓶颈不在此，若将来成为瓶颈再把这些动作幂等化 |
| **R8** | **无运行时开关，回滚要走一次发布而非改环境变量**（N1 的代价） | T0 快照 + V7′ 验证可恢复能力；本地先验证再上 dev/prod，风险控制靠发布顺序而非运行时分支 |
| **R9** | 拆 H3 / H5 / H6 时若有脚本仍依赖旧变量，可能静默失效 | V13 的 grep 断言 + `p29` 扫描脚本正文做前置检查，发现依赖即报错，不静默降级 |

---

## 9 常见问题

**Q：既然要 B（隔离），为什么还要保留 D 的锁？不就是留着方案 ① 吗？**
不是。D 的锁是**按资源声明的动作级锁**（§4.2.3），只在「写指针 / 重启 / 清理」这几类真正共享的临界操作上互斥。方案 ①-only 是「用一个更粗的锁把并行挡掉」，两者方向相反。部署区天然串行，这个事实不因为加了隔离而消失。

**Q：不留运行时开关，出问题怎么办？**
回滚退化为两个标准动作：`git revert` + T0 快照恢复（§6.3）。代价是回滚要走一次发布而非改环境变量。这是 N1 的明确取舍——保留双路径意味着每处改动都要写两套实现，那正是本次要消除的东西。**注意区分熔断与兼容**：出问题时可以临时停 queue worker 止血（一处 `if`、零分支维护），但它不是"切回旧实现"的兼容模式。

**Q：能不能一步到位上容器（范式 ③）？**
抽象上留了口子（`specs/pipeline-node-model/tasks.md:131` 的 `ShellRunner` 是可注入通道；worker 位置由 lease 决定）。但当下要连带解决 pm2、远程 scp（`p26`）、本地 `.env` 加载这一堆宿主机语义，容器化前置成本远大于收益，列为长期方向。

**Q：为什么队列存 DB 而不是内存？**
内存队列在本机多窗口同时操作 / console 重启两个场景下都会丢。更关键的是 `pipeline-node-model` P1 明确要上节点级 host + SSH 多节点执行，届时 worker 不止一个进程——**DB 队列是唯一能直接演进到多 worker 的形态**。

**Q：H1–H7 看着像顺手捎带，会不会拖累主线？**
判据是「是否在同一改动路径上」。这几项**本来就要被改到**，留着它们等于要为兼容分支多写判断、多维护一套、多测一遍——留着的成本高于拆掉。真正该警惕的是把不在路径上的东西（legacy executor、双源真相）塞进本期，那才会把「一件事」变成「所有事」，已在 §6.5 剥离。

**Q：旁路脚本（`publish-*.sh`）怎么办？**
DB 锁管不到它们，这是依赖 DB 互斥方案的固有边界。正确处置是让它们走同一套 Resource 模型（V11，后续批次），而不是给每个脚本加文件锁。在 V11 完成前，这些脚本应视为「单人维护模式下的临时通道」，多流水线并行时禁用。

---

## 10 决策记录与待确认

| # | 问题 | 状态与建议 |
|---|---|---|
| Q1 | 分期交付还是一次性到位？ | **✅ 已决策（2026-09-24）：不分期**，一次性实现、一次性验收（§6） |
| Q2 | `.runs/` 放 `<ws>` 内还是 `/tmp`、`~/.pipeline-runs/`？ | **✅ 已决策（2026-09-24）：`<ws>/.runs/<pipelineId>`**。理由：与发布区同文件系统才能走 pnpm 硬链（V6 前提）；`.` 前缀使 gateway / nginx 静态服务天然忽略 |
| Q5 | `deploy_release_locks` 退役方式 | **✅ 已决策（2026-09-24）：一次性替换并 DROP，不提供 `ROLLBACK` 脚本。** 对价是执行 `p29` 前必须先完成 T0 数据快照（V8 / G0） |
| **N1** | 是否保留运行时开关（回滚方式） | **✅ 已决策（2026-09-24）：N1——不引入。** 回滚 = `git revert` + T0 快照恢复（§6.3 / D7 / R8） |
| **H1–H7** | 是否顺手拆改动路径上的历史包袱 | **✅ 已决策（2026-09-24）：认可，作为各任务同行义务**（§6.4） |
| Q3 | `PIPELINE_WORKER_CONCURRENCY` 默认值 | ⬜ 待确认：建议 **2**（本机联调典型并发 ≤2），V6 实测磁盘后再调 |
| Q4 | 是否把 `scripts/publish-*.sh` 纳入本期（当前唯一绕过平台的写路径） | ⬜ 待确认：建议 **不**（列为后续 V11），避免与流水线重构耦合 |
| Q6 | 是否同步放宽 CI 侧（`specs/ci-cd`）的 `concurrency` group | ⬜ 待确认：建议 **本期交付跑通后再放** |
| Q8 | `p29` 是否仍保留 `DRY_RUN`（Q5 已删掉 `ROLLBACK`） | ⬜ 待确认：建议 **保留**——零写库的试运行能力与"回滚脚本"是两回事，去掉等于失去唯一的执行前检查手段 |
| Q9 | 是否接受 V6 的判定阈值（磁盘增量 ≤ 裸源码 ×1.2、`node_modules` 硬链占比 ≥ 90%） | ⬜ 待确认：建议接受。若机器 IO 特殊，应改实现方式而非放宽阈值 |
| Q10 | T4b（前端「排队中 · 前面 N 条」）本期是否做 | ⬜ 待确认：建议 **不做**——会触发 UI 动作门（原型 → 交互质检 → D2 → 用户确认 → 原型单独 commit → 才落码，`Proto: <sha>` 强制），且 V1/V2 的成立不依赖它 |

---

## 11 待确认项详解（供决策）

> `§10` 是状态表，本节给出每项的**背景、选项、影响**，便于一次性确认。六项均不阻塞 T0/T1 开工。

### Q3｜worker 并发数 `PIPELINE_WORKER_CONCURRENCY`

**是什么**：worker pool 同一时刻领取并执行几条流水线。注意它**不等于**部署区并行度——部署区由资源锁强制串行，与这个值无关。

**为什么现在要定**：它直接决定同时存在几个 per-run worktree，是 V6（磁盘）与 V10（收益）的输入。

**选项与影响**

| 值 | 影响 |
|---|---|
| 1 | 排队但不并行，V10 必然不通过（拿不到并行收益） |
| **2（建议）** | 本机联调典型并发 ≤2；最多 2 个 worktree 同时在盘 |
| 4 | 磁盘与 IO 压力 ×2；本机单机场景收益递减，且更容易触发 V6 阈值误判 |

**建议**：默认 **2**，V6 实测磁盘后再调。`Q5/Q1` 已定的前提下，此项可在实现后按实测调整，不必现在锁死。

---

### Q4｜旁路脚本 `scripts/publish-*.sh` 是否纳入本期

**是什么**：`scripts/publish-deploy-console.sh:151`、`scripts/publish-ai-agent.sh:86` 直接对发布目录做 `git merge --ff-only` / `git reset --hard`，是**当前唯一绕过平台的写入路径**。它们是本次塑造成要走的最后一段"没被新机制保护的通道"。

**选项与影响**

| | 影响 |
|---|---|
| **不纳入（建议）** | 它们仍是"单人维护模式下的临时通道"：多人/多流水线并行时禁用。本期改动面可控 |
| 纳入 | 要把发布脚本与流水线重构绑在一起做，改动面与风险同步上升；一旦出问题难以归因 |

**建议**：不纳入，列后续批次 V11。执行期间在 runbook 里记一句「并发发布时禁止手工跑 publish-*.sh」。

---

### Q6｜CI 侧 `concurrency` group 是否同期放宽

**是什么**：`specs/ci-cd/gh-actions-release.md:84-86` 目前用 `concurrency: group: release-${{ github.ref }}` + `cancel-in-progress: false` 让 CI 串行排队——**这是因为平台侧没能力而做的外部规避**。

**选项与影响**

| | 影响 |
|---|---|
| 本期同步放宽 | 风险提前暴露：平台刚改造完就在 CI 的批量场景下受压，出问题会牵连 dev/prod 流程 |
| **跑通后再放宽（建议）** | CI 期间仍慢（但安全）；本期交付并跑一段时间后再放，届时平台侧已能承载 |

**建议**：本期交付并跑通后再放宽。

---

### Q8｜`p29` 是否保留 `DRY_RUN`

**是什么**：迁移脚本的**预演模式**：`DRY_RUN=1` 时脚本完整走一遍逻辑、打印「将变更哪些行 / 将执行哪些 DDL」，但**不写库、不改脚本正文**，退出码照常返回。

**它和 `ROLLBACK` 的区别**（这是容易被混淆的地方）

| | 时机 | 做什么 | 是否属于"包袱" |
|---|---|---|---|
| `DRY_RUN` | **事前**（还没执行） | 只读预演，先看会动什么 | 否——它是执行卫生，不是兼容层，零维护成本 |
| `ROLLBACK` | **事后**（已经执行） | 撤销已发生的变更 | 是——需要长期保留反向逻辑与旧数据结构认知，Q5 已取消 |

**为什么不顺便也删了**：改 Todo，p29 会用滚筒三段动作（建 `deploy_resource_locks`、给 `deploy_pipeline_runs` 加列、给 `deploy_pipeline_actions` 打 resource kind 并改造脚本正文）。**且 dev / 堡垒机共用同一个云库**——没有预演就等于盲改一张两边都读的表。删掉它，V8 的执行前检查手段归零，只剩下"跑完再看是否翻车"。

**建议**：**保留**。这是 Q5 取消 `ROLLBACK` 之后唯一的事前防线。

---

### Q9｜是否接受 V6 的判定阈值

**是什么**：V6 用来判定「磁盘没有随并发数线性膨胀（即真的走了硬链）」的量化标准：

- 跑 4 个 per-run workspace 后，`<WS>/.runs` 磁盘增量 **≤ 裸源码尺寸 × 1.2**
- `node_modules` 中 link count > 1 的文件占比 **≥ 90%**

**为什么有这两条**：第一条卡住总量（工作区 checkout 本身会占空间，允许 20% 余量给元信息）；第二条卡住机制——**必须证明是硬链，而不是控盘**。只看总量的话，机器 IO 特殊时可能"碰巧通过"而实现方式其实是错的。

**建议**：接受。若本机实测不达标，应当**改实现方式**（优先修统一 `--store-dir`），而不是放宽阈值——放宽等于取消这条验证。

---

### Q10｜T4b（前端「排队中 · 前面 N 条」）本期是否做

**是什么**：在 `apps/deploy-console` 的运行列表/详情里显式展示排队状态与排队位置。

**为什么它被单独拎出来**：它触及 UI 源码，按 `.codebuddy/CODEBUDDY.md` §2.5 必须走完整动作门——

```
改原型 + 页面规格 → 独立交互质检 → D2 设计评审（阻塞项清零）→ 用户确认原型
  → 原型/规格单独 commit（记 sha）→ 才落码 → commit 必须带 Proto: <sha> 与 Design: pass
```

**关键事实**：**V1/V2 的成立不依赖它**。T4a 之后接口就能查到 `status=queued` 与 `queue_seq`，判据可以用 curl 勾核。T4b 只影响肉眼可读性。

**建议**：**不做**。建议本期完成后另起一个小任务走正常的 UI 动作门，避免把后端正确性验证和前端流程绑在一起。
