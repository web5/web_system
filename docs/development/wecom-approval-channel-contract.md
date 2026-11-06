> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
> 定位：卡②「console 企微审批通道」的**接口契约与交付物定义**（写码前的流程凭证；改契约先改本文再改代码）。

# console 企微审批通道（卡②）· 接口契约与交付物定义

> 归属需求：[`specs/deploy-console-wecom-approval/design.md`](../../specs/deploy-console-wecom-approval/design.md) §5 / §七 卡② / §十 卡②（网络与时序见同目录 `tech-design-network-and-sequence.md`）
> 开工：2026-11-06 08:3x（用户回「校验通过」，#8538 前置闭环；按 11-05「优先开工继续」直接进池）
> 本文件是写码前的**流程凭证**。改动契约先改本文件再改代码。
> 上游契约真源：`docs/development/wecom-approval-identity-contract.md`（卡①，`POST /internal/identities/resolve`）

---

## 一、一句话与边界

在 deploy-console 加一条**只用于审批**的企微通道：应用消息带链接 → 企微 OAuth 免登证明「是谁」 → 复用既有 `PipelineService.approve/reject` 执行。

🔴 **三条不得越过的边界**（spec R11 / S1 / S2b）：
1. **不复制审批逻辑** —— 只调用 `PipelineService.approve/reject` 与 `ApprovalService`；
2. **不直连 `users` 表** —— 身份只走卡① 的 `identities/resolve` HTTP 契约；
3. **不放宽既有校验** —— 白名单仍以节点 `approvers` + `ApproverService` 为准，且企微通道 **fail-closed**：既有 `ApproverService` 在 user-service 不可达时「降级放行」，本通道必须把 `degraded=true` 当**拒绝**处理。

## 二、认领文件面（多会话防冲突）

| 文件 | 动作 |
|---|---|
| `servers/deploy-console/src/wecom/*` | 新增 9 个实现文件 + 4 个 spec |
| `servers/deploy-console/src/entities/deploy-approval.entity.ts` | 加 3 列（channel / identityExternalId / sourceIp） |
| `servers/deploy-console/scripts/0029_deploy_approvals_wecom_channel.sql` | 新增，**仅 deploy 库**手工执行（落点依 `src/migrations/README.md` 约定） |
| `servers/deploy-console/src/app.module.ts` | 仅追加 1 个 import + 1 个 module 注册 |
| `servers/deploy-console/src/pipeline/pipeline.service.ts` | 挂起分支**仅加 1 行事件发射**（不改审批逻辑） |
| `apps/deploy-console/src/router/index.ts` | 仅追加 1 条 `/m/approve/:id` 路由 |
| `apps/deploy-console/src/views/m/ApproveMobile.vue` | 新增 H5（S1–S5） |

**不动**：`MainLayout.vue`、`ApproverService` 降级策略、`PipelineService.approve/reject` 内部、`ApprovalService.resolve`、`JwtAuthGuard` / `JwtStrategy`、user-service 代码、卡① 工作树。
**工作树**：`~/workspace/web_system-wecom-approval`（`feature/wecom-approval-channel`，基于 `origin/master 374d4428`）。卡① 在 `~/workspace/web_system-wecom`（`791eb6d1`），两者基于不同 master 提交但**零文件交叠**：卡② 只通过 HTTP 契约依赖卡①，不引用其源码。

## 三、配置与启动自检（T2-a / V12）

| 键 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `WECOM_APPROVE_ENABLED` | 否 | `0` | **严格 `1` 才启用**；`0` 时整个通道不注册事件监听、不发任何企微请求、端点返回 404 语义 |
| `WECOM_APPROVE_MODE` | 否 | `oauth` | `oauth`（B）/ `signed-link`（A） |
| `CONSOLE_PUBLIC_BASE_URL` | 启用时必填 | 无 | 缺则**拒绝启动**（抛错），避免发出指向 localhost 的死链 |
| `WECOM_CORP_ID` / `WECOM_AGENT_ID` / `WECOM_SECRET` | oauth 启用时必填 | — | **源：配置中心 `config_items`**（`layer=platform`），`~/env_config/wecom.env` 只是录入输入 |
| `WECOM_APPROVE_TICKET_SECRET` | signed-link 必填 | 回退 `JWT_SECRET` | HMAC 密钥；oauth 的 state/短令牌用 `ticketSecret \|\| JWT_SECRET` |
| `WECOM_LINK_TTL_SEC` | 否 | `900` | A 模式链接 TTL |
| `USER_SERVICE_URL` / `INTERNAL_API_KEY` | 已有 | — | 复用 console 既有配置，不新增 |

