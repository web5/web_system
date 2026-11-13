# 流水线「重启服务不改版本」能力 + auth-service 微信密钥配置中心化 · 设计

| 项 | 内容 |
|---|---|
| 日期 | 2026-11-12 |
| 产出角色 | 产品设计师（方案），**本文不授权任何发布/重启/改库/改配置动作** |
| 对象 | worktree `~/workspace/web_system-redis-auth-fix`（master `77aa53d4` 合并后） |
| 依据 | 排障证据 `30-任务产物/2026-11-11-PC端prod课程对话接口挂起排障/` 24（§9.5–9.8）/25/26 号文；源码只读核查（backend-runtime.ts / deploy.service.ts / mcp.controller.ts / mcp.service.ts / restart-clean.sh / fetch-config.sh / config.service.ts）；dev 库 `web_system_deploy.config_items` 只读查询 |
| 用户已拍板方向 | ① MINI_PROGRAM_SECRET / OFFICIAL_ACCOUNT_SECRET「从库里面取」，两版值都保留，未来打通 PC 扫码登录；② 先补流水线能力，再用流水线完成 prod auth-service 干净重启 |
| 脱敏 | 全文只出现键名、值类别、路径、计数；🔴 不含任何密钥/连接串/配置值 |

---

## 0. 需求三件齐

- **【需求】** 发布流水线没有「重启服务到当前版本、不改版本不改配置」的干净重启能力，导致 prod auth-service 进程环境残留回环 Redis 无法经流水线清除（fail-closed 503 持续）；同时 auth 的两个微信 SECRET 散落在 pm2 env / 根 .env.production / 服务 .env 三处且有两版值，需纳入配置中心单一真源。
- **【目标用户】** 发布运维（rd-releaser / 橙子哥哥）在「进程环境污染、配置已修但进程不生效、pm2 env 残留」场景下的受控恢复；未来所有后端服务的配置卫生维护。
- **【成功判据】** ① 经 MCP/控制台通道可对指定 env+service 发起干净重启，进程 env 仅白名单键，版本指针与 dist 不变，机器可验证；② 两个微信 SECRET 经 config_items → dispatch → `.env.generated` 成为唯一生效源，10-11 版值留存备用；③ prod auth-service 经该能力重启后 `/auth/verify` 无效 token 返回 401（非 503）。

---

## 1. 只读核查结论（设计的事实底座）

### 1.1 密钥配置中心现状（dev 库 `web_system_deploy.config_items`，2026-11-12 只读）

| 键 | 条目 | 结论 |
|---|---|---|
| `MINI_PROGRAM_SECRET` | **无**（global / env / module 任意作用域、dev / prod 均无） | ❌ 不在配置中心 |
| `OFFICIAL_ACCOUNT_SECRET` | **无**（同上） | ❌ 不在配置中心 |
| `JWT_SECRET`（对照） | module × {dev,prod} × {gateway,auth-service,todo-service}，enabled=1 | ✅ 已在（与 prod `.env.generated` 只含 JWT_SECRET+REPO_URL 互证） |

**是否会被 dispatch 渲染进 auth 的 `.env.generated`：不会。** dispatch 链（`config.service.ts` 渲染 deliverable 条目 → `/api/config/internal/dispatch/:moduleKey?envId=` → `fetch-config.sh` / `dispatchRemoteGeneratedEnv` 落盘 `.env.generated`）只渲染库中存在的条目；两键无条目即不在下发内容中。

**「从库取」缺口**：需新增 2 条 `scope=module, env_id=prod, module_key=auth-service` 条目（`is_secret=1, layer=app, deliverable=1, apply_mode=restart, enabled=1`）。值 capture 来源（只说路径）：prod `/data/web_system/.env.production` 根文件中的同名键——该值与 pm2 进程 env 现行生效值一致（26 号文 §2.2 四源对照：C=D=现行，微信登录现在能用）。

**「两版都保留」存放设计**（与应用读取链天然对齐）：

| 版本 | 存放 | 生效性 |
|---|---|---|
| 现行生效值（根/pm2 版） | config_items（module/prod/auth-service）→ dispatch 渲染 → `servers/auth-service/.env.generated` | **生效源**：`app.module.ts:19-24` envFilePath 中 `.env.generated` 排在 `.env` 前，先出现者优先 |
| 10-11 版（服务 .env 那版） | 留在 `servers/auth-service/.env` **不动** + 26 号文已登记 + config_items description 注明另一版位置 | 被 `.env.generated` 遮蔽，不生效但保留，供未来 PC 扫码登录打通时评估启用（届时走配置中心改值 + config_revisions 审计） |

