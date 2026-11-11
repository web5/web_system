# prod Redis 配置覆盖与认证无界等待根治：测试矩阵

| 项 | 内容 |
|---|---|
| 日期 | 2026-11-11 |
| 关联方案 | [2026-11-11-prod-redis-auth-root-fix.md](./2026-11-11-prod-redis-auth-root-fix.md) |
| 分支 | `fix/prod-redis-auth-root-20261111` |
| 当前阶段 | 根治方案已确认；定向 TDD 与共享面抽样回归已授权 |
| 已拍板范围 | 定向 TDD + 指定共享面抽样；不跑全量，不在本机伪造 dev/prod 实测 |

TestScope: targeted
SharedScope: sampled (user-approved)

> `TokenBlacklistGuard` 是全局共享面，auth Redis 配置也被登录、刷新、退出等周边逻辑共享。用户已明确拍板**抽样回归**：C-01 登录/刷新/退出、C-02 internal token-status、C-04 gateway Guard，以及有效 token 的 conversations/verify/NCE、无 token/无效 token/白名单反向用例。本地只执行可判定的单元/契约测试，真实 HTTP 与环境验证留到发布阶段。

## 1. 测试策略与完成判据

1. **红**：先写能复现配置覆盖、无界等待、fail-open/错误 401、故障缓存的测试，并在旧行为上看到预期失败；记录失败断言，不以“编译错误”冒充有效红。
2. **绿**：只实施本方案文件面内的最小改动，使定向测试转绿。
3. **重构**：保持测试绿，不扩大 portal、`packages/*`、其他服务或 DB 范围。
4. **变异验证**：绿色后逐项恢复关键旧缺陷，确认对应测试重新变红；每次只做一个变异，完成后恢复修复并再次转绿。
5. **静态与构建**：auth、gateway 分别执行 `build` 和只读 `lint:ci`；不用会写文件的 `lint --fix` 作为验证命令。
6. **验收映射**：测试证据映射到 V1–V9；代码写完或单次测试绿不等于完成。

## 2. 独立测试矩阵

### 2.1 ecosystem 配置单源

| ID | 场景/断言 | 红绿与变异要求 | 验收 |
|---|---|---|---|
| E1 | ecosystem 不包含会向 auth 注入的顶层 Redis 变量 | 旧配置应先红；恢复任一变量必须再红 | V1 |
| E2 | `baseDbConfig` 不再含 `REDIS_URL`，公共数据库配置不间接注入 Redis | 恢复字段必须再红 | V1 |
| E3 | 非 Redis 的 PM2/数据库配置保持原样 | 防误删；若误删无关配置应红 | V1 |
| E4 | 配置测试不读取、不打印真实 `.env` 值 | 日志/快照不得出现连接串或口令 | V1、安全 |

### 2.2 auth Redis options

| ID | 场景/断言 | 红绿与变异要求 | 验收 |
|---|---|---|---|
| R1 | 合法 Redis URL 解析为主机、端口、db 等既有字段 | 保持原有合法输入兼容；不输出原始 URL | V1 |
| R2 | 缺失、空白、非法 scheme、缺主机、非法 db 均 fail-fast | 任一校验被删除时对应测试必须红；错误消息不含配置值 | V1、安全 |
| R3 | `connectTimeout=1000` | 改成更大的值或删除应红 | V3 |
| R4 | `commandTimeout=800` | 删除或放大应红 | V3 |
| R5 | `maxRetriesPerRequest=1` | 改成无界/更大重试应红 | V3 |
| R6 | `enableOfflineQueue=false` | 恢复 `true` 应红 | V3 |
| R7 | `retryStrategy` 有界退避且上限 1000ms | 移除上限应红；不要求请求命令随后台重连排队 | V3 |
| R8 | 非法/缺失配置不回退到回环默认地址 | 新增 localhost 默认 fallback 应红 | V1 |

### 2.3 auth.service 黑名单与周边语义

