# prod Redis 配置覆盖与认证无界等待根治方案

| 项 | 内容 |
|---|---|
| 日期 | 2026-11-11 |
| 分支 | `fix/prod-redis-auth-root-20261111` |
| 基线 | `075470a1e02237405fbd8b4f347b25c1abbeb178`（复用 worktree 时与 `origin/master` 一致；不随并行引用推进自动改基） |
| 类型 | 生产缺陷根治；配置、auth、gateway 协同修复 |
| 当前状态 | **用户已确认根治，定向 TDD 与共享面抽样回归已授权；发布与重启仍待确认** |
| 关联测试方案 | [2026-11-11-prod-redis-auth-root-fix-test.md](./2026-11-11-prod-redis-auth-root-fix-test.md) |

> 用户已在方案产出后明确「确认根治」，并拍板共享面采用抽样回归；不接受仅以放宽超时或故障放行掩盖根因。本文是方案与实施凭证，不代表已获发布、重启或全量测试授权。

## 1. 背景与根因

### 1.1 故障链

prod auth 的 PM2 进程环境中存在 Redis **回环地址类别**的配置，覆盖了服务 `servers/auth-service/.env` 中的 **内网地址类别**配置；prod 本机没有 Redis，因此黑名单读写无法正确工作。该缺陷又被两层无界等待放大：

1. auth 黑名单查询缺少完整的连接、命令和离线队列约束，Redis 故障时请求可能长时间等待。
2. gateway 内部 `fetch` 调 auth 查询 token 状态时没有超时，持续占用请求。
3. portal 最终在 10s 取消，只终止客户端等待，不能修复服务端资源占用，也把真实依赖故障表现为笼统超时。

dev 本机存在 Redis，会掩盖同一配置覆盖和无界等待缺陷，因此 dev 正常不能证明 prod 安全。

### 1.2 根因归类

| 层次 | 根因 | 修复原则 |
|---|---|---|
| 配置 | 进程环境覆盖服务 `.env`，运行真源不唯一 | 删除 PM2 顶层 Redis 配置注入，服务 `.env` 成为 auth 运行时唯一真源 |
| auth | Redis 连接/命令/离线等待无界或约束不足 | 有界失败；配置错误启动时 fail-fast |
| 安全语义 | 黑名单依赖故障可能被当成普通无效 token，或故障时放行 | 内部分析失败返回 503，不伪装成 401，不 fail-open |
| gateway | 内部请求无超时，异常响应缺少统一映射 | 3s 主动中止；认证状态不可判定时 fail-closed 为 503 |

## 2. 目标与非目标

### 2.1 目标

- auth Redis 配置只有一个运行时真源，不再被 PM2 回环类别变量覆盖。
- Redis 连接、命令和重试均有明确上限；依赖故障不得形成无界等待。
- 受保护请求在认证状态无法确认时返回可重试的 503，而非错误放行或误报 401。
- gateway 内部认证请求 3s 超时，端到端故障响应目标不超过 4s。
- 保持正常 token、已吊销 token、白名单、无 token 及缓存的既有业务语义。
- 用定向测试、构建和静态检查证明修复；共享面额外回归范围由用户拍板。

### 2.2 非目标

- 不改 portal；保留其 10s 取消行为，不以前端超时替代服务端修复。
- 不改 `packages/*`、其他微服务或无关业务逻辑。
- 不改配置中心、deploy-console 或真实 `.env` 文件，不在文档和日志中输出配置值。
- 不新增/修改数据库表，不执行 DDL、migration 或数据修复。
- 不扩大为 Redis 高可用架构改造，不新增哨兵、集群或新的缓存层。
- 本文不授权提交、push、发布、SSH、重启或生产配置操作。

## 3. 方案设计九子项

### 3.1 架构与数据流

```text
servers/auth-service/.env（auth Redis 唯一运行时真源）
                │
                ▼
auth redis-options：解析并校验，设置有界连接/命令/重试参数
                │
                ▼
auth token-status：黑名单 exists
  ├─ 未吊销       → 200 { valid: true }
  ├─ 已吊销       → 200 { valid: false }
  └─ Redis 故障   → 503（不 fail-open，不伪装成无效 token）
                │
                ▼
gateway TokenBlacklistGuard：内部 fetch + 3s AbortSignal.timeout
  ├─ 200 true     → 放行
  ├─ 200 false    → 401
  └─ 其他失败     → 503「认证状态暂不可用，请稍后重试」
```

