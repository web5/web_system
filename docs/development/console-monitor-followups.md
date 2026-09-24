# 待办 · deploy-console 服务监控页（dev 环境）

> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on

> 定位：服务监控页（`/monitor`）在 dev 控制台上的两个问题（页签口径 + 取数失败）的**事实、拍板口径与实现清单**。
> 状态：**用户挂起，回头自行跟进**（2026-09-24 提出，未落码）。
> ⚠️ 原记在 `session-handover-2026-09-23.md` §9，因该文件被并发会话重写而丢失，改放这里（不要写回那份交接文档）。

---

## 1. 现象（dev 控制台 https://dev.kedouai.com/console/ → 服务监控）

1. 页签「本地 / DEV / PROD」三档，**dev 环境下「本地」多余**：「本地」= deploy-console 所在主机，
   而 dev 控制台就跑在 dev 机 175.27.189.123 上，与 DEV 重复。
2. 切到 DEV：服务状态表所有服务 `离线 / timeout`；PM2 进程表弹「获取 PM2 进程失败」。

## 2. 代码落点

| 层 | 文件 | 位置 |
|---|---|---|
| 前端页 | `apps/deploy-console/src/views/ServiceMonitor.vue` | 页签硬编码 local/dev/prod；`loadHealth`/`loadPm2`/`viewLogs` 按 `activeKey` 分流；catch 只有通用文案 |
| 前端 API | `apps/deploy-console/src/api/index.ts` | `monitorApi.*`（远端 vs `local*` 两套） |
| 后端 | `servers/deploy-console/src/monitor/monitor.controller.ts` | `/monitor/{health,pm2,logs,port}` 与 `/monitor/local/*` 双组端点 |
| 后端 | `servers/deploy-console/src/monitor/monitor.service.ts` | `getSshConfig`、`execSsh`(10s)、`healthCheck`、`execLocal` 系列 |
| 后端 | `servers/deploy-console/src/server/server.service.ts` | `resolveEnvDefaultServer` → `deploy_servers.serverName='<env>-default'`（**旧表**） |
| 参照 | `apps/deploy-console/src/views/DiagnoseCenter.vue` | 动态目标写法（本机 + 环境字典），可对齐的样板 |

## 3. 已核对的链路事实（读码）

- DEV/PROD 全走 SSH，local 走 `execLocal`（`execSync`）。发布侧同口径：`deploy.service.ts:502` `if (input.env !== 'local')` 才走远端。
- `getSshConfig`：`sshKeyPath || '~/.ssh/id_ed25519_servers'`，`fs.existsSync` 为假时 **privateKey 保持 undefined 且不报错** → ssh2 无凭据 → `SSH 连接失败`。
- 同一故障两种表现：`healthCheck` 逐服务 try/catch，异常吞掉只写 `status=down, response=timeout`；`getPm2List` 直接抛 `BadGatewayException`，前端通用文案盖掉真实原因。
- 健康表的「服务 + 地址」现在读 `deploy_environments.address`（形如 `127.0.0.1:6003`），不是新模型。

## 4. 对账结果（2026-09-24 实跑，只读）

库：`web_system_deploy`。**dev 控制台连云库**（`gz-cdb-8y2lp8rt:27241`），**编排者本机控制台连本机 MySQL 127.0.0.1**；两份内容基本一致（本机库多一条 `staging-default`）。

### 4.1 根因确认：dev 机没有监控用的私钥

```
dev 机 /home/ubuntu/.ssh/ 只有：github_ed25519、id_ed25519、known_hosts…
表里登记 ssh_key_path = ~/.ssh/id_ed25519_servers   ← 不存在
deploy-console 进程：HOME=/home/ubuntu，用户 ubuntu
```
→ privateKey=undefined → `SSH 连接失败` → PM2 报错、健康全 timeout。**与现象吻合。**

