# 设计稿 · 流水线节点模型重构（shell + 审批 两类节点 + 变量管理）

> 状态：**待实现**（2026-09-14；D1–D8 决策已确认，见 §0.3）。
> 关联代码：`servers/deploy-console/src/pipeline-template/template-node.ts`、`src/pipeline/steps/node-exec-plan.ts`、`src/pipeline/pipeline.service.ts`、`src/config/*`、`apps/deploy-console/src/views/PipelineEdit.vue`

---

## 0. 方案总览（一页）

### 0.1 目标

把「多环境发布」做成**可复现、可远程、可审计**的体系：同一套流水线模板既能发本机、也能发 dev/prod；节点模型足够简单（只有 shell + 审批）；凭据集中加密管理；配置与实现都版本化。

### 0.2 全景

```
┌─ 环境初始化 ─────────────────────────────────────────────────────┐
│ scripts/bootstrap.sh --env local|dev|prod                        │  ✅ 已落地（PR #60）
│   建库 → 迁移 → 构建 → 干净启动 → seed → 验证                     │
├─ 流水线模型（本次重构）──────────────────────────────────────────┤
│ 节点只有两类：shell（执行） / approval（暂停等人批）               │
│ 平台能力（版本记录/指针切换）→ shell 节点内的 service action        │
│ 变量：内置 + 全局 + 自定义（复用配置中心，多级合并）                │
├─ 远程执行（本次新增）────────────────────────────────────────────┤
│ shell 节点加 host → 平台按 host 选通道（本机 runShell / ssh）      │
│ 两种编排：远程自拉自建自重启用 ｜ 本地构建 + 远程部署               │
├─ 凭据管理（本次新增）────────────────────────────────────────────┤
│ SSH 私钥 DB 加密（AES-256-GCM）+ 仅密钥认证 + 指纹展示/轮换/审计    │
│ 按环境拆密钥、无 passphrase、authorized_keys 来源 IP 限制          │
├─ 发布后验证 ─────────────────────────────────────────────────────┤
│ scripts/pipeline/verify-backend.sh：pm2 online + 端口 + AI 链路    │  ✅ 已落地
└──────────────────────────────────────────────────────────────────┘
```

### 0.3 关键决策（已确认）

| # | 决策 | 结论 |
|---|---|---|
| D1 | 节点类型 | 只保留 `shell` / `approval`；`platform` 三节点（git/version/pointer）降级为「普通 shell 节点」+「`service` action」 |
| D2 | 变量管理 | **复用配置中心**（`config_items` 加 `scope=template`），不新建第二套 KV；优先级：内置 < 全局 < env < module < 模板 < 节点内联 |
| D3 | 远程执行 | 节点级 `host`（引用 `deploy_servers.server_name`），平台统一 SSH 通道（节点脚本走 stdin） |
| D4 | 凭据存储 | DB 加密存储私钥；主密钥 `CONFIG_MASTER_KEY` 放环境变量、**不进 DB**；**只用密钥，废弃密码** |
| D5 | 密钥粒度 | **按环境拆密钥**（dev/prod 各一把，不再三台机共用一把） |
| D6 | passphrase | **不支持**（无口令专用部署密钥 + `authorized_keys` 的 `from=` 来源 IP 限制） |
| D7 | 轮换 | 与凭据管理**一起做**（UI：新旧并存 → 验证 → 摘旧钥） |
| D8 | 审批 | 由「发布前置门禁」升级为**节点**（可插任意位置），需节点级挂起/恢复 |

### 0.4 阶段路线

| 阶段 | 内容 | 状态 |
|---|---|---|
| **P0** | 本机两类节点执行闭环（shell / approval） | ✅ **已完成**（2026-09-14，见 `tasks.md` §6） |
| **P1.0** | SSH 凭据管理（DB 加密 + 指纹 + 轮换 UI + 审计） | 待开工 |
| **P1** | 远程执行（节点 `host` + SSH 通道 + 按主机变量 + 并发锁） | 待开工 |
| **P2** | 变量管理（配置中心 `scope=template` + 管理页） | 待开工 |
| **P3** | 前端画布（两类节点全可配，含 host 选择） | 待开工 |
| **P4** | 存量模板迁移 + legacy / `check-base` 特判 / `locked` 托管退役 | 待开工 |