> 唯一约束说明：config_items 唯一键是 `(scope, env_id, module_key, key)`，同键同作用域只能存一行 → 「两版」无法都进库，「现行版入库 + 10-11 版留 .env + 文档登记」是唯一自洽解，也与用户拍板一致。
> 附带建议（待拍板，默认做）：把 `MINI_PROGRAM_APP_ID` / `OFFICIAL_ACCOUNT_APP_ID` / `WECHAT_OAUTH_REDIRECT_URI` 三键一并入库（四源一致无分歧），微信键组完整收敛；`REDIS_URL` 属 `RESERVED_LOCAL_KEYS`（`REDIS_*` 前缀永不下发），**不进**配置中心，继续由服务 `.env`（内网类别）提供。

### 1.2 重启能力缺口（源码实证，与 24 号文 §9.7 一致并补全）

| 现有入口 | 行为 | 能否干净重启 |
|---|---|---|
| MCP 12 业务工具 + get_job_status/cancel_job/mock_job | 无 restart 类工具 | ❌ 不存在 |
| `rollback` | 服务端硬校验「目标=当前 → 400」 | ❌ |
| `publish_version` / apply-runtime → `activate`（backend-runtime.ts:498-501） | dist 软链已指目标 → `unchanged:true`，只探活**不重启** | ❌ |
| console monitor `restartPm2`（monitor.service.ts:565-575） | in-place `pm2 restart`，env merge 不刷新 | ❌（且是 UI 通道，agent 不可用） |
| activate 内嵌 `cleanRestart()`（backend-runtime.ts:425-496） | env = PATH/HOME/PORT + **引导键继承**（`.bootstrap/ecosystem.generated.json` → 回落 `require(ecosystem.config.js)`） | ⚠️ prod 旧 ecosystem 会把回环 REDIS_URL 回注（§9.7-② 实证），不满足「env 干净」 |
| `restart-clean.sh`（master 版，工具目录唯一实现） | `env -i` 白名单 + 探活 + 残留自检，**无远程流水线入口**；本地路径经 `deploy.service.restartClean()` 使用 | ✅ 语义正确，缺远程入口 |
| `restart-backend.sh` | 双 DEPRECATED 头（缺探活/缺回滚/cwd 硬伤） | ❌ 排除 |
| `restart-clean.sh` prod 盘 11-01 旧版 | 沿用进程现有 cwd（固化错误身份），死资产 | ❌ 排除 |

---

## 2. 方案选项（接口形态）

| | 方案 A · 独立 restart 动作（**推荐**） | 方案 B · activate 加 force-restart | 方案 C · SSH 直推 restart-clean.sh 工具正文 | 方案 D · monitor API 加 clean 模式 |
|---|---|---|---|---|
| 语义 | 「重启当前指针版本」单一语义 | activate 契约变双义（部署 vs 重启） | 与 activate 体系并存两套远程重启 | UI 通道，不满足 agent/流水线诉求 |
| env 干净 | ✅ 新 action 构造即 PATH/HOME/PORT，**不读 ecosystem / .bootstrap / dump.pm2 / pm2 env** | ❌ 现状继承 ecosystem 引导键，须再加 skipBootstrap 开关（两处改动叠加热路径） | ✅（脚本本身白名单） | ❌ in-place 语义不改 |
| 发布热路径风险 | ✅ activate 行为零变化 | ❌ 改所有发布共用的 activate，回归面大 | ✅ 不动 activate | — |
| 探活/归属断言 | 复用 activate 的 waitHealthy + 单进程归属断言 | 同左 | 脚本内自带（无 dist 回滚语义适配问题） | 无 |
| 与 12+3 工具面关系 | 新增第 13 个业务工具 `restart_service`，风格一致 | 复用 publish_version 加参数，工具语义变含糊 | 需要新工具但执行体绕过能力程序框架 | 不进工具面 |
| 工作量 | 中（action + service + 端点 + 工具 + 测试） | 看似小，连带回归测试面大 | 中（SSH 编排全新写） | 小但无价值 |
| 结论 | **✅ 推荐** | 备选（若追求最小文件面） | 不推荐（双实现） | 排除（v2 可做 UI 增强） |