修法（都不改取数路径）：A 放私钥到 dev 机 / B 改用已有的 `id_ed25519` / **C 另建专用 key（已选 C）**。

**C 的落地步骤（专用 key，一次配好）**

> ✅ **已于 2026-09-24 执行完成**，实测 dev 监控接口恢复（证据见本节末尾）。

1. 生成专用密钥对（名字沿用表里的登记名，避免再改数据）：
   `ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_servers -C 'deploy-console-servers' -N ''`
2. 公钥进目标主机的 `authorized_keys`：
   - dev（ubuntu@175.27.189.123）`~/.ssh/authorized_keys` ← **控制台就跑在这台，等于自连，必须加**
   - prod（root@106.52.176.246）`~/.ssh/authorized_keys`
3. 私钥分发到**所有会跑控制台的机器**（两份控制台都要能出网 SSH）：
   - 编排者 Mac：`~/.ssh/id_ed25519_servers`（`chmod 600`）
   - dev 机：`/home/ubuntu/.ssh/id_ed25519_servers`（`chmod 600`，属主 ubuntu —— 控制台进程 HOME 就是它）
4. 数据侧：`deploy_hosts` 三行的 `ssh_key_path` 已是 `~/.ssh/id_ed25519_servers`，`~` 由服务端按 `$HOME` 展开 → **不用改数据**。
5. 验证：`ssh -i ~/.ssh/id_ed25519_servers ubuntu@175.27.189.123 'echo OK'`（Mac 侧）+ dev 机自连同样一条。
6. 代码侧：把"私钥文件不存在 → `privateKey=undefined` 静默"改成**显式报错**（否则下次还会只看到 timeout）。

**执行结果（2026-09-24）**

| 项 | 结果 |
|---|---|
| 私钥 | 本机 `~/.ssh/id_ed25519_servers` **已存在**（2026-08-14，comment `workbuddy-servers`）→ 沿用，未新建 |
| dev 机公钥 | `authorized_keys` **已含**该公钥（自连前提已满足） |
| prod 机公钥 | `authorized_keys` **已含**该公钥（本机→prod 本来就是通的） |
| dev 机私钥 | **原先缺失（这就是根因）** → 已 scp 到 `/home/ubuntu/.ssh/id_ed25519_servers`（600，属主 ubuntu，411 B） |
| dev 自连验证 | `ssh -i ~/.ssh/id_ed25519_servers ubuntu@175.27.189.123` → `DEV_SELF_SSH_OK` ✅ |
| 接口验证 | dev 控制台 `GET /console/api/monitor/pm2?env=dev` 正常返回进程数组；`health?env=dev` 全部 `up`（404/200 均按"在监听"计）✅ |

→ **dev 报错问题已解决**，剩下的只有"页签口径（local 冗余）"这一件事（§4.4 / §5）。

> 规模提示：将来若再增加"跑控制台的机器"，私钥要跟着分发 —— 与 `CONFIG_MASTER_KEY` 是同一类 provision 问题
> （参考 `specs/config-master-key-distribution/design.md`）；**重启/新建控制台前先确认私钥与 master key 都在位**。

### 4.2 组名对账通过：新旧表同名，可直接切

| 表 | 云库（dev 控制台） | 本机库 |
|---|---|---|
| `deploy_servers` | `dev-default`(175.27.189.123/ubuntu)、`prod-default`(106.52.176.246/root) | 同左 **+ `staging-default`(10.0.0.9/ubuntu)** |
| `deploy_hosts` | `dev-default`、`prod-default`、`local-default` | 同左（3 行） |

三行的 `ssh_user` / `ssh_key_path` / `remote_dir` 在新旧表**完全一致** → 切换无需改组名。

### 4.3 本机已登记（Q1 的"需要登记"已满足）

```
deploy_hosts.local-default → host=127.0.0.1  ssh_user=geekwen  ssh_key_path=NULL
                             remote_dir=/Users/geekwen/web_system_release  runtime=pm2  enabled=1
deploy_service_envs：env_id=local 共 12 行，全部指向 local-default
```