### 0.5 关联文档

| 文档 | 内容 |
|---|---|
| `docs/development/from-zero-init-data.md` | 首次运行要初始化哪些数据（库/表/seed/静态资源） |
| `docs/development/prod-release-plan.md` | prod 发布四条路径与首次部署前置清单 |
| `docs/development/local-release-runbook.md` | 本机发布目录机制与发布流程 |
| `specs/from-zero-bootstrap/` | `bootstrap.sh` 的需求与设计（**已实现**，PR #60） |

---

## 1. 目标模型（用户定义）

1. **所有节点都可配置** —— 没有"平台硬编码、页面置灰不可编辑"的节点；
2. **节点类型只有两类**：`shell`（执行）与 `approval`（审批）；
3. deploy-console **先实现这两类基本节点的执行**；
4. **需要一处管理流水线变量**：既有内置/全局变量，也能加自定义变量；
5. 用这个模型重新表述「本地发前端」「本地发后台」两条流水线。

---

## 2. 现状对照

| 维度 | 现状 | 目标 | 差距 |
|---|---|---|---|
| 节点类型 | `kind: platform`（git/version/pointer，页面置灰、`locked`）＋ `kind: script`（可配）；`check` 还被特判为 `check-base` | 只有 `shell` / `approval` | 需去掉 platform 三节点硬约束与 `check-base` 特判 |
| 执行分派 | `planNodeExec` → `check-base`/`git`/`builtin`/`script` 四种 how | shell 一律"执行命令"；approval 一律"暂停等人" | 分派逻辑简化为两类 |
| 另有 legacy 九阶段 | `steps` + `PIPELINE_STAGES` + `PIPELINE_V5_NODES` 两级回退 | 单一模型 | 需下线 legacy 路径 |
| 审批 | **前置门禁**（`deploy_approvals` + `pending-approval`），不是节点 | **节点**（可插在任意位置） | 模型扩展 + 运行循环支持暂停/恢复 |
| 变量 | 19 个内置变量（`resolveStageVars`）＋ 配置中心 `config_items`（global/env/module 三级 KV，UI 在 `ConfigCenter.vue`） | 内置 + **全局变量** + **自定义变量**，集中管理 | 无模板/流水线级变量模型 |
| 节点命令存储 | `deploy_pipeline_step_commands(templateId,nodeKey)`，`actions[]` 多操作，`locked` 平台托管 | 节点内直接存 `actions`（不再需要 locked 概念） | 托管机制可退役 |

> 结论：**目标是"一个更简单的模型"**——把"平台语义"从「节点类型」降级为「节点内的 action 类型」，节点本身只剩 `shell` / `approval`。

---

## 3. 节点模型定义

```ts
type TemplateNode =
  | ShellNode
  | ApprovalNode;

interface ShellNode {
  kind: 'shell';
  key: string;                 // 唯一 key（= 日志/进度里的阶段名）
  label: string;               // 展示名
  actions: StepAction[];       // 顺序执行；任一非 0 退出即失败（除非 action.continueOnError）
  optional?: boolean;          // 未配置 actions 时跳过（默认 false = 必配，fail-fast）
  timeoutSec?: number;         // 节点默认超时（action 可覆盖）
  watchdog?: boolean;          // 失败触发自动回滚（全局仅 1 个）
}

interface ApprovalNode {
  kind: 'approval';
  key: string;
  label: string;
  approvers?: string[];        // 空 = 任意有权限者
  timeoutSec?: number;         // 超时未批 → 按 onTimeout 处理
  onTimeout?: 'abort' | 'auto-approve';
  onReject?: 'abort' | 'rollback';   // 默认 abort
}

/** action 层保留两类（这样平台能力不必成为"节点类型"） */
interface StepAction {
  id: string;
  type: 'shell' | 'service';   // shell=跑命令；service=调平台内置能力
  name: string;
  code?: string;               // type=shell
  tool?: string;               // type=service：'write-version' | 'switch-pointer' | 'notify' | ...
  params?: Record<string, unknown>;
  timeoutSec?: number;
  continueOnError?: boolean;
  enabled?: boolean;
}
```