白名单路径和无 token 请求仍由 Guard 直接放行，后续是否要求认证由下游服务既有逻辑决定。

### 3.2 页面清单（含菜单）

无。不修改 portal、页面、菜单或交互；前端无需配合发版。

### 3.3 接口清单

不新增路由，不改变请求结构。仅明确既有内部 token 状态接口及 auth 周边方法的错误语义：

| 接口/方法 | 正常语义 | 依赖故障语义 |
|---|---|---|
| auth `getTokenStatus` / 内部 token-status | 有效返回 200 `valid:true`；已吊销返回 200 `valid:false` | Redis 黑名单 `exists` 失败返回 503 |
| auth `verifyToken` | 按既有签名、过期及吊销规则判断 | 不把 Redis/内部异常透出为 401；内部故障保持 503 类别 |
| auth `refreshToken` | 按既有刷新规则处理 | 不把黑名单依赖故障误报为凭据无效；内部故障保持 503 类别 |
| gateway 黑名单 Guard | 200 `true` 放行，200 `false` 返回 401 | 非 2xx、超时、网络错误、畸形响应或缺 `valid` 均返回 503 |

正常的签名错误、过期、已吊销等认证失败仍可按既有契约返回 401；本方案只禁止把内部依赖故障降格成 401。

### 3.4 数据结构

- 无 DB/DDL，无实体或 migration 改动。
- 内部 token 状态成功响应继续是包含布尔值 `valid` 的 JSON。
- gateway 只缓存明确成功的 `valid:true` 与 `valid:false`；任何异常、非 2xx、超时、网络错误、畸形 JSON、缺失或非布尔 `valid` 均不得写入缓存。
- 有效结果缓存 5s，无效结果缓存 300s，TTL 不变。

### 3.5 配置清单

| 配置/代码项 | 方案 | 约束 |
|---|---|---|
| `ecosystem.config.js` 顶层 Redis 变量 | 删除 | 不再向 auth PM2 进程注入回环类别覆盖值 |
| `baseDbConfig.REDIS_URL` | 删除 | 避免经公共配置间接恢复覆盖 |
| `servers/auth-service/.env` | 作为 auth Redis 运行时唯一真源 | 本任务不编辑真实 `.env`，不记录其值 |
| `redis-options.ts` | 统一解析、校验和生成 ioredis 参数 | 配置缺失/非法时启动 fail-fast，错误信息不含 URL、口令或值 |
| `connectTimeout` | 1000ms | 限制建连等待 |
| `commandTimeout` | 800ms | 限制单条命令等待 |
| `maxRetriesPerRequest` | 1 | 限制请求级重试 |
| `enableOfflineQueue` | `false` | 未连接时立即失败，不排队等待恢复 |
| `retryStrategy` | 退避上限 1000ms | 只约束后台重连，不恢复请求离线排队 |
| gateway 内部认证超时 | `AbortSignal.timeout(API_TIMEOUT.UPSTREAM.INTERNAL)`，当前为 3000ms | 复用既有常量，不在 `packages/*` 新增或修改常量 |

`servers/auth-service/src/app.module.ts` 仅在确保上述解析器成为唯一入口、消除默认回环 fallback 确有必要时修改，不扩展其他模块配置。

### 3.6 依赖系统或接口

| 依赖 | 强度 | 故障行为 | 本方案边界 |
|---|---|---|---|
| auth 运行时 Redis | 黑名单强依赖 | auth 有界失败并返回 503 | 不用本机 Redis 兜底，不故障放行 |
| gateway → auth 内部 token-status | 受保护请求强依赖 | 3s 中止并返回 503 | 故障结果不缓存 |
| PM2/ecosystem | 进程配置来源 | 不得覆盖服务 `.env` | 仅改仓库内 ecosystem 模板 |
| portal | 弱依赖/调用方 | 保持 10s 取消 | 不修改、不依赖它完成修复 |

### 3.7 初始化数据 / 种子数据

无。不初始化 Redis 数据，不迁移黑名单，不写数据库，不执行种子脚本。

