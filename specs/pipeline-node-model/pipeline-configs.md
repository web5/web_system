# 发布流水线配置 · `admin` / `ai-agent`

> 状态：**已落库**（2026-09-14），模板默认停用见 §5。
> 关联：`design.md` §5（两条流水线怎么配）、§6（远程发布）、`tasks.md` §6（P0 实现记录）。

---

## 1. 目标流程（业务视角四步）

```
① 拉代码（分支 + commitId） → ② 构建（指定构建脚本） → ③ 审批（指定审批人） → ④ 发布（远程机器 + 可填发布路径）
```

| 步骤 | 谁来定 | 落点 |
|---|---|---|
| ① 分支 / commitId | **提交时**填写 | `deploy_pipelines.git_branch` / `requested_commit`；引擎注入 `BRANCH` / `COMMIT_ID` 变量 |
| ② 构建脚本 | **模板固化**（可按模块改） | `deploy_pipeline_step_commands(templateId, 'build').actions` |
| ③ 审批人 | **模板固化** | `nodes[kind=approval].approvers` |
| ④ 远程机 + 发布路径 | **模板固化，可改** | 发布节点脚本顶部的 `PUBLISH_HOST` / `PUBLISH_USER` / `PUBLISH_PATH` 变量 |

> 变量为什么写在脚本顶部：模板级变量（配置中心 `scope=template`）属 **P2**，尚未落地。
> 现在这三项写成脚本内 `:-` 默认值的形式，**改一行即可换机器/换路径**；P2 落地后直接换成 `${PUBLISH_PATH}` 注入即可，脚本不用重写。

---

## 2. 实现视角的节点清单（引擎真实执行的顺序）

引擎当前仍是 v5 节点模型（platform + script + approval），与「两类节点」目标模型的差异见 §6。

### 2.1 `admin`（微前端，`apps/admin` → 静态产物）

| # | 节点 | kind | 说明 |
|---|---|---|---|
| 1 | `git` | platform | 拉代码：平台托管脚本（locked，随代码同步）。用到 `BRANCH` / `COMMIT_ID` |
| 2 | `build` | shell | `RELEASE_TAG=$COMMIT_ID MF_FORMAT=system npx vite build --mode mf` |
| 3 | `gate` | **approval** | 发布确认，审批人 `admin`；`onReject=abort` |
| 4 | `publish` | shell | 打包 `dist` → scp → 远端解压到 `$PUBLISH_PATH/$COMMIT_ID` |
| 5 | `version` | platform | 写版本表（平台语义，不可脚本覆盖） |
| 6 | `pointer` | platform | 切版本指针（指针库在 console 侧，必须平台做） |
| 7 | `verify` | shell | 等 gateway TTL 后断言 manifest 含本次 commit |

### 2.2 `ai-agent`（后端，`servers/ai-agent` → pm2 进程）

| # | 节点 | kind | 说明 |
|---|---|---|---|
| 1 | `git` | platform | 同 admin |
| 2 | `build` | shell | `npx nest build`（缺 nest-cli.json 时回退 `npx tsc -p tsconfig.json`） |
| 3 | `gate` | **approval** | 发布确认，审批人 `admin` |
| 4 | `publish` | shell | 打包 `dist` → scp → 远端解压 → **远端**执行 `scripts/pipeline/restart-backend.sh` |
| 5 | `version` | platform | 写版本表 |
| 6 | `verify` | shell | **远端**执行 `scripts/pipeline/verify-backend.sh`（pm2 online + 端口 + AI 链路） |

> 后端没有 `pointer`（`PointerExecutor` 对 backend 有 skip 守卫），也没有 `upload`（跑的是发布目录里的 dist，不经静态产物）。

---

## 3. 发布参数（三条模板的默认值，可改）

| 变量 | admin 默认 | ai-agent 默认 |
|---|---|---|
| `PUBLISH_HOST` | `175.27.189.123`（dev-default） | 同左 |
| `PUBLISH_USER` | `ubuntu` | 同左 |
| `PUBLISH_KEY` | `~/.ssh/id_ed25519_servers` | 同左 |
| `PUBLISH_PATH` | `/data/web_system/servers/gateway/public/static/modules/admin` | `/data/web_system/servers/ai-agent` |

与 `deploy_servers` 的对应关系：`dev-default` = `175.27.189.123` / `ubuntu` / `/data/web_system`；
`prod-default` = `106.52.176.246` / `root` / `/data/web_system`。

---

## 4. 历史数据清理

- `deploy_pipelines`：241 条 `pending` + 4 条 `succeeded` → **全部删除**（pending 是历史遗留的僵尸记录，无对应进程）
- `deploy_approvals`：5 条 → **全部删除**（随流水线一起失效）
- `deploy_versions`：218 条 → **保留**（回滚/按版本发布的候选；是否清理另行确认）
- 我此前建的 5 条 `P0 节点模型…` 演示/验证模板 → **删除**

---

## 5. 模板启用状态（2026-09-15 更新）

**终态（2026-09-15）**：一条流水线 = 一个「模块 × 环境」，共 **18 条，全部启用**：

| 模块 | local | dev | prod | 产物落点（本机） |
|---|---|---|---|---|
| admin / portal / shell（前端类） | ✅ | ✅ | ✅ | `servers/gateway/public/static/modules/<key>/<流水线key>/<commit>/` |
| gateway / ai-agent / mcp-gateway（后台） | ✅ | ✅ | ✅ | `servers/<key>`（就地发布，pm2 重启） |

远程（dev / prod）在 2026-09-15 验证过 SSH 连通性（`175.27.189.123` / `106.52.176.246`，
`/data/web_system` 可写）后启用；p5 迁移脚本已把 `enabled` 统一置 1。

