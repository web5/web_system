# 契约草案 · 企微审批鉴权与时效（v2 增补）

> 2026-11-06 20:24 · 对应产品需求 `30-任务产物/2026-11-05-console企微审批开工/14-票据兑换整合进审批流-技术产品方案.md` §十 / §十一
> 状态：**§1–§6 全部已落代码（2026-11-06 20:55），未部署**；DDL 脚本
> `servers/deploy-console/scripts/0031_deploy_approvals_lifecycle.sql` 待 dev 库执行
> 涉及系统：`deploy-console`（唯一）；**prod 不涉及**（用户 11-06 明确）

## 1. 界面契约：S4 详情态审批前入口（已实现）

| 项 | 契约 |
|---|---|
| 元素 | `<button class="more">查看完整流程 →</button>` |
| 位置 | `.card`（含 `h4=最近节点`）内、`ul.steps` 之后 |
| 行为 | `goRun()` → `window.location.href = /console/m/approve/:id/run` |
| 凭据 | **不带** `?ticket=`；S5 从 `sessionStorage['wecom-approve-ticket:<id>']` 取 |
| 尺寸 | `min-height: 44px`（iOS 触控底线） |
| 作用域 | 仅 `screen === 'detail'`；结果态与错误页不得出现 |

S5 顶栏同步改为 `企业微信 · 发布流程`（服务审批前 / 审批后双入口）。

**无新增端点、无新增权限** —— 复用既有 `GET /wecom/approvals/:id/run`。

## 2. 接口契约变更

### 2.1 `POST /wecom/approvals/:id/session`（语义变更）

从「一次性」改为「有限次」：

| 场景 | 改前 | 改后 |
|---|---|---|
| 首次换取 | 200 + `{token, user, expiresInSec:1800}` | 不变 |
| 第二次换取（同单） | **409** 该审批单的会话已换取过 | 200（第 2/3 次） |
| 第 4 次 | 409 | **409** `该审批单的会话次数已用尽（3/3）` |
| 票据写窗口 | 15min | **不变**（仍是 POST → `exp`） |

**窗口不变的依据**：重新点企微卡片会走完整 OAuth 并签**新票据**，因此「超时后重连」的路径是「重新进卡片」而不是「延长旧票」。

### 2.2 其余端点

`GET /approvals/:id`、`GET /approvals/:id/run`、`POST .../approve`、`POST .../reject` 契约**全部不变**。

## 3. DDL（仅 `deploy_console` 库）

**脚本**：`servers/deploy-console/scripts/0031_deploy_approvals_lifecycle.sql`（幂等，可重复执行）。

幂等，可重复执行；两列均带注释与默认值，兼容 `synchronize` 抖动。

```sql
-- 1) 会话次数护栏：从「永久一次」改为「≤3 次」
ALTER TABLE deploy_approvals
  ADD COLUMN IF NOT EXISTS wecom_session_count INT NOT NULL DEFAULT 0
  COMMENT '企微换平台会话已用次数（上限 3）';

-- 2) 已换过会话的历史单不得白捡 3 次
UPDATE deploy_approvals SET wecom_session_count = 1
 WHERE wecom_session_issued_at IS NOT NULL AND wecom_session_count = 0;

-- 3) 审批单过期时刻（NULL = 不过期，仅供新单写入；历史单不回填）
ALTER TABLE deploy_approvals
  ADD COLUMN IF NOT EXISTS expires_at BIGINT NULL
  COMMENT '审批单超时作废时刻（毫秒；NULL=不过期）';
```

**回填策略（关键）**：`expires_at` **不回填历史行**。若回填，上线瞬间会把一批在途 pending 单按「已过期」清掉。

## 4. 原子性与回滚

### 4.1 占位（防并发重复兑换）

```sql
UPDATE deploy_approvals
   SET wecom_session_count = wecom_session_count + 1,
       wecom_session_issued_at = ?
 WHERE id = ? AND wecom_session_count < 3
```

`affectedRows !== 1` → 409。**不先查后写**。

### 4.2 回滚

签平台会话失败时：

```sql
UPDATE deploy_approvals
   SET wecom_session_count = wecom_session_count - 1
 WHERE id = ? AND wecom_session_count > 0
```

否则这张单会被白扣一次配额（原实现只回滚 `wecom_session_issued_at`）。

## 5. 审计契约

| action | 时机 | detail 必含 |
|---|---|---|
| `wecom.session` | 每次成功换取 | `第 N/3 次`、`channel=wecom`、`identityExternalId`、`sourceIp`、`approvalId` |
| `wecom.viewRun` | 同单 5min 内**首条** + `pipeline.status` 变化时 + 超窗后的新查看 | 原有字段 + 去重标记 `dedup=first` / `dedup=status-changed` / `dedup=refreshed` |
| `approval.expire` | 超时作废 | 单号、env、moduleKey、`createdAt`、`expiresAt`、已超时小时数、`pipelineId`、流水线是否联动取消 |