### 3.8 权限模型与安全语义

- 对携带 token 且需要黑名单判定的请求采用 **fail-closed**：认证状态无法确认时返回 503，而不是放行。
- 已吊销是确定的业务结论：auth 返回 200 `valid:false`，gateway 转换为 401；不能与 Redis 故障混同。
- 503 统一文案为「认证状态暂不可用，请稍后重试」，不向客户端泄露 Redis 地址、异常堆栈或内部配置。
- 白名单和无 token 直接放行仅表示跳过黑名单 Guard，不等于授予受保护资源权限；下游既有鉴权不变。
- 不缓存故障，避免短暂故障被放大为持续 401/503；恢复后下一次请求应重新回源。
- 配置缺失/非法在启动时失败，禁止输出配置值或静默回退到回环地址。

### 3.9 兼容与回退

- 正常有效/无效 token、白名单、无 token 和缓存 TTL 的既有行为保持兼容。
- 行为变化仅限故障路径：由无界等待或错误放行变为有界 503，由内部故障误报 401 变为真实 503。
- gateway 可先兼容旧 auth：旧 auth 正常响应仍按原规则处理，旧 auth 故障则由新 gateway 截断并映射 503。
- 回退采用代码版本回退，无数据兼容或 migration 反向操作；不得通过恢复错误的回环覆盖来“回滚”。

## 4. 计划文件面

| 文件 | 计划改动 | 说明 |
|---|---|---|
| `ecosystem.config.js` | 修改 | 删除顶层 Redis 变量与 `baseDbConfig.REDIS_URL` |
| `ecosystem.config.spec.js` | 新增/修改 | 配置单源与覆盖回归测试 |
| `servers/auth-service/src/app.module.ts` | 必要时修改 | 仅用于接入唯一 Redis 配置解析入口、移除回环 fallback |
| `servers/auth-service/src/config/redis-options.ts` | 修改 | 参数有界化、配置 fail-fast、不泄露值 |
| `servers/auth-service/src/config/redis-options.spec.ts` | 修改 | 配置解析、边界和变异回归 |
| `servers/auth-service/src/auth/auth.service.ts` | 修改 | 黑名单异常 503 与周边方法错误语义 |
| `servers/auth-service/src/auth/auth.service.spec.ts` | 修改 | 正常、吊销、故障及周边方法测试 |
| `servers/gateway/src/auth/token-blacklist.guard.ts` | 修改 | 3s 超时、严格响应映射、故障不缓存 |
| `servers/gateway/src/auth/token-blacklist.guard.spec.ts` | 修改 | 超时、异常、缓存和白名单测试 |
| `docs/development/reports/2026-11-11-prod-redis-auth-root-fix*.md` | 新增 | 本方案与测试矩阵 |

明确排除：portal、`packages/*`、其他服务、配置中心、deploy-console、真实 `.env`、数据库与 migrations。

## 5. 发布顺序（另行确认后执行）

1. **确认门**：本方案、定向 TDD 和共享面抽样回归均已获用户确认；发布与重启必须另行明确确认。
2. **prod 配置止血**：默认建议先通过经确认的运维/发布流程消除 auth PM2 回环类别覆盖，使 auth 使用服务 `.env` 的内网类别配置；本任务不直接修改真实 `.env`、配置中心或 deploy-console。
3. **先发布 gateway**：先获得 3s 有界超时和统一 503 映射，避免后续 auth 切换期间再次出现无界等待。
4. **再发布 auth + ecosystem**：同一发布窗口实施有界 Redis、fail-closed 和配置单源，按经确认的流程重启相关进程。
5. **按 V1–V9 验收**：先配置与定向健康检查，再做真实业务链路；任何发布、重启和验证命令均以当时用户授权为边界。

## 6. 回滚

- 回滚顺序原则上与发布相反：先回退 auth + ecosystem 到上一已知版本，再按需回退 gateway；每步后检查认证与核心链路。
- 若仅 gateway 新版本异常，可单独回退 gateway；若仅 auth/ecosystem 异常，新 gateway 可继续提供超时保护。
- 配置止血如需撤销，只能恢复为上一份已知正确的内网类别配置，**禁止恢复回环覆盖**。
- 无 DB/DDL、无种子数据，因此无数据库回滚步骤。
- 回滚不得重新引入 fail-open；若必须临时降级，需用户另行拍板并记录风险与有效期限。