**脚本选型结论**（任务指定问题）：三者都不直接复用——restart-backend.sh 已废弃；prod 盘 restart-clean.sh 是死资产；master restart-clean.sh 语义正确但仅覆盖本地/bootstrap 路径（且其 ai-service cwd 修正依赖 prod 两个软链，缺失时影响 ai-service 重启——与本能力无关但换脚本前需补，见 25 号文拍板项 4）。**新能力在 `backend-runtime.ts` 内实现 `action:'restart'`**，与 activate 共用序列化下投框架与探活断言，env 构造与 restart-clean.sh 白名单语义对齐（PATH/HOME/PORT + EXTRA_ENV），不继承任何引导键。

---

## 3. 技术方案（九子项）

### 3.1 目标

给发布平台补一个**一等能力**：对指定 `env + moduleKey` 的后端服务执行「干净重启到当前指针版本」——不改版本、不改配置、不改 dist，进程环境仅白名单键，全程可审计、可验证、可 dry-run。

### 3.2 非目标

- 不做 console UI 按钮（v2 再议；monitor 现有 in-place 重启 v1 不动，仅文档标注风险）；
- 不做批量/通配重启、定时重启、配置热更新（applyMode=immediate）；
- 不改 activate 现有行为（含其引导键继承逻辑——该逻辑在 ecosystem 正式同步后仍服务正常发布路径）；
- 不动 prod 的 ecosystem 同步、dump.pm2 清理、垃圾进程、其余 5 进程（均为独立收尾项，见 §6）；
- 不处理 knowledge-service / deploy-console 在 prod 未部署问题（另开单，25 号文拍板项 1）。

### 3.3 方案（行为语义）

`backend-runtime.ts` 新增 `action:'restart'`（与 activate 同一序列化程序下投远端执行）：

1. **前置断言（任一不满足 → 报错退出，绝不碰进程）**：
   - 服务端先解析当前指针版本（registry `getCurrentVersion(env, moduleKey)`），无指针 → 拒绝；
   - 远端：storage 中该版本 runtime 存在且 `inspect` 通过；`dist` 软链已指向该版本（指针与运行目录不一致时拒绝用重启掩盖撕裂）；
   - pm2 恰好一个归属进程（pm_cwd=服务目录）且 online（复用 activate 同款断言）；端口可解析（.env/.env.generated PORT → pm2_env.PORT 兜底）；
2. **干净重建**：`pm2 delete` + `env -i PATH HOME PORT(+PM2_HOME)` `pm2 start <installed>/dist/main.js --name <原名> --cwd <服务目录>`。**不继承 pm2 env、不读 ecosystem、不读 .bootstrap、不读 dump.pm2**；
3. **探活**：复用 waitHealthy（进程 online + `GET 127.0.0.1:<port>/health` 2xx + `ss` 端口归属 pid 匹配 + pid 稳定两拍）；ECONNREFUSED/超时 = 未就绪，重试至 deadline；
4. **失败恢复**：start/探活失败 → 自动再 start 一次（同 dist，无版本可回滚）→ 仍失败则抛错保留现场，错误信息给出恢复指引（`pm2 resurrect` 或流水线切版本）；
5. **env 干净自检**：重启后 `pm2 jlist` 取该进程 pm2_env，输出**非白名单键名列表**（键名非密，可回显；值永不回显），白名单 = PATH/HOME/PORT/PM2_*/NODE_APP_INSTANCE 等平台键 + EXTRA_ENV 显式注入项；期望为空集；
6. **`pm2 save`**：固化干净 env 进 dump.pm2（掐断 resurrect 再注入通道；注意会同时写入其它进程现状，见 §8 风险 R4）；
7. 返回 `{process, pid, port, versionTag, residueKeys, durationMs}`。

服务端 `DeployService.restartService({env, moduleKey, operator, dryRun, reason})`：校验模块登记且 type=backend → 解析指针 → dryRun 时只跑只读断言并返回计划 → 否则 SSH 下投 restart action → 写审计（operator、triggerSource、versionTag、pid 前后、residue 计数）。

### 3.4 页面

无 UI 变更（v1 纯 MCP + publish.sh 通道）→ **无 Proto 要求**（非 UI 改动，R11 不适用）。

### 3.5 配置

- 新增初始化数据（见 3.7）；无新增平台配置键；
- 复用既有开关语境：本能力不接受 `RELEASE_CLEAN_RESTART=0`（那是 activate 的回落开关）；如需全局禁用 restart 能力，用工具声明/模块登记层控制，不新增 env 键。