### 3.1 凭证来源：配置中心（2026-11-06 定，替代「运行时读文件」）

```
~/env_config/wecom.env ──(scripts/import-wecom-env.ts，一次性/可重复)──▶ config_items
                                                                        │ scope=module
                                                                        │ env_id=dev|prod
                                                                        │ module_key=deploy-console
                                                                        │ layer=platform  ← 不下发、不落盘
                                                                        │ deliverable=0
                                                                        │ is_secret=1（值 AES-256-GCM 密文）
                                                                        ▼
console 启动 → runBootstrap()（src/bootstrap/load.ts）连库读 global+env+module → 解密 → 合并进 process.env
             → resolveWecomConfig(process.env)  ← 代码只认环境，不读文件、不读库
```

**为什么不运行时读 `wecom.env`**：`ConfigModule` 只读服务目录 `.env` / `.env.generated`，读不到
`~/env_config/`；若为此另开一条文件通道，凭证就变成「文件一份、库一份」，正是要避免的漂移。
配置中心本来就有一套「连库→解密→注入 `process.env`」的自举链路（`runBootstrap`），复用它即可。

| 决策 | 取值 | 理由 |
|---|---|---|
| `layer` | `platform`（**不用**既有条目的 `app`） | 语义正是「console 进程内拉取、不下发」；`isRowDeliverable()` 对 `platform` 直接判 false，企微 Secret 永不会被写进任何服务的 `.env.generated` |
| `deliverable` | `0` | 同上意图的数据层表达，双保险 |
| `is_secret` | 键名命中 `SECRET` / `_KEY$` / `TOKEN` / `PASSWORD` | `WECOM_SECRET` 加密；`CORP_ID` / `AGENT_ID` / `BASE_URL` / 开关为明文（可读、可排障） |
| 幂等 | 比较**解密后明文** | 密文含随机 IV，比密文会永远判「变了」 |

🔴 **生效前提**：目标环境的 console 必须处于 **bootstrap 模式**（`.env.bootstrap` 里有
`CONSOLE_ENV_ID` + `CONSOLE_DB_DSN` + 主密钥），否则 `runBootstrap()` 走 legacy 分支直接返回，
配置中心里的条目**不会被读**。当前 dev console `.env` 无 `CONSOLE_ENV_ID` → 仍是 legacy。

🔴 **V12 硬要求**：`WECOM_APPROVE_ENABLED=0` 时，`resolveWecomConfig()` 立即早退、**不校验也不读取**任何其它键；`WecomNotifierService` 不注册事件监听；`WecomApiClient` 零调用。

## 四、接口清单（前缀 `/api`，全部 `@Public()` 绕过全局 JwtAuthGuard）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/wecom/oauth/authorize?approvalId=` | 公开 | 302 企微授权页，`state` = HMAC+时间戳（10min） |
| GET | `/wecom/oauth/callback?code=&state=` | 公开 | code→userid→`identities/resolve`→白名单→签短令牌→302 H5 |
| GET | `/wecom/approvals/:id` | `WecomApproveGuard` | 脱敏详情（不含日志正文 / 密钥 / 内部路径） |
| POST | `/wecom/approvals/:id/approve` | 同上 | prod 必须 `confirm=true` |
| POST | `/wecom/approvals/:id/reject` | 同上 | `comment` 必填 |
| ~~POST~~ | ~~`/wecom/signed/approvals/:id/approve\|reject`~~ | 签名链接 | **本轮不注册**（见 §九）：A 模式缺可靠身份来源，不伪造接口 |

**短令牌**：HMAC-SHA256 自签串（非主 JWT），`scope='approve'`、`approvalId` 绑定单号、TTL 15min；Guard 强制 URL 里的 `:id` 与令牌内 `approvalId` 一致。前端存 `sessionStorage`，不落 `localStorage`。**不得**用它调 `/pipelines/*`。

## 五、状态机与硬规则

