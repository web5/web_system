阻塞: 0
重要: 1

# D3 实现一致性评审 · 服务监控页（`ServiceMonitor.vue`）

- 关口：**D3**（落码后、人审前）
- 被审物：`apps/deploy-console/src/views/ServiceMonitor.vue`、`api/index.ts`、`views/DiagnoseCenter.vue`
- 已确认原型：`docs/ui/prototypes/deploy-console-domain.html` 屏 `dc-monitor`（sha `5140104`）
- 判据源：`specs/deploy-console-domain-split/page-spec.md` §6.1、`docs/ui/design-system.md`
- 结论：**✅ 通过**（阻塞 0 / 重要 1）

---

## 1. 锚点比对（原型 `data-dr` ↔ 实现）

| 锚点 | 原型 | 实现 | 判定 |
|---|---|---|---|
| `monitor-tabs` | 页签来自 `/monitor/envs`；dev=DEV/PROD，本机=本地/DEV/PROD | `a-tabs` 由 `monitorApi.envs()` 渲染，无硬编码 | ✅ 一致 |
| `monitor-banner` | 顶部 `Alert` error + 真因 + 重试 / 去主机管理 | `a-alert type="error"` + `bannerError` + 重试 + `router-link /hosts` | ✅ 一致 |
| `monitor-health-table` | 服务/主机/地址/状态/响应/响应时间/操作 | 同 7 列；失败行 `error` 走 tooltip | ✅ 一致 |
| `monitor-pm2-groups` | 按主机分组，分组头 = 组名·地址·运行时·进程数·取数耗时；失败组仍出现 | `a-collapse` 分组；失败组 `a-alert` 给真因 + 重试 + 去主机管理 | ✅ 一致 |
| `monitor-autorefresh` | 10 秒开关 + 手动刷新 | `a-switch` + 手动刷新按钮 | ✅ 一致 |
| （原型场景⑤空态） | 整页空态 + primary「去主机管理登记」 | `a-empty` + primary 按钮 → `/hosts` | ✅ 一致（本轮补齐） |

## 2. 已修正的漂移（评审中发现，已改）

1. **空态缺恢复入口**：初版 `a-empty` 只有文案、无按钮 → 违反清单「状态矩阵：唯一恢复入口」→ 已补 primary「去主机管理登记」。
2. **分组头缺 `scope`**：原型分组头含形态（local/cloud/container），初版只显示 `runtime` → 已补。
3. **单主机未弱化**：已确认口径是「分组头保留但弱化」，初版与多主机同款 → 已加 `.mon-single`（弱化内边距与字色，**不用 `!important`**，符合 ui-interface 规则）。

## 3. 重要项（不阻塞）

| # | 事项 | 判据 | 处理 |
|---|---|---|---|
| **I1** | 后端已合入、前端本次才合入的**中间态**里，dev 控制台旧页签「本地」会报 502（显式错误，不静默） | 契约评审 `docs/api/reviews/monitor-env-scope-20260924.md` I1 | 本 PR 合入即消除；**后端与前端不要隔太久** |

## 4. 建议（无判据，属个人偏好，可驳回）

1. PM2 分组头可考虑把 `scope` 做成 tag 颜色（cloud/container 区分色），目前统一中性 tag。
2. 横幅在自动刷新连续失败时可不重复弹 toast，只在横幅更新时间戳 —— 当前已满足（不弹 toast，只更新横幅）。