### 4.4 ⚠️ 对账暴露的新问题（待拍板）

`local-default` 地址是 **127.0.0.1（回环）**，且**两份控制台库里都有这一行**。
按 D2「主机管理有登记 = 可管环境」推导，dev 控制台页签仍会列出 local，
而它 SSH 127.0.0.1 用 `ssh_user=geekwen`（dev 机无此用户）→ **必然失败**。

| 选项 | 做法 |
|---|---|
| (a) 数据收口 | local 相关登记只留在编排者本机那份库，dev（云）库清理掉 |
| **(b) 主机加"归属/类型"字段 ← 已选** | 见下方展开 |
| (c) 保持现状 | dev 页出现一个永远失败的 local 分组 |

**已选 (b)。**主机表新增一个类型字段（名字待定，`kind` 或 `scope`），取值正好对应用户给的分类：
**`local`（本机形态） / `cloud`（云服务器） / `container`（容器服务器）**。
`local-default` 标 `local`，`dev-default` / `prod-default` 标 `cloud`。

落到两种子方案，差别只在"监控页要不要保留「本地」页签"：

| 子方案 | 规则 | 本机控制台看到 | dev 控制台看到 | 是否需要"我是谁" |
|---|---|---|---|---|
| b1 | 监控页只列 `cloud`/`container` 主机构成的环境；`local` 主机只在**自助诊断页**作为「本机」目标 | DEV / PROD（看本机去诊断页） | DEV / PROD | 不需要 |
| **b2 ← 已选** | 主机再加 `managed_by`（归属控制台实例），控制台自带实例标识（一个 `.env` 键） | **本地 / DEV / PROD（与现状一致）** | DEV / PROD | 需要（一行配置） |

**b2 的完整设计**

`deploy_hosts` 新增两列（字段命名已定：**`scope`**；归属列 `managed_by`）：

| 列 | 类型 | 取值 | 含义 |
|---|---|---|---|
| `scope` | varchar(16)，默认 `cloud` | `local` / `cloud` / `container` | 主机形态分类（**现在就落**；`container` 暂无实例，先留取值） |
| `managed_by` | varchar(64)，可空 | 控制台实例标识；**NULL = 所有控制台可见** | 这台主机归哪份控制台管 |

回填：`local-default` → `scope=local`、`managed_by='orchestrator'`；`dev-default` / `prod-default` → `scope=cloud`、`managed_by=NULL`（两份控制台都能管）。

控制台侧新增一个配置键（各份 `.env` 写死，属于部署期事实）：

| 控制台 | `CONSOLE_INSTANCE` |
|---|---|
| 编排者本机 | `orchestrator`（**必配，无默认值**） |
| dev 控制台 | `dev`（**必配**，落在 `/data/web_system/servers/deploy-console/.env`） |

**不兜底（用户 2026-09-24 明确）：`CONSOLE_INSTANCE` 缺失 = 系统错误，不做默认回落。**
（此前设计"默认 `orchestrator`"，已废弃 —— 回落会让 dev 控制台静默冒出「本地」页签，属隐性错误。）

落地规格：**与 `CONFIG_MASTER_KEY` 同规格的启动自检（FATAL）**
—— 进程启动时读不到 `CONSOLE_INSTANCE` 即 FATAL 退出，不在接口层静默兜底；
接口层（`GET /monitor/envs`）再校验一次并抛明确错误（双保险，防止配置被热改/空串）。参考 `config-self-check` 的既有写法。

页签推导（`GET /monitor/envs`）：
**环境 E 可管 ⇔ 有 `deploy_service_envs` 指向 E ∧ 其 `hostName` 在 `deploy_hosts` 解析到启用中的地址
∧（`managed_by` IS NULL ∨ `managed_by` = `CONSOLE_INSTANCE`）**

