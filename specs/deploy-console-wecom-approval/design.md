# deploy-console · 企业微信端手动确认审批 · 需求 spec 与技术方案

> 状态：实施中 ｜ 2026-11-06
> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
> 定位：deploy-console「企业微信端手动确认审批」特性的**需求与设计定稿真源**（设计态；落地状态看代码与卡①② 契约）。

> **状态**：**已拍板（2026-11-04 13:47）· ✅ 已开工** —— 卡①（统一外部身份层）与卡②（console 企微审批通道）均已进池，契约见
> [`docs/development/wecom-approval-identity-contract.md`](../../docs/development/wecom-approval-identity-contract.md)、
> [`docs/development/wecom-approval-channel-contract.md`](../../docs/development/wecom-approval-channel-contract.md)。
> **边界守卫**：已过。「怎么做 / 实现 X」属研发受理；「该不该做」由橙子哥哥拍板（本文只给可行性与成本）。目标系统 `deploy-console`（web_system 内）在《研发部职责说明书》§2 管辖清单内。
> **编排权**：本文是 spec + 方案产出，不替代 `rd-digital-agent` hub 的执行编排。

**配套文档**

| 内容 | 路径 |
|---|---|
| 设计决策记录（为什么这么定） | [`decision.md`](./decision.md) |
| 网络流程图 + 时序图（Mermaid） | [`tech-design-network-and-sequence.md`](./tech-design-network-and-sequence.md) |
| 交互原型稿（Design: pass，sha256 `264782d3…5cca7c`） | [`prototype.html`](./prototype.html) |
| 企微 API 安全规范（可信域名 vs 可信IP） | [`docs/development/wecom-api-trusted-ip.md`](../../docs/development/wecom-api-trusted-ip.md) |

---

## 〇、拍板回执（2026-11-04 13:47）

| # | 用户原话 | 落定口径 | 影响 |
|---|---|---|---|
| 1 | 「原型稿设计通过」 | **Design: pass**（原型稿 sha256 `264782d3…5cca7c`，逐屏按 §5.6 实现，四件"刻意做死"的约束不得优化掉） | 同时**隐含确认 Q1 = 方案 B**：原型画的就是 OAuth 免登 H5。若你本意不是 B，回一句即改，此时改动只在 §5.2 的 `WECOM_APPROVE_MODE` 默认值 |
| 2 | 「审批映射跨服务打通，企微用户跟系统用户要打通，未来微信端（小程序、公众号等）也需要的」 | **Q2 定：走 user-service 统一身份层**，不建 console 本地映射表；**解析入口统一为一条 internal 契约**，公众号/小程序复用同一入口 | §5.3 数据模型整章重写；工期从 M(2 日) 增至 **2 卡 3.5 日**（增量在身份层与迁移）；新增 V13–V15 验收 |
| 3 | 「接受单人」 | **Q3 定：一期只支持 1 个审批人（你）**；不做或签/会签，表结构不限制后续加人 | 无额外工时 |
| 4 | 「建」 | **Q4 定：建企微自建应用**（B 方案前置），取 AgentId/Secret + 可信域名 + 可信IP + 可见范围 | 需求不再阻塞；前置动作见 §七「前置」 |
| 5 | 「方案、需求、原型稿 OK 了，等 CDN 改造完成继续」（2026-11-04 14:25） | **整体通过**：Q5/Q6 随方案整体确认，按默认建议结案（users 加列 + 不要多公众号） | Q5/Q6 结案 → §9.2 清空；CDN 前置已于 11-05 满足，两卡已开工 |

> ⚠️ **第 2 条把范围抬了一档，必须先说清代价**：原方案是 console 自建一张映射表（0.5 日、零跨服务风险）；现在改成动 `users` 表 + user-service 内部接口 + 生产手工 DDL + 账号合并跟随（≈1.5 日、触碰登录链路的相邻表）。
> **换来的东西是值得的**：未来小程序/公众号接审批、接任何"以系统用户身份做事"的能力时，不用再各写一套映射。本文按这个新口径重写，但不隐藏风险 —— 见 §8 R8–R10。

---

## 一、一句话定义

流水线因「审批节点」挂起时，把待办推到**企业微信**；审批人在企业微信里**本人身份**手动点「通过 / 驳回」，流水线随即从该节点之后续跑 —— 不用开电脑登录控制台。

> 关键词是**手动**：不是「自动放行」，不是「AI 代批」，是**必须由人按一次**，且要能证明是那个人按的。

---

## 二、现状事实（只读调研，2026-11-04 13:40 实测）