| ID | 场景/断言 | 红绿与变异要求 | 验收 |
|---|---|---|---|
| A1 | 黑名单 `exists=false`：返回 200 等效结果 `valid:true` | 保持正常有效 token 行为 | V2 |
| A2 | 黑名单 `exists=true`：返回 200 等效结果 `valid:false` | 不得改成 503；恢复正常吊销语义 | V4 |
| A3 | 黑名单 `exists` reject/timeout：抛出 503 类别异常 | 恢复 fail-open、返回 `valid:true` 或转成 401 均应红 | V3 |
| A4 | `getTokenStatus` 不透出内部错误为 401 | 将 Redis 异常捕获成普通无效 token 应红 | V3、V7 |
| A5 | `verifyToken` 区分确定的 token 无效与内部依赖故障 | 签名/过期等既有 401 不变；Redis 故障转 401 应红 | V3、V5 |
| A6 | `refreshToken` 区分刷新凭据失败与黑名单依赖故障 | Redis 故障被当成 401 应红；正常刷新不回归 | V9 |
| A7 | logout/吊销写入与读取链路保持既有行为 | 失败不得被静默当成成功；正常 logout 后 token 失效 | V4、V9 |
| A8 | 异常文案与日志不包含 Redis URL、口令或配置值 | 在异常中拼入原始配置值应红 | 安全 |

### 2.4 gateway TokenBlacklistGuard

| ID | 场景/断言 | 红绿与变异要求 | 验收 |
|---|---|---|---|
| G1 | 白名单路径直接放行，不发起内部 fetch | 白名单被误拦截或发请求应红 | V6 |
| G2 | 无 token 直接放行，下游鉴权职责不变 | 无 token 被 Guard 直接 401/503 应红 | V5 |
| G3 | 200 `{valid:true}` 放行，并按 5s 缓存 | 正常路径或有效 TTL 改坏应红 | V2 |
| G4 | 200 `{valid:false}` 返回 401，并按 300s 缓存 | 吊销被放行或无效 TTL 改坏应红 | V4 |
| G5 | 非 2xx（含 auth 503）统一返回 503 和指定文案 | 恢复 fail-open 或转成 401 应红 | V3、V7 |
| G6 | 网络 reject 统一返回 503，不泄露内部错误 | 恢复放行或泄露堆栈应红 | V3、V7 |
| G7 | 内部 fetch 使用 `AbortSignal.timeout(API_TIMEOUT.UPSTREAM.INTERNAL)`，常量值为 3000ms | 删除 signal、使用无界 fetch 或硬编码错误超时应红 | V3 |
| G8 | 超时/中止统一返回 503，目标在 3s 附近结束，端到端预算 ≤4s | 移除超时或等待 portal 10s 才结束应红 | V3 |
| G9 | 非 JSON、JSON 缺 `valid`、`valid` 非布尔均返回 503 | 将畸形响应当作有效放行应红 | V7 |
| G10 | 所有故障均不写缓存 | 第一次故障后第二次成功回源必须按新结果处理；若故障被缓存则红 | V7 |
| G11 | 缓存命中不重复回源；过期后重新回源 | 保持有效 5s、无效 300s，不改变既有缓存策略 | V2、V4 |
| G12 | 统一 503 文案为「认证状态暂不可用，请稍后重试」 | 文案泄露内部细节或映射成其他状态应红 | V7、安全 |

> 超时测试优先使用可控 fake timer/mock fetch，同时至少保留一个真实 AbortSignal 行为的定向用例，避免只证明 mock 被调用而没有证明请求会被中止。

### 2.5 真实链路与周边验收（需环境操作授权）

| ID | 场景 | 通过判据 | 验收 |
|---|---|---|---|
| I1 | 正常 token 调真实 `conversations` | 正常放行，无新增 401/503 | V2、V8 |
| I2 | 真实 `verify` | 有效/无效凭据结果符合既有契约，依赖故障不误报 401 | V5、V8 |
| I3 | 真实 `nce` | 正常链路不回归；认证依赖故障有界返回 | V8 |
| I4 | Redis 故障演练（仅在明确批准的环境） | auth/gateway 503，端到端 ≤4s，无持续 pending；恢复后无需清故障缓存 | V3、V7 |
| I5 | logout → 原 token 再访问 | 按既有缓存时延失效，之后返回 401 | V4、V9 |
| I6 | refresh、登录白名单携带旧 token | 不被黑名单 Guard 错误拦截；内部故障不伪装成凭据错误 | V6、V9 |