### 3.6 依赖

无新 npm 依赖。复用：backend-runtime 序列化下投框架、sshRun、tool-catalog（不依赖其 restart-clean 正文）、registry 指针、audit。

### 3.7 初始化数据

| 数据 | 内容 | 方式 |
|---|---|---|
| config_items ×2（必需） | `(module, prod, auth-service, MINI_PROGRAM_SECRET)` 与 `(..., OFFICIAL_ACCOUNT_SECRET)`：is_secret=1, layer=app, value_type=string, apply_mode=restart, deliverable=1, enabled=1，description 注明「现行生效版 capture 自 prod 根 .env.production；另一版（10-11）留存于服务 .env，PC 扫码打通候选」 | 控制台配置中心 UI **人工录入**（值不过 AI 上下文；🔴 禁止由 agent 读取值转写） |
| config_items ×3（可选，默认建议做） | `MINI_PROGRAM_APP_ID` / `OFFICIAL_ACCOUNT_APP_ID` / `WECHAT_OAUTH_REDIRECT_URI`（同作用域，非 secret） | 同上 |
| 无 DDL / 无 seed / 无 migration | — | — |

### 3.8 权限

- MCP 端点走 `McpKeyGuard`（每用户 API Key → operator 审计归因），与现有 12+3 工具面同一鉴权；
- `env=prod` 服务端硬校验 `confirm:true`（缺 → 400，对齐 rollback / publish 现状）；`reason` prod 必填（进审计）；
- prod 审批：v1 **不挂**发布审批闸门（对齐 prod rollback 的 confirm 先例：rollback 也是高危但凭 confirm:true + 本地 --yes）；是否升级为人审闸门列为拍板项 P2；
- 控制台 `/api/pipelines` 系 JWT 通道不新增端点（v1 无 UI）。

### 3.9 接口约束

```
POST /api/mcp/restart            (McpKeyGuard)
Body:  { env: 'dev'|'prod', moduleKey: string, confirm?: boolean, dryRun?: boolean, reason?: string }
200:   { env, moduleKey, versionTag, process, pid, port, residueKeys: string[], durationMs, triggerSource: 'mcp:<keyName>' }
400:   参数缺失 / prod 无 confirm:true / 前置断言失败（无指针、dist 与指针不一致、进程归属≠1、端口未知）
404:   模块未登记或非 backend（不泄露模块是否存在之外的归属信息，对齐 ownedPipeline 语义）
```

- MCP 工具面新增第 13 个业务工具 `restart_service`（mcp.service.ts；参数 `{env, component, confirm?, dry_run?}`，命名对齐现有 `component` 习惯）；
- `publish.sh` / `remote-deploy.sh` 新增子命令：`publish.sh restart <env> <svc> [--yes] [--dry-run]`（prod 本地侧强制 `--yes`，对齐 rollback 先例）；
- 约束：restart 成功响应中 versionTag **必须等于**调用前指针（服务端自校验，不一致即报错——防止并发发布把「重启」变成「隐式切版本」）。

### 3.10 测试（六维）

TestScope: 定向=`servers/deploy-console/src/deploy/backend-runtime.spec.ts`（新增 restart 用例）+ `deploy.service.spec.ts`（restartService 断言分支）+ `mcp/mcp.controller.spec.ts`（prod confirm 400 / 非法 env / 归属审计）+ `servers/mcp-gateway` mcp 工具声明与转发 spec；抽样=`deploy/restart-clean.spec.ts`、`deploy/backend-runtime-deploy.spec.ts`、`pipeline/steps` 既有 spec 全量（确认 activate/apply 零回归）；共享面=`servers/deploy-console/src/deploy/backend-runtime.ts`（发布热路径，该文件全部 spec 必跑）+ `deploy.service.ts`（发布主链）。

| 维度 | 内容 |
|---|---|
| 单元 | V1–V3（见 §4）；restart action 序列化自包含静态回归（沿用 prelude 强制检查模式） |
| 集成 | dev 环境真实 restart（V4/V5） |
| 契约 | MCP 端点负例（V3）；工具声明 spec 同步 |
| 回归 | activate unchanged 快路径、apply-runtime、rollback 既有用例全绿 |
| 安全 | prod confirm 硬校验负例；residueKeys 输出不含值（静态审查 + 用例断言只出键名） |
| 验收 | prod auth-service 专项（V6/V7） |

---

## 4. 验证判据