> 历史（2026-09-14）：只跑本地，远程两条停用 —— 见下。

| 模板 | module_key | 状态 | 节点 |
|---|---|---|---|
| `tpl-local-admin` | admin | **启用** | `git → build → gate → upload → version → pointer → verify` |
| `tpl-local-ai-agent` | ai-agent | **启用** | `git → build → gate → restart → version → verify` |
| `tpl-publish-admin` | admin | 停用 | 远程版（待 P1 节点 `host` + SSH 通道） |
| `tpl-publish-ai-agent` | ai-agent | 停用 | 同上 |

**本地版为什么不写 publish 脚本**：`upload` / `verify` / `restart` 是 `commandMode='override'`，
未配命令时回退平台内置执行器；`restart` / `verify` 还会被 `PlatformScriptSeedService`
在提交时写入平台托管脚本（`locked=true`）。所以本地流水线**只需配一条 build 命令**。

**远程版为什么必须停用**：`seedForTemplate` 会用平台托管脚本**覆盖**节点自定义命令
（`restart`/`verify`），远程语义（在目标机上执行）无法靠节点命令表达 ——
这正是 design §6 要做「节点 `host` + 平台 SSH 通道」的原因。

发布路径（本地，平台变量推导，无需手填）：
- admin：`$RELEASE_DIR/servers/gateway/public/static/modules/admin/$COMMIT_ID`（=`$ARTIFACT_DIR`）
- ai-agent：`$RELEASE_DIR/servers/ai-agent`（跑发布目录里的 `dist`，不经静态产物）

---

## 6. 与目标模型的差异（后续阶段收敛）

| 目标模型（design §3/§6） | 当前落库形态 | 收敛阶段 |
|---|---|---|
| git 是普通 `shell` 节点 | `platform git`（复用平台托管脚本，自动同步） | P4 |
| 远程执行靠节点 `host` + 平台 SSH 通道 | 发布节点**脚本内 ssh/scp**（引擎今天只跑本机） | P1 |
| 发布路径 / 目标机是模板变量 | 脚本顶部 `PUBLISH_*` 变量 | P2 |
| 审批人由系统用户表校验 | `approvers: ['admin']` 仅记录，未做权限校验（console 目前只有 env 里的单一管理员） | P1（审批中心） |
| `kind: 'shell'` | 落库用 `shell`，引擎按 `script` 语义执行（分派兼容，见 `planNodeExec`） | P4 |

---

## 7. 待确认（影响首次实发）

1. **目标机**：默认填的是 dev。admin / ai-agent 是否都发 dev？prod 需要按环境拆（可复制模板改 `PUBLISH_HOST`）。
2. **SSH 前置**：console 所在机（本机 macOS，出口 IP 动态）能否直连 `175.27.189.123`？私钥 `~/.ssh/id_ed25519_servers` 是否已授权？
   design §6.6 的堡垒机方案会让这里改成 `ssh -J`。
3. **审批人**：现在只有 `admin` 一个账号；是否需要引入多用户再落实「指定审批人」。

---

## 变更日志

- 2026-09-14 首版：梳理 admin / ai-agent 两条发布流水线（拉代码 → 构建 → 审批 → 发布），含节点清单、发布参数默认值、历史数据清理范围与待确认项；同步落库。
- 2026-09-14 改为**先只做本地**：远程两条停用（ssh 远程发布暂缓），新建 `tpl-local-admin` / `tpl-local-ai-agent` 两条本地流水线（只配 build，其余用平台内置 + 平台托管脚本）。
- 2026-09-14 平台脚本收归 console（A 项）；审批人接入权限体系并抽出 `UserSelect` 人员选择器（C 项）。

---

## 8. 后续三项（待确认后开工）

| # | 诉求 | 落点 | 阶段 |
|---|---|---|---|
| A | `restart-backend.sh` / `verify-backend.sh` 收归 console | ✅ 已做：实现副本放进 `servers/deploy-console/src/pipeline/scripts/`，step 脚本改调 `$WS_PLATFORM_SCRIPTS_DIR/*.sh`；工程侧两份保留但标 DEPRECATED（仅 `bootstrap.sh` 与人工运维用） | 2026-09-14 |
| B | 全局参数有专门查看入口；自定义参数在流水线里体现 | 配置中心页 + 流水线详情「参数」面板（模板级变量 `scope=template`） | P2 |
| C | 初始化「审批人」权限 | ✅ 已做（方案 B1）：权限码 `deploy:pipeline:approve` + 模板级审批人白名单 + `UserSelect` 选择器，见 `approval-permission-design.md` | 2026-09-14 |

**C 的两种落点（需要你选）**

1. **轻量**：deploy-console 内建「审批人清单」配置（系统设置里一个多行/多选值），审批时校验操作人在清单内；先初始化 `admin`。
2. **接权限体系**：在 `packages/types` 增加权限码（如 `deploy:pipeline:approve`），走 user-service 权限同步，控制台按权限码过滤可审批人 —— 与 admin 系统用户打通，但改动跨 3 个仓库包。
- 2026-09-15 **首次真实发布踩坑（已修）**：local 投递脚本 `DST="${PUBLISH_PATH:?…}"`，PUBLISH_PATH 以 `~` 开头而双引号里 `~` 不展开 → 产物落进字面量目录 `apps/admin/~/…`，脚本却报「已就位」。页面 404。修复：脚本补 `DST="${DST/#\~/$HOME}"`（DB 内 3 条 local 流水线已更新；dev/prod 远程路径是绝对路径不受影响）。教训：**投递类脚本凡涉及用户路径变量，必须显式展开 `~`；日志打印的路径要校验存在性再报成功**。