**关键设计**：平台能力（版本记录、指针切换）**不再是节点类型**，而是 shell 节点里的一个 `service` action。
→ 满足"节点只有两类"的要求，同时不丢平台语义（`version`/`pointer` 的能力迁到 `service` action）。

**git 拉码**：也变成普通 shell 节点（命令就是现在 `git-step.sh` 的内容），不再是不可编辑的 platform 节点。

---

## 4. 变量模型

三层来源，后者覆盖前者：

| 层 | 来源 | 管理入口 | 示例 |
|---|---|---|---|
| ① 内置变量 | 平台按发布上下文自动注入（现有 19 个不改） | 无（只读，页面可查） | `RELEASE_DIR` `MODULE_KEY` `MODULE_DIR` `PORT` `BRANCH` `COMMIT_ID` `STAGE` `PM2_NAME` `PUBLIC_PATH` `ARTIFACT_DIR` … |
| ② 全局/自定义变量 | **新增**：可全局、也可按模板/环境/模块维度定义 | 新增「流水线变量」管理页 | `REGISTRY`、`DINGTALK_WEBHOOK`、`TARGET_HOST` |
| ③ 节点内联变量 | 节点 `actions[].env` 或命令内直接写 | 节点编辑器 | 局部覆盖 |

**存储建议**：不新建表，**复用配置中心**（`config_items` 增加 `scope='template'` + `templateId` 维度），理由：
- 已有 AES-256-GCM 密钥加密、快照与回滚、`ConfigCenter.vue` UI；
- 注入链路 `resolveInjectEnv` 已把 KV 打进节点命令的进程环境，天然可复用；
- 避免出现"两套 KV 谁覆盖谁"的第二次漂移。

**注入**：`runShell` 时 `{...builtinVars, ...globalVars, ...templateVars, ...nodeVars, WS_RESULT_FILE}`。

---

## 5. 两条流水线怎么配（回答提问）

### 5.1 本地发布**前端**（微前端模块，如 `admin` / `portal`）

| # | 节点 kind | key | label | 内容要点 |
|---|---|---|---|---|
| 1 | shell | `git` | 拉取代码 | `git fetch --all --prune --tags && git checkout -B $BRANCH origin/$BRANCH && git reset --hard $COMMIT_ID && git clean -fd` |
| 2 | shell | `build` | 构建 | `cd $RELEASE_DIR/apps/$MODULE_DIR && RELEASE_TAG=$COMMIT_ID MF_FORMAT=system npx vite build --mode mf` |
| 3 | **approval** | `approve` | 发布确认 | 仅 prod 需要（`onReject: abort`）；本地可省略 |
| 4 | shell | `upload` | 投递产物 | 本机：`mkdir -p $ARTIFACT_DIR && mv 旧产物到 /tmp && cp -R dist/. $ARTIFACT_DIR/`；远端：`tar + scp + ssh 解压` |
| 5 | shell | `pointer` | 切换版本指针 | `service` action：`tool: switch-pointer`（写 `deploy_deployments.current_version`）+ 刷新 gateway manifest |
| 6 | shell | `verify` | 验证（watchdog） | `curl -sf localhost:6000/__manifest__ \| grep -q $COMMIT_ID`；再 `curl -sI /static/modules/$MODULE_KEY/$COMMIT_ID/index.js \| grep -q 200` |

要点：
- 前端**不需要 restart**（gateway 直出静态资源，指针切换即生效）；
- `upload` 与 `pointer` 分开，便于"只投产物不切流"（灰度/预发布场景）；
- `verify` 失败 → watchdog 触发回滚（把指针切回上一版）。

