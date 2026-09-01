---
name: web-system-deploy
description: web_system 发布管理 MCP——按「环境 + 模块 + 版本」发布微前端模块（admin / portal），支持全量发布、灰度发布、灰度转全量、按版本回滚与版本历史查询。当用户要求发布/上线/部署某个前端模块、回滚到某个版本、灰度放量、查看某环境当前版本时调用本技能。
version: 1.0.0
agent_created: true
---

# web_system 发布管理 MCP Skill

> 单 MCP Server（`/mcp/deploy`），11 个工具，覆盖「发布流水线 / 灰度 / 转全量 / 回滚 / 版本查询」。本文件是 AI 调用本 Server 的唯一行为守则：**工作流、工具介绍、错误处理**。

## 1. 工作流

### 1.1 角色与定位

你是发布助手。用户要发布、回滚、灰度某个前端模块，或查询某环境当前版本时，调用本 Server 的工具完成，**不代替用户做生产环境决策**。

| 维度 | 说明 |
|------|------|
| 协议 | MCP（streamableHttp），单 Server |
| 端点 | `/mcp/deploy`（生产 `https://kedouai.com/mcp/deploy`，本地 `http://localhost:6006/mcp/deploy`） |
| 鉴权 | Bearer Token（每用户 API Key）；调用者身份会作为 `operator` 写入审计日志 |
| 可发布模块 | `admin`（管理后台）、`portal`（门户）。以 `list_modules` 为准，不自造模块名 |
| 环境 | `local`（本机，本地开发发布专用，**不污染远程 dev**）/ `dev` / `staging` / `prod` |
| 不覆盖 | 后端服务发布、小程序发布、数据库变更、配置变更（本服务只发微前端模块） |

### 1.2 不可协商门禁（6 条）

| # | 门禁 | 核心约束 |
|---|------|---------|
| 1 | 模块真实 | 发布前用 `list_modules` 确认模块标识，**不得凭空猜测** |
| 2 | 版本真实 | 版本号必须来自 `get_current_versions` / `list_releases` 的返回值，**不得编造**；未指定版本时发布当前最新代码（不传 versionTag） |
| 3 | prod 二次确认 | 发布/回滚到 **prod 前必须向用户二次确认**并说明影响面；未确认前不得调用任何发布/回滚工具；调用时必带 `confirm=true` |
| 4 | 长任务必轮询 | `publish_pipeline` 提交后**必须**用 `get_job_status` 轮询到终态（succeeded/failed），**不得提交完就宣称"已发布"** |
| 5 | 失败不重试轰炸 | 终态 failed 时报告失败阶段（stage）与日志要点，最多重试 1 次 |
| 6 | 回滚需授权 | 不得自行决定回滚生产环境；回滚前必须告知用户并取得同意 |

### 1.3 工作流（6 步）

| 步骤 | 动作 | 关键约束 |
|----|------|---------|
| 1 | 分析意图 | 判定：发布 / 灰度 / 转全量 / 回滚 / 查版本 |
| 2 | 补齐参数 | 缺模块→`list_modules`；缺版本→不传（发最新）；缺环境→**必须询问** |
| 3 | 告知现状 | 用 `get_current_versions` 说明当前线上版本，让用户知道将要发生什么 |
| 4 | 提交流水线 | `publish_pipeline`，拿到 jobId |
| 5 | 轮询到终态 | `get_job_status` 轮询；过程中简要汇报阶段，不刷屏输出全量日志 |
| 6 | 报告结果 | 成功→版本+环境+提醒"网关版本缓存约 10s 生效"；失败→阶段+日志要点+建议 |

**流水线阶段**：`check`（校验）→ `build`（构建）→ `upload`（投递产物）→ `version`（写版本表）→ `pointer`（切指针）→ `verify`（等缓存并验证）→ `cleanup`（清理旧版本，保留最近 5 个）。

---

## 2. 工具介绍

### 2.1 工具总表

| 工具名 | 场景 | 关键入参 |
|--------|------|---------|
| `list_modules` | 可发布模块清单 | 无 |
| `get_current_versions` | 某环境各模块当前版本 | `env` |
| `list_releases` | 版本历史（回滚候选） | `env`、`component` |
| `publish_pipeline` | **提交发布流水线（长任务）** | `env`、`moduleKey`、`mode`、`versionTag`(选)、`grayscaleRule`(灰度必填)、`confirm`(prod 必填)、`waitTimeoutSec`(选) |
| `get_job_status` | 查询任务状态/进度/日志 | `jobId` |
| `cancel_job` | 取消运行中的任务 | `jobId` |
| `publish_version` | 切到指定历史版本（秒级，不重新构建） | `env`、`versionTag`、`component`(建议传)、`confirm`(prod 必填) |
| `rollback` | 脚本级回滚任务 | `env`、`versionTag`、`component` |
| `promote_release` | 灰度转全量 | `pipelineId`（灰度流水线的 jobId） |
| `publish_pipeline_cancel` | 取消指定流水线 | `jobId` |
| `mock_job` | [非生产] 模拟长任务，验证用 | `seconds` |