| # | 事实 | 判据 / 路径 |
|---|---|---|
| F1 | **审批机制早已存在，且是节点级**：`deploy_approvals` 表有 `nodeKey`/`nodeLabel`/`status(pending\|approved\|rejected)`/`reviewer`/`comment`/`reviewedAt` | `servers/deploy-console/src/entities/deploy-approval.entity.ts` |
| F2 | 审批通过后**从该节点之后续跑**，已完成节点不重跑（`resolveStartIndex` 取 `indexOf+1`） | `pipeline/pipeline.service.ts:1183-1245`、`pipeline/pipeline-suspension.ts:41-45` |
| F3 | 挂起态是 `awaiting-approval`，**不写 error、不触发回滚、不算终态** | `pipeline/pipeline.service.ts:1757-1785` |
| F4 | 现有 **两个** 审批入口：控制台 JWT `POST /api/pipelines/:id/approve`；MCP Key `POST /api/mcp/pipeline/:jobId/approve\|reject`（仅提交者本人 + prod 需 `confirm=true`） | `pipeline/pipeline.controller.ts:115`、`mcp/mcp.controller.ts:265,287` |
| F5 | 审批人校验走两关：节点 `approvers` 白名单优先 → 再看 user-service 的 `deploy:pipeline:approve` 权限码；**user-service 不可达时降级放行** | `approval/approver.service.ts:102-124` |
| F6 | 通知只有**单向**通道：`NOTIFY_WECOM_URL`（群机器人）发 markdown，**无回调、无身份、无按钮** | `notification/notification.service.ts:19-48,109-114` |
| F7 | 挂起时**已发**通知 `deploy.awaiting-approval`，但正文只有一段文字，**没有任何可点入口** | `pipeline/pipeline.service.ts:1776-1783` |
| F8 | ⚠️ `servers/deploy-console/.env` 里**没有** `NOTIFY_WECOM_URL` → 企微通道当前是否启用取决于 DB `system_settings` | `grep -o '^[A-Z_]*' servers/deploy-console/.env` |
| F9 | console **公网可达且是 HTTPS**：`https://dev.kedouai.com/console/` → **200**；本地 `http://local.kedouai.com/console/` → 200 | `curl -o /dev/null -w '%{http_code}' --noproxy '*' https://dev.kedouai.com/console/` |
| F10 | console **单点在 dev**（prod 不部署 console 是既定架构，非故障）→ 企微审批链路的可用性上限 = dev 机可用性 | 项目记忆 + 用户两次确认 |
| F11 | 前端 Vue3 + **ant-design-vue 4.2.6** + vite，`baseURL=/console/api`；**全仓无 `@media` 响应式**，是纯桌面布局 | `apps/deploy-console/package.json:16`、`src/api/index.ts:6`、`style.scss` 无媒体查询 |
| F12 | console 登录**代理给 auth-service**（`system=deploy`）签发的 JWT；`CONSOLE_ALLOW_LEGACY_LOGIN=1` 时回落 `.env` 口令逃生 | `auth/auth.service.ts:39-93` |
| F13 | 企微自建应用凭证**不在代码库**：录入 `~/env_config/wecom.env`，经 `scripts/import-wecom-env.ts` 导入配置中心（`config_items`，`layer=platform`） | 见卡② 契约 §3.1 |
| F14 | console **永远手动发布**（GUI 流水线 `enabled=0`，自发布会杀掉执行者） | `scripts/publish-deploy-console.sh:217-218` |
| F15 | 审批已有单测可扩展：`pipeline/node-approval.spec.ts`、`approval/approval.service.spec.ts` | 同目录 |

**结论（缺口定位）**：不是缺「审批」，也不缺「通知」——**缺的是把两者连起来的那个可点入口，以及一条能证明「是企业微信里那个人按的」的身份链**。

---

## 三、需求 spec

### 3.1 用户故事

| # | 角色 | 场景 | 期望 |
|---|---|---|---|
| US-1 | 橙子哥哥（外出中） | AI 提交 prod 发布，流水线挂在「发布确认」节点 | 手机企微**收到卡片**，点开看到「环境/模块/版本/分支/commit/谁提交的」，**点「通过」**，发布继续 |
| US-2 | 同上 | 看了下是错分支 | **点「驳回」+ 写一句原因**，发布终止，发起人收到驳回通知 |
| US-3 | 同上 | 不确定，想问一下 | 卡片里能直接看到**流水线详情链接**（跳控制台看日志），不必自己找 |
| US-4 | 同上 | 卡片被转发给了别人/链接外泄 | 别人点开 → **明确提示无权限，且不改变任何状态** |
| US-5 | 同上 | 手滑点了两次 | 只生效一次，第二次提示「已由 X 于 Y 处理」 |

### 3.2 目标（In scope）

1. 挂起时**主动推送**待办到企业微信（含足够判断信息），不再依赖人主动去翻控制台。
2. 企业微信内**完成通过/驳回**（含驳回意见），移动端页面可读可点。
3. **身份可验证且跨服务统一**：企微 `userid` 经 user-service 解析为系统用户，必须是审批人本人；解析失败一律拒绝且不改状态。**同一条解析契约供未来小程序/公众号复用**（拍板 #2）。
4. 复用既有状态机（`approve/reject` → resume），**不新增执行路径**，审计/通知/幂等语义与现有两入口一致。
5. 企微通道不可用时，**发布主流程零影响**（沿用「通知尽力而为」铁律）。

### 3.3 非目标（Out of scope，本期明确不做）

| 不做 | 理由 |
|---|---|
| 不做「多级审批 / 会签 / 或签」 | 现有节点模型是单节点单审批，扩展审批流属另一张需求卡（拍板 #3 接受单人） |
| 不做「AI 自动审批」 | 与「手动」语义冲突；MCP 已有通道，但那是另一个问题 |
| 不改审批节点配置 UI（approvers 白名单怎么配） | 已有 `OrchestrationEditor.vue` 承载，本期只读 |
| **不做「身份绑定」管理页面** | 一期用 `identities/bind` 内部接口/命令绑定一次（单人、一次性）；页面属后续体验优化 |
| 不做「一人绑多个公众号/多小程序」 | 既有限制（`oa_openid`/`mp_openid` 单列），升级路径见 `decision.md` §二 |
| 不让企微通道成为**唯一**审批入口 | 控制台 + MCP 保留；企微是第三入口，三者共用一套状态机 |
| 不做审批单自动过期 | 会改变既有语义（现在 pending 永不过期），如需另开卡 |
| **不做企业微信「审批」应用（OA 审批 `oa/*`）对接** | 见 §四 方案 C，L 档；本期不做，未来若接再纳入 |