### 5.2 本地发布**后台**（后端微服务，如 `ai-agent`）

| # | 节点 kind | key | label | 内容要点 |
|---|---|---|---|---|
| 1 | shell | `git` | 拉取代码 | 同前端 |
| 2 | shell | `build` | 构建 | `cd $RELEASE_DIR/servers/$MODULE_DIR && ( [ -f nest-cli.json ] && npx nest build \|\| npx tsc -p tsconfig.json )` |
| 3 | shell | `check-deps` | 依赖校验 | **可选**：关键配置/跨服务密钥一致性校验（现已内含在 restart 脚本里，可独立成节点以便单独看日志） |
| 4 | **approval** | `approve` | 发布确认 | prod 必配 |
| 5 | shell | `restart` | 重启 | `RELEASE_DIR=$RELEASE_DIR MODULE_KEY=$MODULE_KEY MODULE_DIR=$MODULE_DIR MODULE_TYPE=$MODULE_TYPE PORT=$PORT bash $RELEASE_DIR/scripts/pipeline/restart-backend.sh`（干净环境重建 + 依赖校验） |
| 6 | shell | `verify` | 探活（watchdog） | `… bash $RELEASE_DIR/scripts/pipeline/verify-backend.sh`（pm2 online + 端口 + AI 链路） |

要点：
- 后台**不需要 upload/pointer**（跑的是发布目录里的 dist，不经静态产物）；
- `restart` 与 `verify` 的**实现留在仓库脚本**里（`scripts/pipeline/*.sh`），节点只负责"调用谁"——同一份实现本地/远端/CI 都能用；
- watchdog 回滚 = 用上一个 commit 重跑 `restart` 节点（可复用同一模板，传 `COMMIT_ID=<上一版>`）。

### 5.3 两条流水线的差异一览

| | 前端 | 后台 |
|---|---|---|
| 特有节点 | `upload`、`pointer` | `restart` |
| 不需要 | `restart` | `upload`、`pointer` |
| 共同节点 | `git` / `build` / (`approval`) / `verify` | 同左 |

> 结论：两条流水线**共用同一套节点类型**，差异只体现为"节点清单不同"，无需为前后端各写一套引擎分支 —— 这正是"两类基础节点"带来的收益。

---

## 6. 远程机器发布能力（2026-09-14 新增需求）

**问题**：当前流水线的阶段命令**一律在 deploy-console 所在机执行**（`runStageCommand` 的 cwd 恒为 `releaseWorkspace`，代码里没有 remote 分支）；`target=remote` 只作用于前端 `upload`（把 dist scp 到远端静态目录），且版本指针仍写 console 所在库。
⇒ **后端服务无法通过流水线发布到远程机**，dev / prod 目前只能人工 ssh 上去跑脚本（这正是 `docs/development/prod-release-plan.md` 里的「路径 B」）。

**方案：给 shell 节点加 `host`（执行位置），节点类型不变**

```ts
interface ShellNode {
  kind: 'shell';
  key: string;
  label: string;
  host?: string;      // 不填 = 本机（console 所在机）；填 = deploy_servers.server_name（如 dev-default / prod-default）
  actions: StepAction[];
  optional?: boolean;
  timeoutSec?: number;
  watchdog?: boolean;
}
```

平台按 `host` 选择执行通道：

| host | 通道 | `RELEASE_DIR` 取值 |
|---|---|---|
| 空 | 本机 `runShell`（现有实现） | `RELEASE_WORKSPACE`（如 `~/web_system_release`） |
| `dev-default` | `ssh <user>@<host>`；**节点脚本走 stdin**（`bash -s`）；stdout / exit code 原样回传为节点日志与结果 | `deploy_servers.remote_dir`（如 `/data/web_system`） |

### 6.1 两种典型编排

**① 远程自拉自建自重启用**（推荐；与 dev/prod 现状一致 —— 目标机是完整 clone）