| # | 规则 | 实现点 |
|---|---|---|
| W-a | **fail-closed**：`identities/resolve` 超时 / 非 2xx / `data:null` / `degraded=true` → 403 冷提示，审批单保持 pending | `WecomIdentityClient` + `WecomApprovalService.assertCanReview` |
| W-b | **CAS 领权**：调 `PipelineService` 前先 `UPDATE deploy_approvals SET channel='wecom', identity_external_id=?, source_ip=? WHERE id=? AND status='pending'`，`affected!==1` → 409 | `WecomApprovalService.claim()`（V6/V7 幂等与交叉并发） |
| W-c | **prod 二次确认**：`env==='prod' && confirm!==true` → 400 | `WecomApprovalService.approve()` |
| W-d | **驳回意见必填**：空/全空白 → 400 | `WecomApprovalService.reject()` |
| W-e | **终态前置**：流水线 `cancelled/failed` → 409；审批单非 `pending` → 409（带 reviewer/reviewedAt） | `WecomApprovalService` |
| W-f | **审计必落**：`channel=wecom` + `identityExternalId` + `sourceIp` + `comment`，**拒绝与失败也落** | `AuditService.log` |
| W-g | **通知不阻塞**：挂起事件异步推送，`catch` 吞掉，只记 `delivery.wecom=failed` | `wecom.events.ts` + `WecomNotifierService` |

**为什么用进程内事件桥**：`WecomModule` 要注入 `PipelineService`，若在挂起点反向注入 notifier 会造成模块循环依赖。`wecom.events.ts` 是零 Nest 依赖的 `EventEmitter` 单例，PipelineService 只 `emit` 一行，notifier 在 `onModuleInit` 订阅（开关关闭则不订阅）。console 为单点进程，跨实例广播不在本期范围。

## 六、数据模型（deploy 库，🔴 与 0028 不同库）

`deploy_approvals` 加 3 列（nullable / 有默认值，向后兼容）：

| 列 | 类型 | 说明 |
|---|---|---|
| `channel` | varchar(16) NOT NULL DEFAULT 'console' | `console` / `mcp` / `wecom`；历史行由 DEFAULT 回填 |
| `identity_external_id` | varchar(64) NULL | 企微 userid |
| `source_ip` | varchar(64) NULL | 来源 IP（三通道都可写，本期只 wecom 写） |

🔴 **库归属**：`deploy_approvals` 在 deploy-console 的 `MYSQL_DB`（`web_system_deploy` 系），**不是** `web_system` 主库。0028 加列跑主库，0029 跑 deploy 库，两者不可混跑。prod `synchronize=false`，必须手工执行 0029。

## 七、消息收件人（本轮口径 + 明确缺口）

企微 `message/send` 的 `touser` 使用 `@all`（应用**可见范围**已在 #8538 第 3 步限定为审批人），链接本身仍强制 OAuth + 白名单 fail-closed，`@all` 只是通知范围、**不是放行**。
🔴 **缺口**：spec §5.1 写的是「节点 `approvers` 白名单 → 反查 `users.wecom_userid` 精确推送」，卡① 契约只有 `resolve（外部ID→用户）`，**没有反向 lookup（用户名→wecom_userid）**。本轮不伪造该接口；精确反查需卡① 增一条 internal 契约后另开小卡，见 §九。

## 八、验证判据对齐

| # | 判据 | 本轮手段 |
|---|---|---|
| V2/V3/V14 | 免登 / 非白名单 403 / 跨服务不可达 fail-closed | `wecom-identity.client.spec.ts`、`wecom-approval.service.spec.ts` |
| V4/V5/V6/V7/V8/V10 | 复用 PipelineService / 必填意见 / CAS 幂等 / prod confirm / 审计 | `wecom-approval.service.spec.ts` |
| V9 | 链接 / 短令牌过期 | `wecom-ticket.service.spec.ts` |
| V11 | 企微不可用不阻塞 | `wecom-notifier.service.spec.ts`（失败吞掉）+ 事件桥 emit 不 await |
| V12 | 开关关闭回到现状 | `wecom.config.spec.ts` + notifier 不订阅 |
| V1 | 挂起 60s 内收到待办 | 事件桥已接；**真机/真实企微推送待联调** |
| 回归集 | `node-approval.spec.ts` / `approval.service.spec.ts` / `mcp.controller.spec.ts` / `user.service.spec.ts` | 全量跑 |

## 九、明确不做（防范围膨胀 / 缺口照实列）

- ❌ 精确按节点白名单反查企微 userid（卡① 缺反向 lookup 契约，另开卡）
- ❌ A 模式 `signed-link` 审批端点：签名链接不证明「是谁」，在卡① 补齐绑定前实现等于绕过白名单；工具层保留 `issueSignedLink/verifySignedLink`，端点不注册
- ❌ 企微原生卡片按钮回调 `/wecom/callback`（spec 定为二期）
- ❌ 审批单过期、多级审批、企微 OA 审批对接
- ❌ 修改 `ApproverService` 既有降级放行策略（独立卡）
- ❌ 本轮不 commit / 不 push / 不发布 / 不执行任何 DDL / 不重启服务
- ❌ H5 真机走查（V2/V6/V8 需本人手机企微，安卓/iOS 各一次）