---

## 四、三条技术路径对比（这是要拍板的核心）

| 维度 | **A · 群机器人 + 签名一次性链接** | **B · 自建应用 + 企微 OAuth 免登 H5**（选定） | **C · 企微「审批」应用（OA 审批 API）** |
|---|---|---|---|
| 消息怎么到手机 | 复用现有群机器人 webhook（markdown） | 自建应用「应用消息」→ **可发给指定成员** | 企微「审批」中心原生待办 |
| 点「通过」在哪 | 打开一个 H5 页面 | 打开一个 H5 页面（**免登**） | 企微原生审批页 |
| 身份证明 | ❌ **链接即凭证**（HMAC 签名 + 15min + 一次性） | ✅ 企微 `userid`（OAuth `snsapi_base`）→ 映射系统用户 | ✅ 企微账号 + 审批流节点 |
| 外泄风险 | ⚠️ 群里任何人拿到链接都能批（靠 TTL 兜） | ✅ 非白名单直接 403 | ✅ 低 |
| 是否需要建企微自建应用 | 不需要 | 需要（建应用 → AgentId/Secret → 可信域名 + 可信IP） | 需要 + 需在企微后台配审批模板 |
| console 改动 | 后端 2 端点 + 1 移动页 | 后端 OAuth + 回调 + 映射 + 1 移动页 | 后端双向回调 + 字段映射 |
| 双真源风险 | 无 | 低（白名单仍在 console） | ⚠️ 高：企微审批流的审批人 vs console `approvers` 白名单两处维护 |
| 估档 | **S**（≤0.5 日） | **M**（1.5–2 日） | **L**（3–4 日，必须拆卡） |
| 适合谁 | 单人群、只自己批、应急 | 有协作者、要「能证明是谁批的」 | 多级审批、要企微合规留痕 |

### 结论：**B 为一期目标方案，A 降级为「配置缺失时的应急通道」**

理由（三条，都指向同一件事）：

1. **「手动确认」的价值全在身份**。A 的链接一旦被转发，谁都能批——那等于把 prod 门禁换成一个微信群。B 用 `userid` 把「谁批的」钉死，审计里能落 `wecom_userid`。
2. **B 的额外成本是一次性的、很小的**：企微后台建应用三步 + 一个 `WW_verify_*.txt` 校验文件 + 可信IP；之后所有企微能力（应用消息、OAuth、卡片回调）都能复用，C 期也能接。
3. **C 现在做不划算**：单人公司没有多级审批需求，却要吃「审批模板字段固定 + 审批人两处维护 + 双向回调」的复杂度。等真有多级需求再上。

> A 并不废弃：**不配企微自建应用时自动回落到 A**，保证「明天就能用」，同时用 `WECOM_APPROVE_MODE=signed-link|oauth` 显式切换，默认 `oauth`。

---

## 五、选定方案（B）详细设计

### 5.1 链路

```
流水线执行到 approval 节点
   └─ PipelineSuspended 抛出 → status=awaiting-approval（既有）
        └─ 新增：WecomApprovalNotifier.push(approval)        ← ①（异步，失败不阻塞）
              ├─ 取审批人名单：节点 approvers 白名单 → 反查 users.wecom_userid
              ├─ 取 access_token（缓存 7200s，提前 5min 刷新）
              └─ 应用消息 template_card/textcard，链接 =
                     https://dev.kedouai.com/console/m/approve/<approvalId>
                          ↓ 点击（企微内置浏览器）
GET /api/wecom/oauth/authorize?approvalId=…
   └─ 302 → https://open.weixin.qq.com/connect/oauth2/authorize?…&redirect_uri=/api/wecom/oauth/callback
GET /api/wecom/oauth/callback?code=&state=
   ├─ code → getuserinfo → wecom_userid
   ├─ 调 user-service POST /internal/identities/resolve {channel:'wecom', externalId}
   │     ├─ 未绑定 / 账号非 active → 403 页（不改任何状态）
   │     └─ 不可达（超时/5xx）→ 403 页「身份服务不可用，请去控制台」【fail-closed，不放行】
   ├─ 解析出 username ∈ 节点 approvers 白名单？（既有 assertCanReview 复用）
   │     └─ 否 → 403 页
   └─ 是 → 签 scope=approve 的短令牌（15min，sub=username，ext=wecom_userid）→ 302 到 H5
GET /api/wecom/approvals/:id        （scope=approve）→ 详情（脱敏）
POST /api/wecom/approvals/:id/approve|reject  （scope=approve）
   └─ 内部调 PipelineService.approve/reject（**既有实现，不复制逻辑**）
        └─ 审批通过 → 从节点之后续跑 → 结果推回企微（更新卡片/补发结果消息）
```

### 5.2 新增配置（凭证不进代码库）

