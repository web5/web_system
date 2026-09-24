阻塞: 0
重要: 2

# 契约评审 · 服务监控取数改以主机管理为真相源

- 评审角色：`contract-reviewer`（独立第三方；判据源 `docs/api/contracts.md`）
- 变更范围：PR #167 已合入的后端改动（`99c80f1` 及后续三个探活修复）+ 迁移 `0014_deploy_host_scope.sql`
- 契约类别：**C1 对外 HTTP 接口**（`servers/deploy-console/src/monitor/monitor.controller.ts`）+ 数据结构（`deploy_hosts`）
- 结论：**⚠️ 有条件通过**（阻塞 0 / 重要 2）

---

## 1. 消费方清单（grep 证据，非变更方自辩）

| 消费方 | 位置 | 用了什么 |
|---|---|---|
| 控制台前端 · 服务监控页 | `apps/deploy-console/src/views/ServiceMonitor.vue`（6 处） | `monitorApi.health / pm2 / logs / localHealth / localPm2 / localLogs`，页签硬编码 `local/dev/prod` |
| 控制台前端 · 自助诊断页 | `apps/deploy-console/src/views/DiagnoseCenter.vue`（7 处） | `monitorApi.pm2 / localPm2 / port / restart / searchLogs` |
| 控制台前端 · API 层 | `apps/deploy-console/src/api/index.ts`（12 处） | `monitorApi.*` 全部方法 |
| 控制台前端 · 菜单 | `apps/deploy-console/src/layouts/MainLayout.vue` | 仅路由入口 `/monitor`（无契约耦合） |
| gateway 动态路由 | `servers/gateway/src/dynamic-route/*` | 读 `deploy_hosts` 的 `name/host`；**grep 确认未引用 `scope` / `managed_by`** |

> 其它服务（auth / user / ai-* 等）与小程序端**不消费** `/monitor/*` —— grep `/monitor` 全仓仅命中上述文件。

---

## 2. 逐条变更与影响

### ① 新增 `GET /monitor/envs`（可管环境列表）

- 类别：C1 新增端点；**纯新增，无存量消费方** → 无破坏性。
- 判据：`contracts.md` §7.1（先判影响面）/ §7.3（机检 R13）。
- 反例：无（不存在"某消费方静默失效"路径）。

### ② 新增 `GET /monitor/pm2/hosts?env=`

- 同上，纯新增；返回 `{hosts:[{name,host,scope,runtime,ok,error?,tookMs,procs}]}`。
- 旧端点 `/monitor/pm2` **保留扁平结构**，消费方（`ServiceMonitor.vue` / `DiagnoseCenter.vue`）不受影响 —— 这一点是刻意的兼容设计，不要在后继改造里顺手删掉。

### ③ `GET /monitor/health` 响应**新增** `hostName` / `error` 字段

- 加字段：向后兼容。前端只读 `service/address/status/response/responseTime`，新增列不影响。
- 探活路径由 `/` 改为 `/health`：已随 master（PR #166）的后端 health 端点落地；未实现 `/health` 的服务返回 404，按既有口径（任意状态码即视为在监听）仍判 `up`。
- 反例：若将来有消费方把 `200` 当作唯一健康判据 → 会误判；**当前无此消费方**（前端只渲染 tag）。标记为建议项。

### ④ ⚠️ `GET /monitor/pm2?env=<不可管环境>` 由「返回数据」变为 **502** —— **破坏性变更**

- 触发：环境在 `deploy_hosts` 里没有「可解析且归属本控制台」的主机（本次典型场景 = dev 控制台请求 `env=local`，`local-default.managed_by='orchestrator'`）。
- 消费方：`ServiceMonitor.vue` 的「本地」页签（页签仍是硬编码的，尚未改为 `/monitor/envs` 驱动）。
- **中间态（重要 · 非阻塞）**：后端已合入、前端未改造前，dev 控制台点「本地」会弹「获取 PM2 进程失败」。
- 为什么不判阻塞：契约评审关心的是**静默失效**；此处是**显式报错**（502 + 明确文案「环境 local 在「主机管理」中…」），不静默、可诊断。
- 迁移路径：前端页签改由 `GET /monitor/envs` 驱动（不可管环境不再出现，也就不会发起请求）—— 已在下一步 UI PR 实施。
- 判据：`contracts.md` §7.5（破坏性变更必须写消费方清单）—— 本条即清单。

### ⑤ `deploy_hosts` 新增 `scope` / `managed_by`（有默认 / 可空）

- 加列：向后兼容。gateway 只读 `name/host`（grep 证据见 §1），不读新列 → 不受影响。
- 迁移文件在仓库根 `migrations/`（**不是** `scripts/migrations/`，后者放 .mjs 脚本），已按 `apply-migrations.sh` 口径应用并记账（本机库 + dev 云库）。

### ⑥ 新增部署期必配项 `CONSOLE_INSTANCE`（缺失即启动 FATAL）

- 属"运行契约"变更：每份控制台 `.env` 必须显式写实例标识，**无默认值**。
- 已完成：本机（workspace + release 目录）= `orchestrator`；dev 控制台 = `dev`。
- 判据：`contracts.md` §4（变更纪律：新增前先明确消费方与迁移路径）；与 `CONFIG_MASTER_KEY`、SSH 私钥同属部署期 provision 三件套。
- 建议：其它环境若新增 deploy-console 实例，建实例前先补齐这三项，否则启动即崩。

---

## 3. 重要项（不阻塞，须跟进）

| # | 事项 | 判据 | 处理 |
|---|---|---|---|
| **I1** | 中间态：前端未同步前 dev 控制台「本地」页签报 502 | `contracts.md` §7.5 | 前端页签改由 `/monitor/envs` 驱动（下一步 UI PR）；**后端与前端不要隔太久** |
| **I2** | 新接口未登记进 `specs/deploy-console/api-design.md` | `contracts.md` §7.2（先文档后实现） | 随本次补登记（`/monitor/envs`、`/monitor/pm2/hosts`、`/monitor/health` 增字段） |

## 4. 建议（无判据，属个人偏好，可驳回）

1. `/monitor/health` 的 `error` 字段建议前端必渲染（顶部横幅已纳入原型），否则"SSH 不通"仍会被误读成"服务挂了"。
2. 未来若 `/monitor/pm2`（扁平）确认无消费方，再单独走一次删除的契约评审，不要与新接口改造混在一起。