```
git(host=dev-default) → build(dev-default) → restart(host=dev-default) → verify(host=dev-default)
```

等价于"ssh 上去跑一遍启动脚本"：变量、路径、`.env` 全在目标机解析。我们已落地的 `scripts/pipeline/restart-backend.sh` / `verify-backend.sh` 正是按"在目标机本地执行"设计的 → **零改动可复用**。

**② 本地构建 + 远程部署**（混合；目标机没有源码 / Node 环境时）

```
git(local) → build(local) → upload(host=dev-default, 传 dist) → restart(host=dev-default) → verify(host=dev-default)
```

### 6.2 关键技术点

- **凭据**：复用 `deploy_servers`（`host` / `ssh_user` / `ssh_key_path`），私钥只存在 console，不下发到目标机；
- **脚本传输**：用 stdin（`ssh target "cd $DIR && VAR=... bash -s" < node-script.sh`），避免多层引号转义（这是远程执行最容易翻车的地方）；
- **变量按主机解析**：同名变量（`RELEASE_DIR` / `WS_SAFE_DELETE` 等）在 local 与远程取不同值，由 `host` 决定；
- **临时文件**：远程落 `/tmp/ws-<pipelineId>-<nodeKey>.sh`，执行后清理；
- **超时双保险**：SSH 侧 `ConnectTimeout` + 远程 `timeout`；
- **回滚（watchdog）**：在**同一 host** 上重跑上一版（如 `restart` 传入上一版 `COMMIT_ID`）；
- **并发保护**：同一 `host` 上的发布需串行（复用现有 `releaseLock`，键从 `module×env` 扩展为 `module×host`），否则两台流水线会互相覆盖产物 / 打架重启；
- **复用**：`RemoteDeliveryService` 的 ssh / scp 逻辑可提为**公共远程通道**，供 `upload`（前端产物）与 shell 远程执行共用。

### 6.3 待确认

1. console → prod 的 **SSH 可达性**：是否需跳板？（`.env.deploy` 显示 prod **数据库**经跳板 `172.16.16.10`；prod 主机本身 106.52.176.246 待实测）
2. 远程执行失败的**典型错误呈现**：ssh 层错误（连不上/认证失败）与远程脚本错误（exit≠0）要区分展示，便于定位。

### 6.4 SSH 凭据管理（DB 加密，仅密钥认证）

**现状**：`deploy_servers.ssh_key_path` 是**文件路径引用**（如 `~/.ssh/id_ed25519_servers`），`deploy-console/.env` 另配 `DEV_KEY/PROD_KEY/GATEWAY_KEY`；旧脚本 `scripts/deploy-prod.sh` 还带 `SERVER_PASSWORD + sshpass` 密码分支。

**目标**：凭据集中到数据库**加密**管理，认证只用**密钥**（不用密码），供远程执行（P1）统一取用。

| 项 | 设计 |
|---|---|
| 存储 | 新增 `deploy_servers.ssh_private_key_cipher`（AES-256-GCM）；`ssh_key_path` 保留为兼容模式（本地开发/CI）；**内容优先**，二者取一 |
| 加密 | 复用配置中心同一套（`config_items.isSecret` 的 `iv:authTag:ciphertext`）。主密钥 `CONFIG_MASTER_KEY` 放**环境变量、不进 DB** ⇒ DB 泄露 ≠ 私钥泄露 |
| 使用 | 解密 → `mktemp` 临时文件（`0600`）→ `ssh -i <tmp>` → `finally` 删除；或 `ssh -i /dev/fd/<n>` 不落盘 |
| 只读回显 | UI **永不回显私钥**；只展示 `算法 + 指纹 + 注释`（`ssh-keygen -lf`）；"编辑"= 整体覆盖 |
| 密码 | **不使用**。遗留 `SERVER_PASSWORD/sshpass` 分支废弃（`deploy-prod.sh` 已标 DEPRECATED）。若个别目标机只支持密码，走同一加密机制 + 显式 `auth_type=password` 且默认关闭 |
| 轮换 | 支持新旧并存：目标机先加新公钥 → 验证通过 → 再摘旧钥；UI 显示指纹与最近使用时间 |
| 最小权限 | 部署用专用密钥（无 passphrase）；目标机 `authorized_keys` 加 `from="<console-ip>"` 限制；进阶可选 **SSH CA 短期证书** |
| 审计 | 每次远程执行记录 `server × keyFingerprint × operator × pipelineId`（复用 `deploy_audit`） |

