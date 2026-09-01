# 技术方案 + 技术评审：Deploy-Console 能力建设

> 类型：spec.md / design.md（Design 阶段产物，含独立子代理技术评审）
> 日期：2026-09-01
> 关联：意图 `docs/intents/2026-09-01-deploy-console-capabilities.md`；产品设计 `requirements.md`；任务 `tasks.md`

---

## 一、总体架构与现状

Deploy-Console 是发布控制台的「单一入口」：

- **前端**：Vue3 + Vite + Ant Design Vue，`apps/deploy-console/`，经 gateway `/console/` 代理，API base `/console/api`。
- **后端**：NestJS，`servers/deploy-console/`，模块含 `monitor`（SSH 远端监控）、`environment`、`server`、`module`、`pipeline`、`hook`、`audit` 等。
- **监控现状**：`monitor.service.ts` 全部走 `execSsh`（ssh2 连接远程 `pm2 jlist` / curl 探活 / 日志），**本机零感知**。
- **发布核心**：九阶段流水线（check→pull→build→upload→restart→version→pointer→verify→cleanup）+ 各阶段 Hook（shell 脚本，DB 真相源规避删除审批）+ deploy-console 自身传统发布。

**增量策略**：在现有模块上新增「本地」路径与独立能力模块，不重写发布核心。

---

## 二、批 1 落地详情（① 本地监控 + ② tab 化）

### 2.1 已改动文件（git status 确认）
- `apps/deploy-console/src/views/ServiceMonitor.vue` — 环境切换新增 `key="local"` tab
- `apps/deploy-console/src/views/ServiceManager.vue` — 改为按类型 tab 分组 + 计数
- `apps/deploy-console/src/api/index.ts` — `monitorApi` 新增 `localPm2/localHealth/localLogs`
- `servers/deploy-console/src/monitor/monitor.controller.ts` — 新增 3 个非 SSH 路由
- `servers/deploy-console/src/monitor/monitor.service.ts` — 新增 `execLocal()` + 本地 pm2/health/logs

### 2.2 ① 本地监控技术方案
- **前端**：`ServiceMonitor.vue` 的 `activeKey` 增加 `'local'`；`loadHealth/loadPm2/viewLogs` 按 `activeKey==='local'` 分支调用 `monitorApi.localXxx`，否则走原 `health/pm2/logs`。环境切换 `<a-tabs>` 含 本地/DEV/PROD 三档。
- **API**：`monitorApi.localPm2 → GET /monitor/local/pm2`、`localHealth → GET /monitor/local/health`、`localLogs → GET /monitor/local/logs`。
- **Controller**：`MonitorController` 新增 `local/pm2`、`local/health`、`local/logs` 三个 `GET`（带 `DefaultValuePipe(100)+ParseIntPipe` 行数校验）。
- **Service（关键）**：新增 `execLocal(command, timeoutMs=10000)` 封装 `execSync`（**独立于 `execSsh`，不走 SSH**）；`getLocalPm2List()` 本机执行 `pm2 jlist`；`getLocalHealth()` 对本机 pm2 暴露端口 curl 探活；`getLocalLogs()` 本机 `pm2 logs`。复用 `Pm2Process`/`HealthCheck` 接口。

### 2.3 ② tab 化技术方案
- `ServiceManager.vue` 的模块列表由「单表格 + 类型下拉」改为 `<a-tabs>`：`all` + 4 类型（`backend/frontend/micro-frontend/mini-app`）；tab 计数实时从 `moduleList` 计算；`filteredModules` 按 `activeType` 过滤；编辑弹窗保留「类型 a-select」（新建必需）；旧列表级下拉筛选已移除。

### 2.4 批 1 已知风险（详见第四节评审）
- **命令注入**（本地 `pm2 logs ${service}` 裸拼接，经本机 shell 执行）—— **必须修复**。
- CORS 越权、全局异常过滤器缺失、`any` 泛滥 —— 铁律违反，需收口。
- 本地健康依赖 `proc.pm2_env.PORT`，无 `PORT` 的服务被过滤导致本地健康表可能为空（与远程基于 env 表 `ports` 不一致）。

