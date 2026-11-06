> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
> 定位：卡①「统一外部身份层」的**接口契约与交付物定义**（写码前的流程凭证，卡② 依赖的唯一契约真源）。

# 统一外部身份层 · 接口契约与交付物定义（卡①）

> 归属需求：[`specs/deploy-console-wecom-approval/design.md`](../../specs/deploy-console-wecom-approval/design.md) §5.3 / §七 卡①（决策依据见同目录 `decision.md` §二）
> 开工：2026-11-05 21:5x（用户点名「企业微信只是审批的功能优先开工继续」，解除 11-04「等 CDN 改造」暂停）
> 本文件是写码前的**流程凭证**，也是卡② 依赖的唯一契约真源。改动契约先改本文件再改代码。

---

## 一、一句话与边界

把「某个外部渠道 ID 是谁」这件事收成 user-service 的**一条内部契约**；console 不直连 `users` 表，未来小程序/公众号复用同一入口。

**本契约只回答「是谁」，不回答「他能干什么」** —— 权限判定仍归各服务（deploy-console 的 `ApproverService` 白名单不变）。这条边界不得被「顺便统一一下鉴权」抹掉（需求 spec R11）。

## 二、认领文件面（多会话防冲突）

| 文件 | 动作 |
|---|---|
| `packages/shared/src/entities/user.entity.ts` | 加 `wecom_userid` / `unionid` 两列（含具名索引） |
| `migrations/0028_users_wecom_identity.sql` | 新增，幂等，仅 `web_system` 主库 |
| `servers/user-service/src/identity/*` | 新增 module / controller / service / spec |
| `servers/user-service/src/app.module.ts` | 仅追加 1 个 import + 1 个 module 注册 |

**不动**：`MainLayout.vue`、`router/index.ts`、`PipelineService`、auth-service 登录链路、`mp_openid`/`oa_openid` 语义、`ApproverService` 降级策略。
**工作树**：`~/workspace/web_system-wecom`（`feature/wecom-approval-identity`，基于 `origin/master 791eb6d1`）—— 与主工作区 `feature/nce-lessons`（NCE WIP）物理隔离。

## 三、接口契约（前缀 `/internal`，`x-internal-key: INTERNAL_API_KEY`）

| 方法 | 路径 | 入参 | 出参 |
|---|---|---|---|
| POST | `/internal/identities/resolve` | `{ channel:'wecom'\|'mp'\|'oa', externalId, unionId? }` | `{ code:0, data: ResolvedIdentity \| null }`；查无返回 `data:null`（**不是 404/500**） |
| POST | `/internal/identities/bind` | `{ userId, channel, externalId, unionId?, operator }` | `{ code:0, data:{ bound:true } }`；该渠道 id 已绑他人 → 409 |
| POST | `/internal/identities/unbind` | `{ channel, externalId, operator }` | `{ code:0 }` |

`ResolvedIdentity = { userId, username, nickname?, roles[], systems[], mergedFrom?: {userId, username} }`

## 四、resolve 三条硬规则（spec §5.3.1）

| # | 规则 | 反例 |
|---|---|---|
| R-a | 命中行 `merged_to` 非空 → 递归解析到存活账号，出参带 `mergedFrom`；环/断链/超过 8 跳一律返回 `null` | 合并过的账号「有权限却 403」 |
| R-b | `status !== 'active'` → 解析失败（`null`） | 停用/封禁账号还能批 prod |
| R-c | `externalId` 命中即返回；`unionId` **只在未命中时兜底**，不得覆盖精确命中 | 用 unionid 把精确命中的人换成另一个人 |

渠道列映射：`wecom → wecom_userid`、`mp → mp_openid`（已有列）、`oa → oa_openid`（已有列）；`unionId → unionid`。
一期三渠道全部实现解析（mp/oa 的列本来就在，零额外成本），console 只用 `wecom`。

## 五、交付物定义

1. shared 实体加 2 列 + `migrations/0028`（具名索引与实体一致，防 synchronize 抖动）
2. identity 模块三接口 + `InternalGuard` + 三条硬规则
3. `identity.service.spec.ts` 覆盖 V13 四类边界 + mp/oa 复用 + 合并环 + bind 冲突
4. 类型检查 + 定向单测全绿 + **变异验证**（改动 R-b 后对应用例必须变红）

## 六、验证判据（对齐 spec §六）

| # | 判据 | 本轮状态 |
|---|---|---|
| V13 | 四渠道语义：正常 / 停用 / 未绑 / 已合并账号 | 单测覆盖 |
| V15 | dev/prod 各执行一次 0028，`SHOW COLUMNS` 有列与索引；服务重启列不被 synchronize DROP | 🔴 **未执行 DDL**（生产手工变更，须用户放行 + prod 跳板） |
| V16 | 用现网 `mp_openid` 调 resolve(`channel=mp`) 返回正确用户 | 单测覆盖；真库待验 |
| V14 | user-service 不可达时企微通道 fail-closed | 卡② 责任，本卡不涉及 |

## 七、明确不做（防范围膨胀）

- 不建身份绑定管理页面（一期 internal 接口/命令绑定一次）
- 不改 `ApproverService` 的降级放行（独立卡）
- 不做审批单过期、不做多级审批、不做企微 OA 审批对接
- 不实现 console 企微通道（卡②）
- 本轮不 commit / 不 push / 不发布 / 不执行任何 DDL