**为什么不再用 `~/.ssh` 文件**：多环境多机时文件散落、无法审计、换机即失效；DB 加密 + 主密钥分离后，任意 console 实例都能还原同一套凭据。

**前置条件**：`CONFIG_MASTER_KEY` 必须已配置（`openssl rand -base64 32`）—— ✅ 本机已配（base64 32 字节），作为 P1.0 的上线检查项。

**已确认决策（2026-09-14）与落地细节**

| 决策 | 落地细节 |
|---|---|
| **D5 按环境拆密钥** | `deploy_servers` 每行一把独立密钥（`dev-default` / `prod-default` 各自生成）；公钥写入目标机 `authorized_keys`。过渡期保留现有共用的 `id_ed25519_servers`（`ssh_key_path` 模式），新钥验证通过后再退役。**来源限制的形态见 §6.5**（是否可用 `from=` 取决于执行位置） |
| **D6 无 passphrase** | 生成：`ssh-keygen -t ed25519 -N "" -C "ws-console-<env>"`。代价是"私钥文件即凭据"，靠三重兜底：DB 加密 + 主密钥分离 + 来源限制（§6.5：`from=` 或 `command=` 强制命令） |
| **D7 轮换一起做** | UI 三步：① 录入新钥（存 DB，状态 `pending`）→ ② 一键"部署公钥到目标机"（ssh 追加 `authorized_keys`，去重）→ ③ 连接自检通过后"启用"并停用旧钥；旧钥保留 `revoked_at` 供审计 |
| 指纹与展示 | 入库存 `key_fingerprint`（`ssh-keygen -lf`）+ `key_comment`；列表只显示这两项与最近使用时间 |
| 审计 | 复用 `deploy_audit`：`credential.use` / `credential.rotate`，记录 `server × fingerprint × operator × pipelineId` |

**风险**：主密钥丢失 ⇒ 私钥不可用。对策：①离线备份主密钥；②`ssh_key_path` 文件模式保留为逃生通道。

### 6.5 SSH 来源限制由「谁发起连接」决定（`from=` 的前提）

`authorized_keys` 的 `from=` 限制的是 **SSH 连接发起方的出口 IP**。所以先要回答：**谁在发起连接？**

| console 部署位置 | SSH 来源 IP | `from=` 可用？ |
|---|---|---|
| **开发机（本机 macOS，当前默认）** | 家庭/办公宽带出口 IP，**通常动态**（NAT 后，可能随时变） | ❌ 不可用 —— IP 一变连接即断，而且**断了就进不去改回来**（死锁） |
| **dev 机上的 console**（175.27.189.123，已部署） | dev 机固定公网 IP | ✅ 可用 |
| 经**跳板/堡垒机**连目标机 | **跳板的 IP**（不是 console 的） | ✅ 可用（填跳板 IP） |
| 专用发布机（云主机，固定 IP） | 该机固定 IP | ✅ 可用 |

**三种落地（需选一个）**

| 方案 | 做法 | 评价 |
|---|---|---|
| **A（推荐）** | 发布执行落在**固定 IP 的机器**上 —— 首选复用 **dev 机上已有的 deploy-console**（它发 dev/prod，来源 IP 固定）；本机只做开发与本地发布（节点 `host` 留空） | 与项目现状吻合（dev 已有 console），`from=` 立即可用 |
| **B** | 本机作为 console，经**跳板 / 固定出口**（堡垒机、公司 VPN 固定出口）连目标机；`from=` 填跳板 IP | 需额外维护跳板 |
| **C** | 本机直连（当前默认）→ **放弃 `from=`**，改用等效加固：专用无口令密钥 + 目标机 sshd 加固（`PermitRootLogin no` —— prod 现在是 **root 登录** ⚠️、`AllowUsers`、fail2ban）+ **`command=` 强制命令**（把该密钥限制为只能执行部署脚本 —— 比 IP 限制更强，且不受 IP 变化影响）+ 全量审计 | 最省事，安全性靠"密钥用途收窄"而非"来源收窄" |