---

## 三、批 2 / 批 3 技术方案纲要

> 详细设计在各自批的 Plan→Design 阶段展开（符合 playbook 循环）。此处仅列关键决策，供批 2/批 3 agent 直接读取。

### 批 2（P0 可靠性 + 配置中心）
- **③④⑤ 后端重建 + 探针 + 失败回滚**：在 `verify` 阶段调用 monitor 探针（复用 `getLocalHealth`/端口探活）；backend 模块的 `restart` 阶段改为从发布目录目标版本产物重建 pm2 进程；verify 失败触发自动回滚（含 backend restart），回滚动作写审计。
- **⑥ Migration**：pipeline 增加 `migration` 阶段（或 pre-check 校验），仅 backend 模块触发；失败阻断。
- **⑦ 并发锁**：以 `moduleKey + env` 为键的发布锁（DB 或 redis），拒绝/串行化并发发布，job 幂等去重。
- **⑧ 多环境编排**：在 pipeline submit 支持 `targets: env[]`，顺序执行 + 统一回滚边界。
- **⑨ 预检**：`check` 阶段前插入 pre-check（分支存在、DB 可达、配置就绪）。
- **⑩ 配置中心**：新增 `config` 模块（controller/service/entity），`config_items` + `config_snapshots` 表；密钥 AES 加密（服务侧主密钥来自 deploy-console 启动环境变量）；注入时在 restart/build Hook 前按 全局→环境→模块 合并并**强制覆盖** pm2 env；前端「配置中心」页 + 模块详情入口；审计 diff（密钥不记明文）。

### 批 3（P1/P2 治理与可观测）
- **⑪⑫** 模块详情聚合 + 流水线可视化：前端新增/增强视图，聚合版本历史/部署记录/审计。
- **⑬⑭** 灰度增强 + 审批门禁：审批实体 + prod 发布闸门，与预检/审计串联。
- **⑯** 通知中心：事件总线 + Webhook/企业微信适配器。
- **⑰** 审计增强：全量操作审计表 + diff 视图。
- **⑮⑱** 可观测仪表盘 + 自助诊断：时间序列查询复用 `deploy_deployments`/审计表；端口冲突检测、进程重启、日志聚合。

---

## 四、技术评审结论（独立子代理评审，非主 agent 自审）

> 评审范围：批 1 的 5 个已改文件。评审方式：独立 code-explorer 子代理，对照设计意图 + `CODEBUDDY.md` 铁律，输出独立结论（满足「子 agent 隔离、不自己认可自己」）。

### 🔴 MUST 必改（铁律违反 / 安全风险）
1. **命令注入（本地执行）—— `monitor.controller.ts:80` + `monitor.service.ts:318`**
   `service` 参数裸拼接到 `pm2 logs ${service}`，经本机 `execSync` shell 执行，可注入任意命令（如 `; rm -rf`）。**本轮本地路径新引入，危害最大。**
   修复：新增 class-validator DTO（如 `LocalLogsQueryDto { @IsString() @Matches(/^[a-zA-Z0-9_-]+$/) service }`）。
2. **CORS 越权 —— `main.ts` `cors({ origin: true, credentials: true })`**
   `origin: true` 反射所有来源，且未读 `CORS_ORIGINS` 环境变量，违反铁律「禁止 `origin:'*'` 或无参 `enableCors()`」。改为读 `configService.get('CORS_ORIGINS','')` 白名单。
3. **缺失全局异常过滤器 —— `main.ts` / `app.module.ts`**
   未见 `useGlobalFilters` / `APP_FILTER`。铁律要求「每个微服务 main.ts 必须有全局异常过滤器」。需补 `AllExceptionsFilter` 并注册，否则未捕获异常直接暴露客户端。