| 键 | 含义 | 必填 | 默认 |
|---|---|---|---|
| `WECOM_APPROVE_ENABLED` | 总开关，`0` 时功能整体关闭（回归安全阀） | 否 | `0` |
| `WECOM_APPROVE_MODE` | `oauth`（B）/ `signed-link`（A） | 否 | `oauth` |
| `WECOM_CORP_ID` / `WECOM_AGENT_ID` / `WECOM_SECRET` | 自建应用凭证 | oauth 模式必填 | — |
| `CONSOLE_PUBLIC_BASE_URL` | 签名链接的对外基址（实测 `https://dev.kedouai.com/console`） | 是 | 无（缺则拒绝启用） |
| `WECOM_LINK_TTL_SEC` | A 模式链接有效期 | 否 | `900` |
| `WECOM_APPROVE_TICKET_SECRET` | A 模式 HMAC 密钥 | signed-link 必填 | — |
| `USER_SERVICE_URL` / `INTERNAL_API_KEY` | 调身份解析用（console **已配**，复用，不新增） | 是 | 已有 |

> 🔴 缺 `CONSOLE_PUBLIC_BASE_URL` 时**拒绝启用**（而不是生成 `localhost` 链接）——线上发出去的链接指向本机 = 静默失效。
> 凭证实际来源（配置中心 `config_items`，`layer=platform`）见 [`docs/development/wecom-approval-channel-contract.md`](../../docs/development/wecom-approval-channel-contract.md) §3.1。

### 5.3 数据模型（按拍板 #2：跨服务统一身份层）

#### 5.3.0 先看现状 —— `users` 表已经是身份账本，只是缺两个渠道

| 事实 | 判据 |
|---|---|
| `users` 表**已有** `mp_openid`（小程序）、`oa_openid`（公众号）两列，均 `@Index()` | `packages/shared/src/entities/user.entity.ts:68-76` |
| **没有** `unionid`、**没有**企微 `userid` | 同上 |
| 用户实体是 **packages/shared 单一真源**，被 auth/user/todo 等多服务共用 | `user.entity.ts:4-11`，「各服务统一 import」 |
| 🔴 **生产 `synchronize=false`，加列必须手写迁移 DDL**，否则线上缺列 | 同文件 `:124-132`、`:134-147` 两处注释明确写了这条 |
| 账号合并机制**已存在**：`merged_to` 列，非空 = 该账号已并入别的账号（auth-service 裸 SQL 写） | `user.entity.ts:82-103` |
| 加进实体但不写迁移会被 synchronize 反向 DROP（本机 development 才是 synchronize=true） | 同文件 `:36-38` |

**结论：不要新建 console 本地映射表，也不要在 users 表之外另起一张"渠道表"。** 前者让「企微→系统用户」只对 console 有效，未来小程序要再打通一次；后者会与既有 `mp_openid`/`oa_openid` 形成**双真源**。

#### 5.3.1 落法：users 加 2 列 + 一条统一解析契约

**① `users` 表加 2 列**（改 `packages/shared/src/entities/user.entity.ts` + 手写迁移）

| 列 | 类型 | 说明 |
|---|---|---|
| `wecom_userid` | varchar(64) NULL，`@Index()` | 企业微信成员 userid |
| `unionid` | varchar(64) NULL，`@Index()` | 微信开放平台 unionid —— 解决「同一人的公众号 openid ≠ 小程序 openid」 |

> 加完必须**同时**做三件事，缺一线上就缺列：改 shared 实体 → 写迁移 `migrations/00XX_users_wecom_identity.sql` → 发布时在 dev/prod 手工执行 DDL。

**② user-service 提供统一解析入口（新 internal 接口，`x-internal-key` 鉴权）**

| 方法 | 路径 | 入参 | 出参 |
|---|---|---|---|
| POST | `/internal/identities/resolve` | `{ channel: 'wecom'\|'mp'\|'oa', externalId: string, unionId?: string }` | `{ code:0, data:{ userId, username, nickname?, roles[], systems[], mergedFrom?: {userId,username} } }`；查无返回 `data: null`（**不是 404**） |
| POST | `/internal/identities/bind` | `{ userId, channel, externalId, unionId?, operator }` | `{ code:0, data:{ bound:true } }`；冲突 → 409 |
| POST | `/internal/identities/unbind` | `{ channel, externalId, operator }` | `{ code:0 }` |

**resolve 的三条硬规则**（本方案真正的价值，也是最容易漏的）：

| # | 规则 | 为什么 |
|---|---|---|
| R-a | **跟随账号合并**：命中行的 `merged_to` 非空 → 递归解析到存活账号，出参带 `mergedFrom` | 合并过的账号若不跟随，审批人会"查无此人"，表现成"我有权限却打不开" |
| R-b | **`status` 检查**：`users.status != 'active'` → 视为解析失败 | 停用/封禁账号不该还能批 prod |
| R-c | **渠道优先级**：`externalId` 命中即返回；`unionId` 只在 externalId 未命中时兜底 | 不能用 unionId 覆盖精确命中 |

**③ 渠道能力矩阵（未来复用，本期只实现 wecom 列读写）**

| 渠道 | `channel` | 外部 ID 列 | 本期 | 未来 |
|---|---|---|---|---|
| 企业微信 | `wecom` | `wecom_userid` | ✅ 实现 | — |
| 小程序 | `mp` | `mp_openid`（已有列） | 只读解析 | 接审批/鉴权时直接用 |
| 公众号 | `oa` | `oa_openid`（已有列） | 只读解析 | 同上 |