> 结论：**`from=` 是加分项，不是必需项**。真正兜底的是「专用密钥 + 用途收窄（`command=`）+ 审计」。IP 限制只在 console 有固定出口时才有意义，且必须同时准备"IP 变更后的救援路径"（云控制台 VNC / 另一把未受限的应急密钥）。

**待确认（已被 §6.6 取代，保留备查）**：采用 A / B / C？

### 6.6 堡垒机方案（2026-09-14 新增；用户另有轻量云主机）

用户另有一台**固定公网 IP 的轻量云主机**，可作为**堡垒机（jump host）**。这比「A：dev 直连 prod」更标准，建议采用 **D**：

| 方案 | 做法 | 评价 |
|---|---|---|
| **D（推荐）堡垒机** | 目标机（dev / prod / 网关）SSH **只放行堡垒机 IP**；人的运维登录与平台发布**都经堡垒机中转**（`ssh -J`）；`from=` 统一填堡垒机 IP | 来源唯一固定、与业务机解耦、人与平台共用一条审计路径 |
| A（备选）dev 直连 | dev console 直连 prod，`from=` 填 dev IP | 简单，但 dev 与 prod 互相暴露、dev 成为发布单点 |
| C 本机直连 | 放弃 `from=` | 本机 IP 动态，不可靠 |

**堡垒机的职责边界（重要）**

- ✅ **只跑 `sshd`**（+ fail2ban / 会话审计），**不跑业务、不跑 deploy-console**。
  理由：console 需要连 `web_system_deploy` 库；装在堡垒机就得放行 3306 到新机器，反而扩大暴露面。console 留在 dev（DB 本机）最简。
- ✅ 中转用 **`ProxyJump`（`ssh -J jump target`）**，**禁止** Agent Forwarding（`ssh -A`）：
  - `ProxyJump` 端到端加密，**私钥始终留在发起端**，堡垒机只做 TCP 中转；
  - `ssh -A` 把 agent socket 暴露到堡垒机，同机其他用户/机器被攻破时私钥可被冒用 —— 已知道风险，禁用。
- ✅ 堡垒机自身加固：禁密码登录、禁 root 直登、`AllowUsers`、fail2ban、只开必要端口；
- ✅ **保留救援通道**：云控制台 VNC —— 否则堡垒机就是全站 SSH 单点故障（挂了连人都进不去）；
- ✅ 若与 dev / prod **同地域**，走**内网 IP** 互联：不占公网带宽、延迟低，来源仍是固定内网 IP。

**对 P1 的影响**：SSH 通道需支持 `proxyJump`（`deploy_servers` 增加 `proxy_jump` 字段，如 `ubuntu@<jump-ip>:22`），内部拼装 `ssh -o ProxyJump=… <user>@<host>`。

**待确认**
1. 轻量云的**地域**是否与 dev / prod 同地域？（决定能否走内网）
2. 配置（CPU / 内存 / 带宽）与系统版本（建议 Ubuntu 22.04+）；
3. 是否接受"堡垒机 = 唯一 SSH 入口"（人登录也走它）——这会改变你现在的直连习惯。

---

## 7. 落地阶段（deploy-console 先行）