| # | 判据 | 验证方式 |
|---|---|---|
| V1 | restart action 的进程 env 构造键集 = {PATH, HOME, PORT(, PM2_HOME)}（+显式 EXTRA_ENV），**不含**任何 ecosystem/.bootstrap 继承键 | 单测：mock fs（ecosystem.config.js 存在且含业务键）断言 env 不含其键 |
| V2 | 前置断言各自 fail-fast：无指针 / dist 软链不指当前版本 / 归属进程≠1 / 端口未知 → 报错且未执行 pm2 delete | 单测四分支 |
| V3 | MCP 负例：prod 缺 confirm:true → 400；env 非法 → 400；moduleKey 未登记 → 404 | mcp.controller.spec |
| V4 | dev 实测：restart dev auth-service 后 `pm2 jlist` 该进程非白名单键 = ∅；`/health` 200 | dev 执行取证 |
| V5 | dev 实测：restart 前后 currentVersions 指针同一 versionTag、dist 软链目标不变、`deploy_versions` 无新行 | dev 执行取证 |
| V6 | prod 验收（审批后）：restart prod auth-service 后进程 env 非白名单键 = ∅（REDIS_URL 残留消失）；`pm2 logs` ECONNREFUSED 停止新增 | prod 只读取证（键名+类别） |
| V7 | prod 验收：`/auth/verify` 无 token=401、**无效 token=401（非 503）**（Redis 黑名单查询恢复）；有效登录态 conversations/verify 秒级响应 | prod 真实链路 |
| V8 | 配置中心化验收：dispatch 后 prod auth `.env.generated` 键集 ⊇ {JWT_SECRET, MINI_PROGRAM_SECRET, OFFICIAL_ACCOUNT_SECRET}（计数+键名断言）；值指纹与 capture 来源一致（valueFingerprint 比对，不回显值） | prod 只读取证 |
| V9 | 回归：backend-runtime / deploy / pipeline-steps 既有 spec 全绿；一次正常 dev 发布走 activate 不受影响 | CI + dev 实发 |

---

## 5. 文件面预估

| 文件 | 改动 |
|---|---|
| `servers/deploy-console/src/deploy/backend-runtime.ts` | +`action:'restart'` 分支（断言/重建/探活/自检/save） |
| `servers/deploy-console/src/deploy/backend-runtime.spec.ts` | +V1/V2 用例 + 序列化自包含静态回归 |
| `servers/deploy-console/src/deploy/deploy.service.ts` | +`restartService()`（指针解析/dryRun/SSH 下投/审计） |
| `servers/deploy-console/src/deploy/deploy.service.spec.ts` | +分支用例 |
| `servers/deploy-console/src/mcp/mcp.controller.ts` | +`POST /mcp/restart` |
| `servers/deploy-console/src/mcp/dto/restart-service.dto.ts` | 新增 |
| `servers/deploy-console/src/mcp/mcp.controller.spec.ts` | +V3 用例 |
| `servers/mcp-gateway/src/mcp/mcp.service.ts`（+对应 spec） | +`restart_service` 工具声明与转发 |
| `~/skills/web-system-deploy/scripts/publish.sh`、`remote-deploy.sh` | +`restart` 子命令 |
| `~/skills/web-system-deploy/references/mcp-tools.md` + `SKILL.md` | 12→13 工具、restart 用法与 prod 约束 |
| `docs/architecture/`（或 specs/deploy-console/） | 能力登记一节（指向本文） |

命中共享面：**backend-runtime.ts、deploy.service.ts（发布主链）**——按门禁规范，这两个文件的全部既有 spec 必须随 MR 跑绿，且需一次 dev 真实发布回归（V9）。

## 6. 发布/实施顺序