### 2.2 长任务用法（重要）

`publish_pipeline` 是**长任务**，一次发布约 20–60s：

- **异步模式**（默认）：不传 `waitTimeoutSec` → 立即返回 `{jobId, status:"pending"}`，随后用 `get_job_status` 轮询
- **同步模式**：传 `waitTimeoutSec`（秒）→ 阻塞等待到终态；超时则返回 jobId 并提示转异步（任务不会丢）

建议优先用异步 + 轮询，便于向用户汇报进度。

### 2.3 灰度发布

- `mode: "grayscale"` + `grayscaleRule`，三种规则：
  - `{type:"percent", value:10}` —— 10% 用户
  - `{type:"user-list", userIds:["u1","u2"]}` —— 指定用户
  - `{type:"header", key:"x-canary", values:["on"]}` —— 请求头匹配（调试用）
- 灰度**不切换全量指针**，只写灰度规则；验证通过后用 `promote_release` 转全量

### 2.4 发布参数（环境 + 模块 + 分支 + commit）

`publish_pipeline` 语义：**发布基于远程仓库的分支 + commit，在隔离的发布目录拉取代码构建**，不是当前工作区。

| 参数 | 行为 |
|------|------|
| `branch` | 目标分支（默认 master）。发布目录 `git fetch → checkout` 该分支 |
| `commitId` | 目标 commit（git 短哈希，默认该分支最新）。已有该版本产物时复用秒级发布；否则拉取该 commit 后构建 |
| 前端模块（admin/portal） | 拉取 → `vite build --mode mf` → 投递产物 → 切指针 → manifest 验证 |
| 后端模块（如 todo-service） | 拉取 → `nest build` → `pm2 restart` → 服务在线验证 |

**关键提醒**：本地改完代码必须 **commit & push 到仓库再发布**，否则发布目录拉不到新代码。

查看可发布版本用 `list_releases`（传 `env` 与 `component`），返回结果已按版本去重，含两类来源：
- `source: "db"` —— 版本表记录
- `source: "artifact"` —— 磁盘上存在但未登记版本表的历史产物

### 2.5 回滚（历史版本）

两种方式，优先用前者（秒级、不重新构建）：

1. **`publish_pipeline` + `versionTag`**：复用产物发布，语义是"把该版本重新发布到该环境"
2. **`publish_version`**：直接切指针，语义是"回退到该版本"

`publish_version` 优先按版本表记录切换。若目标版本是**历史产物未在版本表登记**（`deploy.sh` 时代写入），会报"版本不存在"——此时**必须带上 `component` 参数**重试，服务端会按磁盘产物校验后切换并补写版本记录。

---

## 3. 错误处理

| 现象 | 处理 |
|------|------|
| HTTP 401 | API Key 无效/过期/被吊销：提示用户重新配置 key |
| `版本不存在: xxx` | 补上 `component` 参数重试（走磁盘产物校验）；仍失败则该版本产物确实不存在，改用 `list_releases` 换一个版本 |
| `现网仅允许发布 master 分支版本` | 当前 Git 分支非 master，禁止发 prod；切换到 master 或改发 dev/staging |
| `Prod operations require confirm=true` | prod 操作必须先取得用户确认并传 `confirm=true` |
| `模块 xxx 在 dev 有正在运行的流水线` | 同一环境同一模块不允许并发发布；等待完成或 `cancel_job` 取消后再发 |
| 流水线 `stage=build` 失败 | 代码构建问题（非发布系统问题）：报告日志尾部，让用户修代码后重发，最多重试 1 次 |
| 流水线 `stage=verify` 失败 | 产物已投递但网关 manifest 未生效：多为网关版本缓存，稍后复查 `/__manifest__`；仍不一致则排查产物路径 |
| `get_job_status` 查不到任务 | jobId 有误或任务已过期；重新提交发布 |
| 工具调用超时 | 单次重试 1 次；仍失败则告知用户稍后重试 |

---

## 4. 约束

- 只发布微前端模块（admin / portal）；后端服务、小程序不在本服务范围
- 不编造版本号、不猜测模块标识
- 不自行回滚生产环境
- 每次发布都会写入审计日志（含操作人），发布行为可追溯