| 阶段 | 内容 | 验收 |
|---|---|---|
| **P0 引擎（本机）** | 执行器支持 `shell` / `approval` 两类节点：shell 复用 `runStageCommand`（多 action 顺序执行、`WS_RESULT_FILE`、超时、`continueOnError`）；approval 在 `run()` 循环中挂起/恢复 | 两节点模板跑通（shell 打印变量 → approval 通过 → shell 打印时间） |
| **P1 远程执行** | shell 节点支持 `host`；SSH 通道（stdin 脚本 + 变量按主机解析 + 超时 + 并发锁） | 用 `host=dev-default` 的 `restart` 节点，从 console 成功重启 dev 的 `ai-agent`（日志含目标机输出） |
| **P2 变量** | 配置中心增加 `scope=template` 与「流水线变量」管理页；注入顺序 内置 → 全局 → 模板 → 节点内联 | 定义全局 + 模板变量，节点内 `${VAR}` 取到；同名以模板层为准 |
| **P3 前端** | `PipelineEdit.vue` 画布：只渲染两类节点，均可增删改排序；节点编辑 = `actions` 列表（含 `host` 选择）+ `approval` 参数 | 页面能建出 §5.1/§5.2/§6.1 的流水线 |
| **P4 迁移与退役** | 存量模板迁移（platform git/version/pointer → shell + service action）；下线 `PLATFORM_RESERVED` / `check-base` / legacy 九阶段 / `deploy_pipeline_step_commands.locked` 托管 | 老模板在新引擎下跑通；`git-step.sh` / `restart-step.sh` / `verify-step.sh` 托管机制退役 |

**注意**：P4 会**取代**刚做的 restart/verify 平台托管（`PLATFORM_STEP_SCRIPTS`）——新模型下它们是普通 shell 节点，不再需要 `locked`。两步不冲突，但不建议在 P0~P3 期间继续扩展托管清单。

---

## 8. 风险与待确认

| # | 风险 / 问题 | 建议 |
|---|---|---|
| R1 | `version` / `pointer` 现由平台内置完成（写 `deploy_versions`/`deploy_deployments` + gateway manifest），改 `service` action 需完整实现其语义（含灰度 `canary`） | P0 先保留 `service` action 的**最小实现**（写版本表 + 切指针），灰度后续 |
| R2 | 审批从"前置门禁"变"节点"：`deploy_approvals` 需加 `nodeKey` 维度，`run()` 要支持挂起/恢复（含服务重启后恢复） | 明确"挂起态持久化"策略（流水线实例状态机加 `awaiting-approval` 节点级状态） |
| R3 | legacy 九阶段与 v5 并存期，迁移是否要求"一次性切换" | 建议：新模型只对新模板生效，存量模板走迁移工具转换（提供 dry-run） |
| R4 | 变量复用 `config_items` 会引入 `scope='template'`，与既有 `global/env/module` 的优先级要重新定义 | 建议优先级：内置 < global < env < module < template < 节点内联 |
| R5 | `check` 节点（安全基线：复用检测/分支约束）在"所有节点可配"后是否保留内置校验 | 建议保留为**创建时的校验**（提交前拦），不占节点位 |

---

## 变更日志

- 2026-09-14 首版：基于现状调研（节点 kind=platform/script、变量仅内置+配置中心、审批为前置门禁）给出两类节点 + 变量的目标模型与两条流水线配置方案。
- 2026-09-14 追加 §6「远程机器发布能力」：shell 节点加 `host`、SSH 执行通道、两种编排（远程自拉自建 / 本地构建+远程部署）、并发与回滚要点；落地阶段插入 P1（远程执行），后续阶段顺延。
- 2026-09-14 追加 §0 方案总览（全景图 / 决策 D1–D8 / 阶段路线 P0–P4 / 关联文档）；§6.4 落定凭据决策：按环境拆密钥、无 passphrase、轮换 UI 一起做。
- 2026-09-14 **P0 落地**：`ApprovalNode` 入模型、`planNodeExec` 加 `how='approval'`、节点级挂起/恢复（`awaiting-approval` + `stage` 作恢复锚点）、可注入 `ShellRunner` 让引擎首次可测；本机三节点端到端跑通。实现细节、五条落地决策与两条已知缺口见 `tasks.md` §4/§6 与 `P0-handoff.md` §9–§11。
