# 配置驱动部署（目录 / 入口 / 静态资源可配）

> 分支：`feat/deploy-console-domain-split` ｜ 建立：2026-09-20 ｜ 状态：设计中
> 前置阅读：`specs/deploy-console-domain-split/design.md`、`HANDOFF.md`
> 范围：**仅本地（local）验证**，不涉及 dev / prod。

---

## 1. 背景与目标

用户 2026-09-20 定稿的方向：

> release 目录**不需要提前构建**；产物落到哪个目录、网关如何加载前端资源、pm2 管理后台入口文件，
> 全部由**流水线脚本**决定，而这些又都能通过「发布流水线 + 系统基础配置 + API 网关/服务管理」设置。

即：**目录、加载方式、进程入口都是配置项，不是硬编码约定**。

### 1.1 一句话目标

让「发布目录 / 产物布局 / 前端资源加载 / 后端进程入口」从**代码约定**变成**配置数据**，
实现"换机器、换布局、换入口"只改配置，不改代码与模板。

---

## 2. 现状问题（实证）

### 2.1 配置中心只接了一根线（P0 阻塞）

```ts
// pipeline.service.ts:268
const port = cfg.PORT || (i.pm2Port != null ? String(i.pm2Port) : '');
```

`cfg`（配置中心 global→env→module 的解析结果）**整包只用了 `PORT`**。
后果：在配置中心里配的任何键（部署路径、静态根、入口文件）**流水线脚本一个都读不到**，
于是这些值只能写死在模板级变量（如 `PUBLISH_PATH`），而模板变量**不区分环境** ——
这正是「local 发布复用 dev 的远程 scp 脚本」的根因。

### 2.2 部署位置字段没落库（P1 阻塞）

`resolveStageVars` 已支持 `deployRoot` / `defaultArtifactPath` 入参并注入
`DEPLOY_ROOT` / `DEPLOY_TARGET`（M2 设计），但：

- `deploy_apps` 实体**没有**这两个字段（只有 `repoDir` / `entry` / `publicPath`）
- `deploy_services` 同样没有

→ `mod.deployRoot` 恒为 undefined → `DEPLOY_TARGET` 恒为空串 → 脚本只能回退旧变量。

### 2.3 网关静态根硬编码（P2 阻塞）

```ts
// gateway/src/static/static.module.ts:34
rootPath: join(__dirname, '..', '..', 'public'),
```

`PUBLIC_ROOT` 亦按此推导，manifest 与 index.html 读取都基于它。

### 2.4 pm2 入口硬编码（P3 阻塞）

pm2 名可由 `deploy_services.pm2Name` 配置（`PM2_NAME` 已注入），
但**入口脚本**（`dist/main.js`）与 cwd 由启动方式写死，服务管理里不可配。

---

## 3. 设计

### 3.1 四层配置模型（覆盖优先级从低到高）

| 层 | 来源 | 管理入口 | 示例 |
|---|---|---|---|
| ① 平台内置 | 代码按发布上下文推导 | 只读 | `BUILD_OUTPUT_DIR` `ARTIFACT_DIR` `DEPLOY_TARGET` `ENTRY_FILE` `PM2_NAME` |
| ② 系统基础配置 | 配置中心 `global → env → module` | 控制台「配置中心」 | `DEPLOY_ROOT` `ARTIFACT_SUBPATH` `PM2_SCRIPT` `STATIC_PUBLIC_ROOT` |
| ③ 流水线变量 | 模板级（**不区分环境**） | 流水线编辑页 | 存量 `PUBLISH_HOST` `PUBLISH_PATH` |
| ④ 节点内联 | 节点 `actions[].env` / 命令内 | 节点编辑器 | 局部覆盖 |

**本次要让第 ② 层真正生效**（目前只有 `PORT` 生效）。

### 3.2 保护键（不可被配置/变量覆盖）

平台语义真相源，被覆盖会导致"发到哪、发的是哪个版本"失真：

```
DEPLOY_ENV  MODULE_KEY  MODULE_TYPE  MODULE_DIR  COMMIT_ID  BRANCH  STAGE  RELEASE_DIR
```

其余键均允许被 ②③④ 覆盖（包括 `DEPLOY_ROOT` / `DEPLOY_TARGET` / `ENTRY_FILE` / `PM2_NAME`）。

### 3.3 配置项清单