→ 本机：local（归 orchestrator）+ dev + prod（NULL）= 三档；dev 控制台：dev + prod = 两档。**不需要判断机器身份，只比一个字符串。**

> ⚠️ `CONSOLE_INSTANCE` 与 `CONFIG_MASTER_KEY`、SSH 私钥同属"部署期 provision"三件套：
> **新建/重启控制台前必须确认三者都在位**（三者缺失都是启动即 FATAL，没有静默回落；
> master key 缺失的崩溃循环见交接文档 §8.7）。

> 注：`deploy.service.ts` 的 local 分支先于 SSH 命中，**发布侧不受影响**；
> `local-default` 主机行与 `env_id=local` 的 service_envs **保留在两份库**（转发解析与 `env=local` 发布还要用），
> 只是不再喂给监控页页签。

### 4.5 切到新模型后的数据源（dev 12 个服务齐全）

`deploy_service_envs`(env_id=dev) → `host_name=dev-default` + port：
gateway 6000 / auth 6001 / user 6002 / ai-service 6003 / system 6004 / todo 6005 /
mcp-gateway 6006 / content-hub 6007 / upload 6008 / ai-agent 6010 / knowledge 6011 / deploy-console 6200。

---

## 5. 已拍板口径（2026-09-24）

**D1 · 只有一个概念：环境（env）；取数方式由环境决定，与"我站在哪台机器"无关。**

| 环境 | 定义 | 取数 |
|---|---|---|
| `local` | 编排者本机（`env=local` 那个环境） | 本机 `execLocal` |
| `dev` | dev 主机 175.27.189.123 | **SSH 到 `dev-default`**（即使在 dev 控制台点它、物理同机，也照走 SSH —— 用户明确否决"目标==自己就本机执行"） |
| `prod` | prod 主机 106.52.176.246 | **SSH 到 `prod-default`** |

**D2 · 可管环境的真相源 = 基础设施 → 主机管理（`deploy_hosts`）**，不是新增配置、也不是运行时身份判断。
主机管理里的节点**可以是真实云服务器，也可以是容器服务器**。
推导：**环境 E 可管 ⇔ 存在 `deploy_service_envs` 行指向 E，且其 `hostName` 能在 `deploy_hosts` 解析出启用中的地址。**

**D3 · 监控页页签由后端下发**（新增 `GET /monitor/envs`），不再硬编码；`DiagnoseCenter` 目标下拉同源。

**D4 · 监控取数整体切到 `deploy_hosts`**（经 `deploy_service_envs.hostName`），与发布/转发同源；
`monitor.service.ts` 与 `deploy.service.ts:1210` **一起切**，下掉 `deploy_servers.<env>-default` 旧路径。
同时把"私钥缺失静默 undefined"改成**显式报错**。

**Q1** 本机登记进主机管理 → **已存在**（§4.3）。
**Q2** 一起切 → 是。
**Q3** PM2 **逐台取、按主机分组展示**（示例见 §6）。

---

## 6. PM2 按主机分组 · 展示示例