**去重实现边界**：进程内 `Map<approvalId, {ts, status}>`，TTL 5min，容量上限 500。console 单实例 pm2 成立；多实例部署时必须改 DB/Redis（**本轮不做，写进注释**）。

## 6. 超时作废

| 项 | 值 |
|---|---|
| 默认时长 | `createdAt + 7 天`（`APPROVAL_TTL_MS`） |
| 扫描周期 | 15 分钟（`APPROVAL_EXPIRY_INTERVAL_MS`） |
| 选取条件 | `status = 'pending' AND expires_at IS NOT NULL AND expires_at <= ?` |
| 作废动作 | `PipelineService.cancel(approval.pipelineId, 'system', '审批超时作废（…）')` |
| 兜底 | cancel 未联动关单（流水线已终态 / 抛错）时补 `ApprovalService.cancel(approval.id, …)`，否则单子每轮都被扫到、永远清不掉 |
| 失败处理 | 单条失败只记 warn，不中断整批；下轮重试 |

🔴 **参数陷阱**：`PipelineService.cancel` 的第一个参数是 **`pipelineId`**，不是审批单 id
（本文件 20:24 版本写成 `cancel(approvalId, …)` 是笔误）。传错会 cancel 不存在的流水线，
`get()` 抛 404 被 catch 吞成 warn，表面上「跑过了」但什么都没作废。
`approval-expiry.service.spec.ts` 有一条断言专门钉这个参数。

**禁止**另写一套作废 SQL。既有 `PipelineService.cancel` 已含：CAS `WHERE status='pending'`、流水线 `awaiting-approval → cancelled` 联动、`approval.cancel` + `pipeline.cancel` 双审计。

**调度实现（2026-11-06 定）**：**不引入 `@nestjs/schedule`**。`consistency-watch.service.ts`
顶部已有明文否决（「一个 interval 就够，没必要为一个定时任务加依赖」），仓内已有 3 处
`setInterval + OnModuleInit + unref`。新增 `ApprovalExpiryService` 沿用同范式，落在
`src/reconcile/`（与那三处同目录，且能合法 import `PipelineModule` 而不成环）。
开关：`APPROVAL_EXPIRY_ENABLED=0` 或 `APPROVAL_EXPIRY_INTERVAL_MS=0`。

## 7. 验收条款

| 编号 | 判据 | 手段 | 状态（2026-11-06 20:55） |
|---|---|---|---|
| L1 | 详情态有入口，结果态 / 错误页没有 | puppeteer（`scripts/s4-run-entry.mjs`） | ✅ 16/16 |
| L2 | 入口在卡内、列表后、footer 上；触控 ≥44px；320 不溢出 | 同上，几何断言 | ✅ |
| L3 | 点击后 `location.search` 不含 `ticket=` | 同上（记 `isNavigationRequest()` 原始 URL） | ✅ |
| L4 | 第 1–3 次换会话成功、第 4 次 409 | jest | ✅ 有状态假 DB，真加真减 |
| L5 | 签发失败后 `count` 回退，配额不被白扣 | jest | ✅ 回退到 0 且下次仍是第 1/3 次 |
| L6 | 已换过会话的老单 `count=1` | 迁移后 SQL 断言 | ⏳ DDL 脚本自带校验查询，待 dev 库执行 |
| L7 | 过期 pending 单被作废且流水线同步终止 | jest（注入时钟） | ✅ 含「流水线已终态」兜底分支 |
| L8 | `expires_at IS NULL` 的老单不被扫描到 | jest | ✅ 条件为 `lessThanOrEqual(now)`，NULL 不命中 |
| L9 | 5min 内 3 次 run 只记 1 条；status 变化额外记 1 条 | jest | ✅ 另含 `refreshed` 与跨单隔离 |
| L10 | 原有 123 例全绿 | jest 全量 | ✅ 全量回归见提交说明 |

## 8. 回滚方案

| 改动 | 回滚 |
|---|---|
| S4 入口 | 删 `<button class="more">` 与 `.more` 样式，无数据影响 |
| 会话次数 | 代码回退即可；`wecom_session_count` 列留着不读不写（`wecom_session_issued_at` 语义恢复为「非空=换过」） |
| 超时作废 | 关掉调度即可；`expires_at` 列留着不读，行为回到「永不过期」 |
| 审计去重 | 去掉 Map 判断即恢复逐次记录 |