| 配置键 | 作用域 | 作用 | 缺省（未配时） |
|---|---|---|---|
| `DEPLOY_ROOT` | 模块 | 部署根（相对工作区） | 空 → 工作区根 |
| `ARTIFACT_SUBPATH` | 模块 | 产物子路径（相对部署根） | 后端 `dist`；前端 `servers/gateway/public/static/modules/<publicPath>` |
| `ENTRY_FILE` | 模块（前端） | 入口文件名 | `index.js` |
| `PM2_NAME` | 服务 | pm2 进程名 | `web-<key>` |
| `PM2_SCRIPT` | 服务 | pm2 入口脚本 | `dist/main.js` |
| `PM2_CWD` | 服务 | pm2 工作目录 | `<DEPLOY_ROOT>` 或工作区 `servers/<dir>` |
| `STATIC_PUBLIC_ROOT` | 全局（gateway） | 网关静态资源根 | `servers/gateway/public` |

> 前端产物 URL 仍由 gateway 按 `/static/modules/<key>/...` 拼接，**路径形状不变**，
> 变的只是"根"落在本机哪个目录 —— 保证 shell / nginx 零改动。

### 3.4 数据流

```
配置中心(config_items) ──┐
模块字段(deploy_apps/services) ──┼─→ resolveStageVars ─→ 脚本变量 ─→ 流水线脚本执行
平台内置推导 ────────────┘
                                     ↓
                       产物落 <DEPLOY_ROOT>/<ARTIFACT_SUBPATH>/<版本>
                                     ↓
              gateway 从 <STATIC_PUBLIC_ROOT> 加载 /static/modules/<key>/...
                                     ↓
                    pm2 以 <PM2_SCRIPT> @ <PM2_CWD> 启动 <PM2_NAME>
```

---

## 4. 数据模型变更

| 表 | 新增列 | 类型 | 说明 |
|---|---|---|---|
| `deploy_apps` | `deploy_root` | varchar(255) null | 部署根（相对工作区） |
| `deploy_apps` | `default_artifact_path` | varchar(255) null | 产物子路径 |
| `deploy_services` | `deploy_root` | varchar(255) null | 同上 |
| `deploy_services` | `default_artifact_path` | varchar(255) null | 同上 |
| `deploy_services` | `pm2_script` | varchar(255) null | pm2 入口脚本 |

> ⚠️ `synchronize: true`：加实体字段即自动加列，**不需要手写迁移**；
> 但删实体与删列必须同批（既有铁律，见 HANDOFF §B）。

---

## 5. 分阶段任务

| 阶段 | 内容 | 回退方式 |
|---|---|---|
| **P0** | 配置中心全量注入脚本变量（保护键除外） | 关掉注入开关 `PIPELINE_CONFIG_INJECT` 即回旧行为 |
| **P1** | 实体加 `deployRoot` / `defaultArtifactPath`；`DEPLOY_TARGET` 真正可用 | 字段留空 = 回退旧变量（双轨） |
| **P2** | gateway 静态根可配 `STATIC_PUBLIC_ROOT` | 不配 = 现有 `public` 路径 |
| **P3** | `PM2_SCRIPT` / `PM2_CWD` 可配并注入 | 不配 = `dist/main.js` + 现有 cwd |

每阶段独立提交、独立可回退；**全部只在 local 验证**。

---

## 6. 验证方式（本地）

1. 单测：`servers/deploy-console` 全量 jest + `servers/gateway` 动态路由单测
2. 配置生效验证：配置中心写一条 `env=local` 的自定义键 → 流水线日志能看到该变量被注入
3. 端到端：console 本地线发布 `admin@local` → 产物落盘 → `curl /__manifest__?site=local` → 页面刷新可见
4. 进程：`PM2_SCRIPT` 配错时应 fail-fast 并给出明确日志（不静默）

---

## 7. 待确认项

| # | 问题 | 当前处理（待用户复核） |
|---|---|---|
| Q1 | release 目录是否最终移除 `.git`、只留 dist | 本设计**不删**，先把能力配置化；目录瘦身放到后续专项 |
| Q2 | 构建临时目录是否独立（`BUILD_WORKSPACE`） | 本期**不引入**：`RELEASE_DIR` 语义不变，只把"产物/入口/静态根"外提为配置 |
| Q3 | 存量模板脚本里写死的 `PUBLISH_PATH` 是否批量改 | 本期**不改**存量模板，新能力靠配置覆盖；存量脚本行为不变（双轨零破坏） |