```
服务状态（仍是一张表，新增「主机」列，可按主机筛选）
┌──────────┬────────┬───────────────────────┬──────┬──────────┬──────────┐
│ 服务      │ 主机    │ 地址                   │ 状态  │ 响应      │ 响应时间 │
├──────────┼────────┼───────────────────────┼──────┼──────────┼──────────┤
│ gateway   │ dev-a   │ 175.27.189.123:6000    │ 在线  │ 200       │ 12 ms    │
│ auth      │ dev-a   │ 175.27.189.123:6001    │ 在线  │ 200       │ 9 ms     │
│ user      │ dev-b   │ 10.0.0.7:6002          │ 离线  │ timeout   │ —        │
└──────────┴────────┴───────────────────────┴──────┴──────────┴──────────┘

PM2 进程（按主机分组）
┌ ▾ dev-a · 175.27.189.123 · pm2 · 12 个进程 · 取数 340 ms ──────────────┐
│  进程名        状态     CPU    内存     运行时间     重启   操作        │
│  web-gateway   online   0.3%   128 MB   3天2小时     0     查看日志     │
│  web-auth      online   0.1%    96 MB   3天2小时     0     查看日志     │
│  …（其余 9 个）                                                         │
└─────────────────────────────────────────────────────────────────────────┘
┌ ▾ dev-b · 10.0.0.7 · docker · 取数失败 ────────────────────────────────┐
│  ⚠ SSH 连接失败: All configured authentication methods failed          │
│    主机组 dev-b（10.0.0.7 / ubuntu），密钥 /home/ubuntu/.ssh/xxx 不存在 │
│    [ 重试 ]  [ 去主机管理检查 ]                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

| 项 | 口径 |
|---|---|
| 分组依据 | 该环境涉及主机**去重**后逐台取；分组头：主机组名 · 地址 · `runtime` · 进程数 · 取数耗时 |
| 可达主机 | 折叠面板默认展开，组内是现有 PM2 小表 |
| 不可达主机 | **分组仍出现**（不能整块消失），`Alert` 给真因 + 「重试」「去主机管理检查」 |
| 只有 1 台主机 | 分组头保留但弱化，避免"12 个进程被一层壳包住"的多余感 |
| antd 实现 | `a-collapse`(ghost) + 组内 `a-table size="small" :pagination="false"`；失败组 `a-alert type="error"` 替代表格 |
| 接口形状 | `{ hosts: [{ name, host, runtime, ok, error?, tookMs, procs: [...] }] }`（**结构变了**，前端同步改） |

> 服务状态表**不分组**：行是「服务 × 主机 × 端口」，本来就跨主机，加「主机」列 + 按主机筛选即可。

---

## 7. 实现清单

| # | 改动 | 文件 |
|---|---|---|
| 0 | 建专用 SSH key 并分发（Mac + dev 机），公钥进 dev/prod 的 `authorized_keys` | 见 §4.1 步骤 —— **✅ 已完成 2026-09-24** |
| 0.5 | `deploy_hosts` 新增 `scope`（`local`/`cloud`/`container`，默认 `cloud`）+ `managed_by`（可空）并回填（§4.4 b2） | 迁移 `migrations/0014_deploy_host_scope.sql` ✅ 已写；实体/dto/`HostsService` 已同步 ✅ —— **SQL 待应用**（dev 云库与本机库都要） |
| 0.6 | dev 控制台 `.env` 写 `CONSOLE_INSTANCE=dev`；本机那份写 `orchestrator`（**必配，缺即启动 FATAL**） | `/data/web_system/servers/deploy-console/.env` —— **运维动作，待执行** |
| 1 | SSH 来源切到 `deploy_hosts`；私钥缺失改显式报错 | `monitor.service.ts` ✅ |
| 2 | `deploy.service.ts` 同步切（新表优先，**旧表保留回退**，见 §7.1） | `deploy.service.ts` ✅ |
| 3 | 健康检查的「服务+地址」改由 `deploy_service_envs`（hostName+port→hostAddress）解析，按服务所在主机探活，返回 `hostName` / `error` | `monitor.service.ts` ✅ |
| 3.5 | 页面顶部**诊断横幅**：任一主机取数失败即顶部 `Alert` 显示真因（主机 / 用户 / 密钥路径 / 错误），并提供「去主机管理检查」 | `ServiceMonitor.vue` —— **UI，待走动作门** |
| 4 | 新增 `GET /monitor/envs`（按 §4.4 b2 的 `managed_by` 规则过滤） | `monitor.controller.ts` / `monitor.service.ts` ✅ |
| 5 | 新增 `GET /monitor/pm2/hosts`：环境内主机去重 → 逐台取 → 分组返回（含 `ok` / `error` / `tookMs`） | `monitor.service.ts` ✅ |
| 6 | 监控页：页签按 `/monitor/envs` 渲染、PM2 按主机分组（§6） | `ServiceMonitor.vue`、`api/index.ts` —— **UI，待走动作门** |
| 7 | `DiagnoseCenter.vue` 目标下拉改用同一来源 | 同上 |

> 1-5 已在分支 `feature/console-monitor-env-scope`（worktree `/tmp/wt-monitor`）提交：
> `99c80f1`（主体）、`4caa713` + `edc306c` + `c57cefc`（探活三连修，见 §7.2）。
> 全量单测 509 passed、`tsc --noEmit` 通过；分支已 push（auto-pr 自动建 PR）。
> 旧端点 `/monitor/pm2` 保留扁平结构，前端切换前不受影响。

#### dev 实测（2026-09-24，已发布到 dev 并验证）

| 接口 | 结果 |
|---|---|
| `GET /monitor/envs` | `[{"id":"dev"},{"id":"prod"}]` —— **local 不再出现** ✅ |
| `GET /monitor/pm2?env=local` | 502「环境 local 在「主机管理」中没有可解析且归属本控制台的主机」—— 被 `managed_by` 拦住 ✅ |
| `GET /monitor/pm2/hosts?env=dev` | `dev-default / 175.27.189.123 / cloud / pm2 / ok=true / 13 进程 / 707ms` ✅ |
| `GET /monitor/health?env=dev` | **12/12 up**（200/404 都算在监听），带 `hostName` ✅ |

### 7.2 探活改造踩的两个坑（别重犯）

1. **每台主机只能建一条 SSH 连接**：一开始"每个服务一条 SSH"，12 条并发握手被 sshd 拒
   （`Connection lost before handshake`，只剩 1/12 up）→ 改为按主机归拢、一条命令探完所有端口。
2. **命令内必须并行、且先探回环**：12 个 curl 串行会累计超过 `execSsh` 的 10s 超时（全 timeout）→
   改成 `( … ) & done; wait`；探测目标先 `127.0.0.1:port`（命令就在那台机上跑，多数服务只监听回环），
   `000` 再退到 `host:port`，否则只监听回环的服务会被误判离线。

> 另注：回填值（`local-default` → scope=local / managed_by=orchestrator）**观察到一次被重置为 cloud/NULL**
> （原因未定位，疑与启动期 synchronize 或并发会话写库有关）。应用迁移后**务必复核一次**，
> 复核 SQL：`SELECT name,scope,managed_by FROM deploy_hosts;`（两份库都要）。

### 7.3 本地发布实测（2026-09-24 · 发布目录已驻留 feature/test）

| 接口 | 结果 |
|---|---|
| `GET /monitor/envs` | `[dev, prod, local]` —— 编排者本机视角**含「本地」** ✅ |
| `GET /monitor/pm2/hosts?env=local` | `local-default / 127.0.0.1 / scope=local / ok=true / 12 进程 / 175ms`（走**本机执行**）✅ |
| `GET /monitor/health?env=local` | **12/12 up**（含 deploy-console 自己）✅ |
| `GET /monitor/pm2/hosts?env=dev` | `dev-default / 175.27.189.123 / scope=cloud / ok=true / 13 进程`（走 **SSH**）✅ |

### 7.4 本机形态（scope=local）的两个坑（重要）

1. **必须走本机执行，不能被拉去 SSH**：改以主机管理取数后，`env=local` 一度被 SSH 到 `127.0.0.1:22`
   → `ECONNREFUSED`（本机没有 sshd）。执行方式由**主机管理登记的 `scope`** 决定：`local` → execLocal，
   `cloud`/`container` → SSH。注意：这不是"目标 IP 等不等于自己"的运行时探测（那条口径已否决），
   而是显式业务登记，与发布侧 `env === 'local'` 同口径。
2. **本机执行不能用 `execSync`**：它阻塞 Node 事件循环 —— 控制台探活"自己"时无法接受连接，
   那条必然返回 `000`（表现为 deploy-console 自己离线）。已改为 `child_process.exec` + Promise 的
   `execLocalAsync`，只用于按主机执行的新路径；旧 `/monitor/local/*` 端点仍走 execLocal，行为不变。

### 7.5 ⚠️ 结构性风险：`scope` / `managed_by` 列与值会被"吃掉"（待治本）

实测两次异常：

| 库 | 现象 |
|---|---|
| 本机库 | 列在，但 `local-default` 的 `scope`/`managed_by` 被重置为默认（cloud / NULL） |
| dev 云库（`web_system_deploy`，**dev 与堡垒机共用**） | **`scope` / `managed_by` 两列被 DROP** |

高度怀疑的根因：**deploy-console 用 `synchronize: true`**，而该库被多个实例共用（dev 与堡垒机各一份
deploy-console）。**旧代码实例启动时会把实体里没有的列 DROP 掉**；新列因此丢失。
（已排除：gateway 的 deploy 连接 `synchronize: false`；脚本里只有 `p23-cleanup-history.mjs` 提及
`deploy_hosts` 且只删备份表。）

处置待你拍板（三选一）：

| 方案 | 说明 |
|---|---|
| A（治本） | 关掉 deploy-console 的 `synchronize`（改 `false` + 走 `migrations/`），并统一各实例版本 |
| B（过渡） | 每次发布后复核并补回列与回填值（**现在就是这么做的**），逐步推进 A |
| C | 控制台库按实例拆分（dev / 堡垒机各一份）—— 与"共用"现状相反，成本最高 |

补回命令（两份库都要跑，应用后复核）：

```bash
mysql -h <host> -P <port> -u <user> -p web_system_deploy < migrations/0014_deploy_host_scope.sql
# 复核
SELECT name, host, scope, managed_by FROM deploy_hosts;
```

### 7.1 发布侧为什么保留旧表回退（重要发现）

`deploy_service_envs` 目前只有**后端服务**（gateway / auth / user / ai-service / ai-agent / system / todo /
knowledge / upload / mcp-gateway / content-hub / deploy-console）的行，
**前端模块 admin / portal 没有登记** → 若把 `deploy.service.resolveDeployServers` 完全切成新表并 fail-fast，
admin / portal 的远端发布会被阻断。
因此实现为：**主机管理优先 → 旧表 `deploy_servers` 回退**（二者都取不到才报错）。
等 `deploy_service_envs` 补齐 admin / portal 行后，再去掉回退分支（待你决定何时补）。

> 属 UI 源码，落码前按 UI 动作门：原型 → 质检 → 用户确认 → commit 带 `Proto: <sha>`。

## 8. 拍板记录（2026-09-24）

| 项 | 结论 |
|---|---|
| §4.4 local 登记处置 | **(b) 主机加"归属/类型"字段**，走 **b2**：`scope`(local/cloud/container) + `managed_by` + 控制台 `CONSOLE_INSTANCE`；本机控制台保留「本地」页签 |
| §4.1 私钥修法 | **C 另建专用 key**（`id_ed25519_servers`），分发到 Mac + dev 机，公钥进 dev/prod |
| 失败原因呈现 | **大：页面顶部诊断横幅**（同时保留 §6 的"不可达主机分组 Alert"） |
| 字段命名 / 落地时机 | **`scope`**（不用 `kind`）；**现在就落字段**（`container` 暂无实例，取值先留） |

## 9. 开工前的最后一句

口径已齐（D1-D4 + Q1-Q3 + §8 三项）。下一步按 §7 清单开工；**落码前先走 UI 动作门**
（原型整合进 deploy-console 既有原型稿 → 交互质检 → 你确认 → 原型单独 commit 记 sha → UI commit 带 `Proto: <sha>`）。
第 0 / 0.5 / 0.6 三步是**运维与 DB 动作**，可以先行，不依赖原型。