真实环境验证不得输出 token、连接串或配置值；故障演练、发布与重启均需单独确认。

## 3. 定向测试命令（已授权）

从 worktree 根目录执行：

```bash
node --test ecosystem.config.spec.js

npm --prefix servers/auth-service test -- --runInBand src/config/redis-options.spec.ts src/auth/auth.service.spec.ts

npm --prefix servers/gateway test -- --runInBand src/auth/token-blacklist.guard.spec.ts

npm --prefix servers/auth-service run build
npm --prefix servers/gateway run build

npm --prefix servers/auth-service run lint:ci
npm --prefix servers/gateway run lint:ci
```

要求保留每条命令的退出码和关键输出。`lint:ci` 不带 `--fix`，避免验证过程改写文件。

## 4. 共享面回归：用户已拍板抽样

### 4.1 授权抽样矩阵与本地边界

| 抽样项 | 本地可完成证据 | dev/prod 发布阶段待验 |
|---|---|---|
| C-01 登录/刷新/退出 | `auth.service.spec.ts` 既有登录/refresh 用例 + 新增 logout 正常/故障用例；`refresh-cookie.spec.ts` | 真实登录、刷新、退出及退出后旧 token 失效 |
| C-02 internal token-status | `auth.service.spec.ts` 覆盖 `getTokenStatus` 有效、吊销、无效及 Redis 503 契约 | InternalAuthController 的真实 HTTP、内部 key 与网关联调；现有基线无独立 controller spec，不伪称已覆盖 |
| C-04 gateway Guard | `token-blacklist.guard.spec.ts` 全文件定向回归 | 经 gateway 的真实请求与故障链路 |
| 有效 token conversations/verify/NCE | 本地仅覆盖 `verifyToken` 与 Guard 有效 token 分支 | 真实 conversations、verify、NCE 请求；本机不伪造 prod 结论 |
| 无 token/无效 token/白名单反向用例 | auth 无效 token + Guard 无 token、白名单、已吊销 401 用例 | 下游真实鉴权与页面行为 |

本地授权命令（从 worktree 根目录执行）：

```bash
npm --prefix servers/auth-service test -- --runInBand src/auth/auth.service.spec.ts src/auth/refresh-cookie.spec.ts
npm --prefix servers/gateway test -- --runInBand src/auth/token-blacklist.guard.spec.ts
```

抽样不能等价声称覆盖所有路由，也不替代 V8/V9 的 dev/prod 实测。

### 4.2 全量未授权

不执行 auth/gateway 全量测试。只有用户后续明确变更范围时才可另行执行。

## 5. 变异验证清单

绿色实施后至少完成以下最小变异集，并逐项恢复：

| 变异 | 必须变红的测试 | 证明内容 |
|---|---|---|
| 恢复 ecosystem Redis 覆盖 | E1/E2 | 配置单源测试不是摆设 |
| 删除 `commandTimeout` 或恢复离线队列 | R4/R6 | Redis 等待确实有界 |
| 黑名单 `exists` 故障改为放行/401 | A3/A4/A5 | auth fail-closed 与异常分类有效 |
| 删除 gateway `AbortSignal.timeout` | G7/G8 | 内部 fetch 不再无界 |
| 非 2xx/网络错误改为放行 | G5/G6 | gateway 不 fail-open |
| 缺 `valid` 时默认有效 | G9 | 畸形响应不会绕过认证 |
| 将故障写入缓存 | G10 | 短暂故障不会持续污染结果 |

每个变异只用于验证测试敏感性，不得留在最终代码中；恢复后对应定向测试必须重新转绿。

## 6. 本地实施证据（2026-11-11）