4. **`any` 泛滥（TS 严格模式破坏）—— `monitor.service.ts:162,170,275`、`api/index.ts:178-189`、`ServiceManager.vue` 8 处**
   尤其 `rawList: any[]` 与 `proc: any`；本地/远程两份几乎相同的 pm2 解析逻辑未抽公共函数，存在漂移。定义 `RawPm2Process` 接口并复用，抽共享转换函数 `toPm2Process(raw)`。

### 🟡 SHOULD 建议改
1. **本地健康依赖 pm2 `PORT` 字段 —— `monitor.service.ts:291-293`**
   本地无 `PORT` 的服务（如 gateway、前端 dev）被过滤，本地「服务状态」表可能空。建议回退到 env 表 `ports` 映射或本地服务清单，与远程逻辑对齐。
2. **本地执行 cwd/PATH 兜底 —— `monitor.service.ts:256`**
   显式声明 `cwd` 与 `PATH`，避免发布目录运行用户下 `pm2` 找不到（部署为 `web-deploy-console` 用户时尤其）。
3. **tab 计数重复 filter —— `ServiceManager.vue:165`**
   模板内每层 4 次 `.filter` 算计数，建议 `computed` 出 `counts` 映射。
4. **本地/远程 pm2 解析重复 —— `monitor.service.ts:170-179 vs 275-284`**
   抽公共 `toPm2Process(raw)` 消除两份漂移代码。

### 🟢 KEEP 保留（做得好的点）
- 前端「本地」tab 入口真实存在且与 dev/prod 并列 ✅
- 本地执行路径独立、不复用 SSH、非 mock ✅
- 全程 `Logger` 无 `console.log` ✅
- 全局 `ValidationPipe` 已启用（远程 `logs` 裸参同理需 DTO，见 MUST#1）✅
- 目标② 按类型分 tab + 实时计数，旧下拉筛选已彻底移除 ✅
- 本地接口带 `DefaultValuePipe(100)+ParseIntPipe` 行数校验 ✅
- SSH 路径保留 `BadGatewayException` 统一异常类型 ✅

### 基线结论
**不建议当前代码直接作为批 2/批 3 基线**：目标①/② 功能骨架正确，但暴露了**本地命令注入、CORS 环境变量缺失、全局异常过滤器缺失、多处 `any` 破坏严格模式**四项铁律级问题，**须先完成 MUST 项再纳入基线**。批 1 收尾任务见 `tasks.md`。

### 批 1 收尾结果（2026-09-01，主 agent 执行）
四项 MUST 已全部修复并通过 `nest build` 编译验证（lints 0）：
1. **命令注入** → 新增 `monitor/dto/logs-query.dto.ts`（`@Matches(/^[a-zA-Z0-9_-]+$/)` 校验 `service`），`monitor.controller.ts` 的 `logs` 与 `local/logs` 改用 DTO，杜绝 `pm2 logs ${service}` 裸拼接。
2. **CORS 越权** → `main.ts` 改读 `CORS_ORIGINS` 环境变量白名单（`origin: corsOrigins.length ? corsOrigins : false`），移除 `origin: true`。
3. **全局异常过滤器缺失** → 新增 `common/filters/all-exceptions.filter.ts` 并 `useGlobalFilters` 注册；非 HttpException 在生产环境统一返回「服务器内部错误」。
4. **`any` 破坏严格模式** → `monitor.service.ts` 定义 `RawPm2Process` 接口并抽取 `toPm2Process()`，本地/远端 pm2 解析共用，消除两份漂移代码。

> 结论更新：MUST 清零，**当前代码已可作为批 2/批 3 基线**。SHOULD 项（本地健康对齐 `ports` 映射、execLocal 的 cwd/PATH 兜底、前端 tab 计数 `computed`）仍列为后续优化，不阻塞批 2 启动。