## 7. 风险与待确认

| 风险/事项 | 影响 | 控制措施 |
|---|---|---|
| Redis 故障期间受保护请求由放行变 503 | 可用性行为改变，但避免未认证访问 | 属已拍板的安全语义；监控 503 与恢复情况 |
| 全局 Guard 属共享面 | 非目标路由可能受异常映射影响 | 用户已拍板抽样：C-01、C-02、C-04 及指定正反向用例 |
| auth Redis 参数属共享面 | 登录、刷新、退出等周边可能受影响 | 本地执行授权抽样；真实链路留待 dev/prod 发布阶段 |
| 配置缺失/非法 fail-fast | 错误环境会启动失败 | 发布前校验“存在且合法”，只记录字段状态，不输出值 |
| 3s 超时与客户端 10s 取消并存 | 慢依赖会更快得到 503 | V3 验证端到端不超过 4s，保留 portal 不变 |
| dev 本机 Redis 掩盖问题 | 本地绿不等于 prod 配置正确 | 配置单源测试 + prod 实证缺一不可 |
| dev/prod 实测尚未执行 | 本地单测不能证明真实环境已恢复 | 发布阶段按 V1–V9 实测，不在本机伪造 prod 结论 |
| 发布与重启待确认 | 不能恢复线上 | 单独取得明确授权，不在本任务执行 |

## 8. V1–V9 验收标准

以下均为待执行判据；当前文档不代表任何一项已通过。

| 编号 | 验收项 | 通过判据与证据 |
|---|---|---|
| V1 | 配置单源 | ecosystem 不再含顶层 Redis 注入及 `baseDbConfig.REDIS_URL`；定向配置测试通过；运行检查只证明来源类别和字段状态，不泄露值 |
| V2 | 正常有效 token | auth 返回 200 `valid:true`，gateway 放行；有效缓存 5s 不变，有测试/请求证据 |
| V3 | Redis 故障有界失败 | 黑名单 `exists` 失败时 auth 返回 503；gateway 对超时/依赖故障返回 503，端到端耗时 ≤4s，无持续 pending |
| V4 | 吊销语义 | 已吊销 token 由 auth 返回 200 `valid:false`，gateway 返回 401，不误判为 503 |
| V5 | 无/无效 token | 无 token 请求跳过 Guard 且下游鉴权不变；确定无效的 token 按既有 401 语义处理，不与依赖故障混淆 |
| V6 | 白名单 | 登录、刷新等既有白名单路径即使携带旧 token 也跳过黑名单 Guard，可到达下游，不发生登录死锁 |
| V7 | 异常映射与不缓存 | 非 2xx、超时、网络错误、畸形 JSON、缺失/非布尔 `valid` 均为统一 503；故障后恢复的下一次请求重新回源并按新结果处理 |
| V8 | 真实业务链路 | 经授权在目标环境验证真实 `conversations`、`verify`、`nce` 链路：正常请求成功，依赖故障时有界 503，无 portal 修改 |
| V9 | 周边认证流程 | refresh、logout 及既有白名单/缓存周边流程无回归；logout 后 token 按缓存语义失效，refresh 的依赖故障不伪装成 401 |

## 9. 追溯与实施门槛

| 根因/目标 | 设计 | 计划实现 | 验收 |
|---|---|---|---|
| PM2 覆盖 `.env` | §3.1、§3.5 | ecosystem + auth 配置入口 | V1 |
| Redis 无界等待 | §3.5 | redis-options | V3 |
| 内部故障误报/故障放行 | §3.3、§3.8 | auth.service + gateway Guard | V3、V4、V7、V9 |
| gateway 无超时 | §3.1、§3.5 | token-blacklist.guard | V3、V7 |
| 共享面回归 | §3.8、§7 | 指定 specs + 用户拍板的抽样/全量 | V2、V5、V6、V8、V9 |

**实施边界**：按已确认方案完成本地编码，并提供红绿、变异、定向测试、抽样回归和 build/lint 证据；dev/prod 实测、发布与重启留到发布阶段另行授权。