| 证据 | 实测结果 |
|---|---|
| 红阶段 | auth 初始 5 条失败：exists/client 故障返回 false、getTokenStatus 返回 valid:true、verify/refresh 吞成 401；gateway 初始 14 条失败：非 200、畸形、网络/timeout 放行，无 timeout signal，故障缓存；新增 logout 故障用例红（静默成功），真实 AbortSignal 用例红（7s 测试超时） |
| 绿阶段 | ecosystem 2/2；auth 定向 redis-options + auth.service 53/53；gateway 26/26，其中真实 AbortSignal 约 3002ms 后 503；最终 auth 加 refresh-cookie 抽样 73/73 |
| 变异 | 恢复 ecosystem 注入→2 红；删 commandTimeout→1 红；恢复 auth exists fail-open→2 红；删 gateway timeout→1 红；非 200 放行→4 红；缺 valid 默认有效→4 红；故障写缓存→1 红（恢复后回源次数 1≠2）。全部恢复后最终定向/抽样转绿 |
| build | auth、gateway `nest build` 均退出 0 |
| lint | auth、gateway `lint:ci` 均退出 0、0 error；分别报告 30/80 条 warning，未使用 --fix，未为无关 warning 扩大文件面 |
| C-01 | 本地 auth.service 登录/refresh/logout + refresh-cookie 已完成；真实登录/刷新/退出待 dev/prod |
| C-02 | 本地 getTokenStatus 有效/吊销/无效/Redis 503 契约已完成；真实 internal HTTP、内部 key 与网关联调待 dev/prod |
| C-04 | 本地 Guard 全文件 26/26 已完成；真实 gateway 链路待 dev/prod |
| 正反向抽样 | 本地有效 token Guard/verify、无 token、无效 token、白名单、吊销 401 已覆盖；真实 conversations/verify/NCE 与下游行为待 dev/prod |
| V1–V9 | V1–V7 已有本地代码/单元证据；V1 运行配置核查、V8 及 V9 真实周边流程仍待发布阶段，不能记为生产验收通过 |
| 文件面 | 仅批准的 ecosystem/auth/gateway 文件与两份方案文档；无 portal、packages、其他服务、migration 或真实配置改动 |

本地测试通过只覆盖上述明确列出的单元/契约范围；V8/V9 的真实环境部分必须在发布阶段另行验收。

## 7. merge origin/master 后复跑证据（2026-11-11，用户已授权 merge 同步）

合并前 `origin/master` = `23c9521afa4e06b58e4c58f1c8480f0dfeec0555`（fetch 现查，ahead 1 / behind 23）。`git merge origin/master` 由 ort 策略自动完成，**零冲突**；merge 带入的 45 个文件与本方案文件面（ecosystem、auth-service、gateway Guard、两份文档）**交集为空**（脚本比对确认），未做 reset/rebase，本地备份分支 `backup/redis-auth-fix-69e7a237` 指向原 HEAD `69e7a237`。

| 证据 | 实测结果 |
|---|---|
| ecosystem | `node --test ecosystem.config.spec.js`：2/2 通过，退出 0 |
| auth 定向+抽样 | `pnpm -C servers/auth-service exec jest src/config/redis-options.spec.ts src/auth/auth.service.spec.ts src/auth/refresh-cookie.spec.ts --runInBand`：3 套件 73/73 通过，退出 0 |
| gateway Guard | `pnpm -C servers/gateway exec jest src/auth/token-blacklist.guard.spec.ts --runInBand`：26/26 通过（含真实 AbortSignal 约 3003ms 后 503），退出 0 |
| build | auth、gateway `nest build` 均退出 0 |
| lint:ci | auth 退出 0、0 error / 30 warning；gateway 退出 0、0 error / 92 warning（warning 含 master 新带入文件，未用 --fix，未扩大文件面） |
| 工作区 | merge 及复跑后 `git status` 干净，`git diff --check` 无输出 |

结论：merge 后最终代码上授权抽样全部通过，结果与 merge 前独立盲测一致，可交发布角色合入 master；V8/V9 真实环境验收仍待发布阶段。