> 即：`resolve` 一期就把三渠道都实现（mp/oa 的列本来就在，几乎零成本），console 只用 `wecom`。
> 这样"未来微信端也需要"落到**已经写完并测过的契约**上，而不是"以后再设计"。

#### 5.3.2 `deploy_approvals` 加 3 列（nullable，向后兼容）

| 列 | 说明 |
|---|---|
| `channel` | `console` / `mcp` / `wecom`（审批来源，审计用；历史行回填 `console`） |
| `identityExternalId` | 审批人外部身份 ID（企微 userid；MCP 走 Key 时为空） |
| `sourceIp` | 审批来源 IP（三通道都可写，用于异常追溯） |

> 不新增 `expiresAt`：本期不做过期（见 §3.3）。

### 5.4 接口清单（前缀 `/api`，`setGlobalPrefix('api')` 既有）

**console 侧（新模块 `servers/deploy-console/src/wecom/`）**

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/wecom/oauth/authorize` | 公开 | 302 到企微授权页；`state` = 签名串（含 approvalId + 时间戳，防 CSRF） |
| GET | `/wecom/oauth/callback` | 公开 | 换 `userid` → **调 user-service `identities/resolve`** → 白名单校验 → 签 scope=approve 短令牌 → 302 到 H5 |
| GET | `/wecom/approvals/:id` | scope=approve | 审批单详情（含流水线摘要；**不含日志正文/密钥/内部路径**） |
| POST | `/wecom/approvals/:id/approve` | scope=approve | 通过；prod 必须 `confirm=true`（H5 二次确认后带上） |
| POST | `/wecom/approvals/:id/reject` | scope=approve | 驳回；`comment` 必填（与控制台/MCP 同语义） |
| POST | `/wecom/signed/approvals/:id/approve\|reject` | 签名 URL | A 模式端点，**本轮不注册**（缺可靠身份来源，见卡② 契约 §九） |
| — | `/wecom/callback`（接收消息） | 企微签名 | **二期**，用于卡片按钮原生回调；本期不实现 |

**user-service 侧（新模块 `servers/user-service/src/identity/`）**

见 §5.3.1 ② 的三个 internal 端点。**console 不直接读 `users` 表**，只走这条契约 —— 这是"跨服务打通"的边界。

**短令牌与主 JWT 的边界**：`scope: 'approve'` 的令牌**只能**打上面 3 个 `/wecom/*` 端点，`JwtAuthGuard` 增加 scope 判定；**不得**用它调 `/pipelines/*` 主接口。原因：手机端页面一旦被 XSS 或被劫持，泄露的应是「只能批这一单」的令牌，不是全量控制台权限。

### 5.5 幂等与并发（最容易出事的地方）

| 场景 | 行为 |
|---|---|
| 重复点「通过」 | 第二次命中既有 `status !== 'pending'` → 409；H5 显示「已由 {reviewer} 于 {time} 处理」，**不重放 resume** |
| 控制台与企微同时点 | 两者都走 `ApprovalService.resolve()`；MySQL 单行更新 + 状态前置校验，先到者胜，后到者 409 |
| 流水线已被取消 | `reject/approve` 前先查流水线状态；已 `cancelled/failed` → 409 + 提示「流水线已结束，无需审批」 |
| 同一节点重复挂起（引擎重试） | 既有 `createNode` 幂等复用待决单（`approval.service.ts:98-100`），不动 |
| 点通过后 resume 失败 | 记 `failed` + 通知；**不能**显示「已通过」——审批结果 ≠ 发布结果，H5 要分别呈现 |

### 5.6 交互（H5 页面，见 [`prototype.html`](./prototype.html)）

> ✅ **Design: pass**（2026-11-04 13:47 用户「原型稿设计通过」）
> `Proto: 264782d396050e4637c8e909d212bedf9b2c62104071208bcb8bef7fc15cca7c`（sha256 of `specs/deploy-console-wecom-approval/prototype.html`）
> 实现时逐屏对齐 S1–S5；下表「硬要求」列与原型页脚「刻意做死的四件事」为**验收项，不得优化掉**。

| 屏 | 内容 | 硬要求 |
|---|---|---|
| S1 审批详情 | 大字「待你确认」+ 环境徽标（prod 红/dev 蓝）+ 模块 + 版本 + 分支@commit + 提交人 + 提交时间 + 节点名 + 最近 3 个已完成节点结果 | 首屏**不用滚动**就能看到「哪个环境、哪个模块、什么版本、谁提交的」 |
| S2 通过 | 底部固定双按钮「驳回」/「通过」；prod **必须二次确认**（弹层 + 显示风险文案 + 需输入「确认」或长按 1s） | 一键通过 prod = 设计缺陷 |
| S3 驳回 | 底部抽屉，意见**必填**，预置常用原因（分支错 / 版本错 / 时机不对 / 其他） | 空意见禁用提交 |
| S4 结果态 | ✅「已通过，发布继续」/ ❌「已驳回」+ 返回流水线详情链接 | 明确区分「审批结果」与「发布结果」 |
| S5 无权限 / 已处理 / 链接过期 | 单页冷提示 + 引导「去控制台处理」 | 任何错误态都**不能**给出「可能已生效」的模糊表述 |

移动端页面**独立于 `MainLayout`**（现有布局无响应式，塞进去必崩），路由 `/m/approve/:id`，`meta.requiresAuth: false`（自带 scope 令牌）。

### 5.7 安全

| # | 措施 |
|---|---|
| S1 | 白名单唯一真源仍是节点 `approvers` + `ApproverService` 权限校验；企微只负责「证明是谁」，**不放宽**任何既有校验 |
| S2 | 身份解析失败（`resolve` 返回 null / 账号非 active / 不在白名单）→ `403`，**不创建、不修改**任何单 |
| S2b | 🔴 **新通道禁止降级放行**：既有 `ApproverService` 在 user-service 不可达时是「放行 + 告警」（`approver.service.ts:113-114`）。企微通道**必须 fail-closed** —— 解析不到就拒绝，因为它是唯一身份来源，放行等于谁都能批 prod |
| S3 | OAuth `state` 带 HMAC + 时间戳（10min），防 CSRF / 重放 |
| S4 | scope=approve 短令牌 15min，仅 3 个端点，前端存 `sessionStorage` 不落 `localStorage` |
| S5 | prod 审批二次确认（H5 层）+ 后端 `confirm=true`（沿用 MCP 口径） |
| S6 | 审计必落：`channel`、`identityExternalId`、`sourceIp`、`comment`；失败也落 |
| S7 | 企微 `secret` 与 `INTERNAL_API_KEY` 只经配置中心注入 `process.env`，日志与错误信息**不打印** token/secret |
| S8 | 降级纪律：企微不可达 → 推送失败只记 `delivery.wecom=failed`，流水线照旧挂起等人工（与现状一致） |

### 5.8 出站安全：企业可信IP（与可信域名正交）

> 新自建应用**不配可信IP，调任何企微接口都报 60020**（含应用消息 `message/send`）。可信域名只管入站，管不了这一侧。
> 完整规范见 [`docs/development/wecom-api-trusted-ip.md`](../../docs/development/wecom-api-trusted-ip.md)。

| 方向 | 机制 | 本方案落点 |
|---|---|---|
| 企微 → console（入站） | **可信域名** `dev.kedouai.com` | OAuth 网页授权、OAuth 回调（§5.4 `/wecom/oauth/*`） |
| console → 企微（出站） | **企业可信IP** = dev 机固定出口 IP `175.27.189.123` | 应用消息推送（§5.1 ①）；OA 审批 `oa/*` 本期不做 |

**硬要求**：

- dev 机**固定出口 IP**（绑 EIP 或 NAT 网关）；白名单只填这一个，永不因动态 IP 变更而失效。
- 本地联调**不把本地动态 IP 加白**：走 SSH 隧道 / SOCKS 借 dev EIP，或用 mock；详见规范 §五。
- 排查 60020 用报错里的 `from ip:` 或企微「access_token 权限查询」工具，定位「token 属于哪个应用、该把 IP 配到哪个应用」；配完 **1 分钟**生效。

网络流程图与时序图 → [`tech-design-network-and-sequence.md`](./tech-design-network-and-sequence.md)

---

## 六、验收判据（研发交付必须逐条给证据）

| # | 验证项 | 怎么验 | 通过标准 |
|---|---|---|---|
| V1 | 挂起 60s 内企微收到待办 | 造一条含 approval 节点的流水线，跑到挂起 | 白名单成员企微收到应用消息，正文含环境/模块/版本/节点 |
| V2 | 卡片链接在企微内置浏览器可打开且**免登** | 手机企微点链接 | 直接进 S1，无需输账号密码 |
| V3 | 非白名单 userid 被拒 | 用未映射的企微账号打开同一链接 | HTTP 403 页面；`deploy_approvals.status` 仍 `pending`；审计有拒绝记录 |
| V4 | 通过后从节点之后续跑 | 点「通过」 | 日志出现「审批通过…继续执行」；已完成节点**不重跑**；流水线最终 succeeded |
| V5 | 驳回必填意见且终止 | 不填意见点提交 → 填后提交 | 空意见时按钮禁用/后端 400；驳回后流水线 `rejected`，后续节点不执行 |
| V6 | 重复点击幂等 | 连点两次「通过」 | 第二次 409 并提示「已由 X 于 Y 处理」；`resume` 只发生一次 |
| V7 | 控制台与企微交叉并发 | 两端同时点（一端通过一端驳回） | 仅一个生效，另一个 409；审批单状态与流水线状态自洽 |
| V8 | prod 二次确认 | 对 prod 单点「通过」 | 出现确认层；未确认不发请求；后端无 `confirm=true` 直接 400 |
| V9 | 链接过期 | A 模式，等 TTL 过期后打开 | 401/410 冷提示，可「重新从企微进入」 |
| V10 | 审计可追溯 | 查 `audit` 表/日志 | 有 `channel=wecom`、`identityExternalId`、`sourceIp`、意见 |
| V11 | 企微不可用不阻塞发布 | 配错 secret 后跑流水线到挂起 | 推送失败仅告警；流水线正常挂起；控制台仍可审批 |
| V12 | 总开关关闭后完全回到现状 | `WECOM_APPROVE_ENABLED=0` 重启 | 无企微相关调用；控制台/MCP 审批回归用例全绿 |
| **V13** | **身份解析四渠道语义正确** | 造 4 组数据调 `/internal/identities/resolve`：① 正常企微 id ② 停用账号 ③ 未绑定 id ④ 已合并账号 | ①返回 `userId+username+systems` ②③ 返回 `data:null`（**不 500、不 404**）④ 返回存活账号且带 `mergedFrom` |
| **V14** | **跨服务解析不可达时 fail-closed** | 停掉 user-service 后用企微打开审批链接 | 403 冷提示「身份服务不可用，请去控制台处理」；**绝不**放行；审批单仍 pending |
| **V15** | **`users` 加列迁移在 dev/prod 均生效** | dev/prod 各执行一次迁移 + `SHOW COLUMNS FROM users LIKE '%wecom%'`、`LIKE 'unionid'` | 两环境都有列且索引存在；服务重启后列**不被 synchronize DROP** |
| **V16** | **mp/oa 渠道解析可直接复用** | 用现网一条 `mp_openid` 数据调 resolve（`channel=mp`） | 返回正确用户；证明未来小程序接审批**不需要再动身份层** |

**回归集**：`pipeline/node-approval.spec.ts`、`approval/approval.service.spec.ts`、`mcp/mcp.controller.spec.ts`、`user/user.service.spec.ts` 必须全绿；新增 `identity/identity.service.spec.ts`（合并跟随、停用拒绝、unionid 兜底、未绑返回 null 四类）+ `wecom/wecom-approval.service.spec.ts`（白名单拒绝、幂等、prod confirm、token 过期四类）。

---

## 七、工作量与排期（拆两张卡）

> 为什么拆：职责说明书 §3.4.1 定「M ≤ 2 日，L 必须拆」。跨服务打通后整体 ≈3.5 人日，**超 M 定义**，按纪律拆成两张各自 ≤2 日的卡。

### 卡 ①「统一外部身份层」（user-service + shared，≈1.5 日）

| 任务 | 内容 | 估档 | 判据 |
|---|---|---|---|
| T1-a | `packages/shared` User 实体加 `wecom_userid` / `unionid` 两列（含 `@Index`） | S | 类型编译通过；实体与迁移一致 |
| T1-b | 迁移脚本 `migrations/00XX_users_wecom_identity.sql`（ADD COLUMN + 索引，可回滚） | S | V15 |
| T1-c | `identity` 模块：`resolve` / `bind` / `unbind` 三接口（`InternalGuard`，`x-internal-key`） | M | V13 |
| T1-d | 合并账号跟随 + 停用/封禁拒绝 + unionid 兜底（R-a/b/c） | S | V13 的 ②③④ |
| T1-e | 单测 `identity.service.spec.ts`（四类边界） | S | 回归集全绿 |

### 卡 ②「console 企微审批通道」（≈2 日）

| 任务 | 内容 | 估档 | 判据 |
|---|---|---|---|
| T2-a | 配置项 + 开关 + 启动自检（缺 `CONSOLE_PUBLIC_BASE_URL` 拒绝启用） | S | V12 |
| T2-b | 企微 `access_token` 缓存（7200s，提前 5min 刷，并发加锁）+ 应用消息推送（异步，失败不抛） | M | V1、V11 |
| T2-c | OAuth authorize/callback + 调 `identities/resolve` + scope=approve 短令牌 + Guard | M | V2、V3、V9、**V14** |
| T2-d | 审批详情/通过/驳回 3 端点（复用 `PipelineService`）+ `deploy_approvals` 加 3 列 | M | V4、V5、V6、V8、V10 |
| T2-e | H5 移动端 5 屏（S1–S5，按 Design: pass 原型） | M | 原型逐屏对齐；prod 二次确认 |
| T2-f | 单测 + 回归 + 真机走查（安卓/iOS 企微各一次） | S | §六 全绿 |

**合计：卡① 1.5 日 + 卡② 2 日 = 3.5 人日。**

**前置（非研发工时，Q4 已定「建」）**：

1. 企微管理后台 → 应用管理 → 自建 → 创建应用，记下 `AgentId`、`Secret`（录入 `~/env_config/wecom.env`，经 `scripts/import-wecom-env.ts` 进配置中心，不落代码库）
2. 应用 → 「网页授权及JS-SDK」→ 可信域名填 `dev.kedouai.com` → 下载 `WW_verify_xxx.txt` 放站点根目录（nginx 加一条精确匹配 `location = /WW_verify_xxx.txt`）
3. 应用「可见范围」加入审批人（你本人）
4. 🔴 应用详情 →「企业可信IP」→ 填 **dev 机公网出口 IP `175.27.189.123`**（配完 1 分钟生效）。**新自建应用不配可信IP 则调任何接口都报 60020** —— 应用消息推送（§5.1 ①）属出站调用，全被它拦；OA 审批 `oa/*` 本期不做，未来若接同样受此限制。详见 [`docs/development/wecom-api-trusted-ip.md`](../../docs/development/wecom-api-trusted-ip.md)
5. `CONSOLE_PUBLIC_BASE_URL=https://dev.kedouai.com/console` 写进 console 环境

---

## 八、风险与回滚

| # | 风险 | 影响 | 缓解 / 回滚 |
|---|---|---|---|
| R1 | console 单点在 dev，dev 挂 → 企微审批失效 | 审批退化到「回控制台」 | 既有架构上限，不因本需求变差；控制台/MCP 通道保留 |
| R2 | 企微可信域名校验文件放不进 `dev.kedouai.com` 根目录 | OAuth 走不通 | 退 `WECOM_APPROVE_MODE=signed-link`（A 模式），当天可用 |
| R3 | `WECOM_SECRET` 轮换 / **企业可信IP 变更**（dev 换 IP、容器 / Serverless 出口漂移）导致推送全失败（60020） | 收不到待办 | dev 机绑固定 EIP / NAT 出口、白名单只填这一个；`delivery.wecom=failed` 可见；总开关 `=0` 一键回到现状 |
| R4 | 移动端页面与桌面布局耦合导致样式崩 | 体验 | 独立路由 + 独立样式，不复用 `MainLayout` |
| R5 | 并行会话正在改 `MainLayout.vue` / `router/index.ts` | 冲突 | 新页面只**追加**一条路由，不动布局；开工前认领文件面 |
| R6 | 企微应用可见范围不含审批人 → OAuth 拿不到 userid | 免登失败 | 配置检查清单纳入 T2-f 真机走查 |
| R7 | 两处迁移加列历史行失败 | 启动失败 | 全 `nullable` 无默认值冲突；迁移可回滚（drop column） |
| **R8** | 🔴 **改 `packages/shared` User 实体，多服务共用** | auth/user/todo 等所有 import 方编译与运行时都受影响 | 只**加**两列、不动既有字段；发布顺序：迁移先于服务重启；本机 synchronize=true 会反向对齐，**必须先写迁移再登记实体** |
| **R9** | 🔴 **生产 `synchronize=false`，漏做手工 DDL** | 线上缺列 → resolve 报 SQL 错 → 审批全挂 | T1-b 交付物里必须含「dev/prod 各执行一次」的清单与证据（V15）；缺一不算完成 |
| **R10** | 账号合并（`merged_to`）未跟随 | 合并过的账号"查无此人"，表现为有权限却 403 | 硬规则 R-a，单测覆盖（V13 ④） |
| **R11** | 身份层被其他服务误用成「鉴权总开关」 | 权限边界模糊 | 契约只回答「这个外部 id 是谁」，**不回答「他能干什么」**；权限判定仍归各服务 |

**一键回退**：`WECOM_APPROVE_ENABLED=0` + 重启 console。DB 新增列保留（旧代码不读即无影响）。

---

## 九、开放问题（已全部结案）

| # | 问题 | 结论 |
|---|---|---|
| Q1 | 走哪条路径 | **B**（自建应用 + OAuth 免登 H5），A 作应急回退 |
| Q2 | 审批映射落哪 | **跨服务打通**：users 加列 + user-service 统一解析契约（见 §5.3） |
| Q3 | 审批人数 | **接受单人**（你），不做或签 |
| Q4 | 建不建企微自建应用 | **建**（前置五步见 §七） |
| Q5 | 身份存放方式 | **users 加列**（`wecom_userid`+`unionid`），不建独立表 |
| Q6 | 一人多公众号/小程序 | **以后再说**（`oa_openid` 单列是既有限制，非本次引入） |

**剩余待定：无。** 剩下要动的都是执行项（企微后台五步前置、真机走查），不是"待拍板"。

---

## 十、研发接单卡

```
【卡①】统一外部身份层（user-service + packages/shared）
优先级：P1（亦可降 P2 单独提前做，它是基础设施，不依赖企微）
估档：M（≈1.5 人日，T1-a ~ T1-e）
落点：packages/shared/src/entities/user.entity.ts
      servers/user-service/src/identity/（module/controller/service/dto）
      servers/user-service/migrations/00XX_users_wecom_identity.sql
契约：POST /internal/identities/{resolve,bind,unbind}，InternalGuard + x-internal-key
不动：users 既有字段、auth-service 登录链路、mp_openid/oa_openid 语义
硬规则：合并账号跟随 / 停用拒绝 / unionid 只做兜底（§5.3.1 R-a/b/c）
验收：V13、V15、V16 + identity.service.spec.ts 四类边界
风险：R8、R9、R10、R11 —— 生产 synchronize=false，迁移必须手工执行（V15 证据）
```

```
【卡②】console 企微审批通道（B 方案 · OAuth 免登 H5）
优先级：P1
估档：M（≈2 人日，T2-a ~ T2-f）
落点：servers/deploy-console/src/wecom/  +  apps/deploy-console/src/views/m/ApproveMobile.vue
不动：MainLayout.vue（只追加 1 条路由）、PipelineService 审批逻辑（只调用）
交付物：Design: pass 已具备（prototype.html，sha256 264782d3…5cca7c）
前提：企微自建应用已建（Q4）+ 可信域名校验文件可放 + 可信IP 已配 + CONSOLE_PUBLIC_BASE_URL
验收：V1–V12、V14 逐条证据 + §六 回归集全绿 + 真机走查
发布：console 手动发布（scripts/publish-deploy-console.sh），不走流水线自发布
```

---

## 附：为什么这需求值得做（一句话）

现在的 prod 门禁是**真的门禁**，但它把人**焊在电脑前** —— 门禁越有效，人越不敢离开工位。
企微审批不是放松门禁，是把「谁在什么时候按的」这条链从桌面搬到手机，**门禁强度不变，响应速度从小时级降到分钟级**。