| 序 | 步骤 | 通道 | 审批 |
|---|---|---|---|
| S0 | 本设计评审 + 拍板（P1–P5） | — | 🔴 用户 |
| S1 | 配置中心补 2（或 5）条目（UI 人工录入，值不过 AI）→ 触发 dispatch 刷新 prod auth `.env.generated`（**不重启进程**，现行进程被 pm2 env 遮蔽、行为零变化）→ V8 前半（键集/指纹） | console UI / internal dispatch | 🔴 用户（U-cfg：确认取根文件现行值） |
| S2 | deploy-console 实现 + 单测 → **手动**发 dev（deploy-console 永远手动 `scripts/release-deploy-console.sh`，它单实例管所有环境） | 手动 | 🔴 用户（U-console） |
| S3 | dev 验证：dryRun → `publish.sh restart dev auth-service` → V4/V5 | 新能力 | 可代理 |
| S4 | mcp-gateway 工具声明发 dev → prod（走流水线闸门） | 流水线 | 🔴 prod 审批（真人 UI） |
| S5 | `publish.sh restart prod auth-service --yes` → V6/V7/V8 全量验收 | 新能力 | 🔴 用户（U-restart） |
| S6 | 收尾归属：① dump.pm2 残留 → auth 随 S5 的 pm2 save 刷新，其余进程随各自干净重启刷新；② ecosystem 正式同步（C→prod）→ 独立变更（25 号文方案④，**不阻塞本线**——本能力不读 ecosystem）；③ 垃圾进程 `ecosystem.apps` → 随 ② 删；④ 其余 5 个残留 REDIS_URL 进程 → 低峰逐个用新能力重启（复用 S5 审批模式，可一次授权分批执行）；⑤ prod restart-clean.sh 换 master 版 + ai-service 两软链 → 另项 | 各自 | ②③④⑤ 各自用户拍板（25 号文已有默认建议） |

## 7. 回滚

| 层 | 回滚方式 |
|---|---|
| 能力代码（deploy-console） | 回退上一版手动部署；mcp-gateway 走 `publish.sh rollback` |
| restart 操作失败 | 能力内自动重 start + 探活；仍失败 → `pm2 resurrect`（dump 镜像）或流水线真切换（先发历史版本再发回当前版本，activate 只在切版本时重启）；注意 rollback 到同版本被 400 硬拒，**不可**作为回滚手段 |
| 配置（config_items） | 删条目 → 重新 dispatch（`.env.generated` 不再含该键 → 应用回落服务 `.env`）→ restart 生效；条目删除前审计已有 config_revisions 留痕 |
| 数据 | 无 DDL；config_items 两行删除即回滚 |

## 8. 风险

| # | 风险 | 爆炸半径 | 缓解 |
|---|---|---|---|
| R1 | 误用 restart prod 服务 | 该服务秒级中断，在途请求失败一次 | confirm:true + reason + 审计 + dryRun；不开放批量；前置断言挡「指针撕裂时误重启」 |
| R2 | pm2 delete 后 start 失败 | 该服务中断延长至人工介入 | 自动重试 + 探活；错误含恢复指引；dump.pm2 resurrect 兜底 |
| R3 | capture 错值（把 10-11 版当现行入库） | prod 微信登录故障 | capture 前指纹比对（现行 pm2 env vs 根文件一致才录）；UI 人工录入人在回路；回滚 = 删条目重 dispatch |
| R4 | restart 后 `pm2 save` 把其它进程的脏 env 固化进 dump | 其它 5 进程 resurrect 时仍带回环（不恶化现状，但也不改善） | 文档明示；S6-④ 逐个干净重启消化 |
| R5 | restart 与进行中的发布并发（重启中途被 activate 切版本） | 短暂状态竞争 | restart 前后 versionTag 一致性自校验（3.9）；发布锁复用 registry lock（owner=`restart:<moduleKey>`） |
| R6 | 能力被当成「绕过发布门禁改版本」的后门 | 语义破坏 | 构造上不可能：restart 不接受 versionTag 入参，版本恒等于当前指针且自校验 |
| R7 | auth 特殊：`.env.generated` 引入后 SECRET 生效源切换 | 微信登录行为变化（理论为零，值同源） | S1 先 dispatch 不重启验证指纹；S5 重启后 V7 真实链路验收 |

## 9. 需要用户拍板（附默认建议）

| # | 问题 | 默认建议 |
|---|---|---|
| P1 | 接口形态：独立 restart 动作 vs activate 加 force-restart | **独立 restart 动作**（方案 A） |
| P2 | prod 安全门强度：confirm:true（对齐 rollback）vs 挂人工审批闸门 | **confirm:true + reason 必填 + dryRun**；观察一段时间后再评估是否升级闸门 |
| P3 | SECRET capture 方式：UI 人工录入 vs 脚本 capture | **UI 人工录入**（值不过 AI 上下文） |
| P4 | 微信 3 个非 secret 键（APP_ID×2 + REDIRECT_URI）是否一并入库 | **一并入库**（四源一致无分歧，微信键组完整收敛） |
| P5 | monitor UI 的 in-place 重启按钮 | **v1 不动**，文档标注「env 不刷新」风险，v2 评估切换到新能力 |
