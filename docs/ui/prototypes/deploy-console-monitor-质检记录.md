# 质检记录 · 服务监控屏（dc-monitor）

> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on

- 原型：`docs/ui/prototypes/deploy-console-domain.html` 屏 `dc-monitor`（本稿由 `deploy-console-domain-split.html` 统一更名而来）
- 方案 / 事实源：`docs/development/console-monitor-followups.md`
- 页面规格：`specs/deploy-console-domain-split/page-spec.md` §6.1（新增）/ §6（主机管理增列）
- 质检方式：`ux-prototype-designer` 独立交互质检清单（references/ux-review-checklist.md）逐条自检 + Playwright DOM 断言五个场景的状态矩阵

## 结论

**通过（带 4 条遗留项，见下）**——交用户确认。

## 逐条结果

| 类 | 结果 | 说明 |
|---|---|---|
| A 信息架构 | ✅ | 入口 = 基础设施 → 服务监控（原 generic 占位升级）；「去主机管理检查」跳真实屏 `dc-hosts`，无死链 |
| B 任务流闭环 | ✅ | 主路径（切环境 → 看表 → 看日志入口）可走通；异常分支 3 个场景覆盖（一台失败 / 全失败 / 空态），错误不吞、真因上屏 |
| C 状态矩阵 | ✅ | 空 / 错 / 部分失败各有唯一恢复入口（重试 / 去主机管理 / 去主机管理登记）；Playwright 断言 5 场景 display 状态全符合预期 |
| D 操作与确认 | ✅ | 页内无破坏性操作；primary ≤ 1（「去主机管理登记」仅空态出现） |
| E Token 一致性 | ✅ | 裸 hex `#fff1f0` ×2 已替换为 `var(--ws-danger-soft)`；无新增 `!important`；复用整稿既有 token 口径 |
| F 可访问性 | ✅（原型口径） | 可点击区沿用整稿 button/onclick 风格；折叠组可点击（键盘可达为落地项，见遗留） |
| G 内容真实性 | ✅ | 全部真实业务数据（dev 12 服务 / 真实端口 / 真实错误文案取自本次 dev 实测） |
| H 目标端一致 | ✅ | 桌面 Web 控制台壳，复用整稿双域导航，无跨端元素 |
| I 未定义项标注 | ✅ | 见下「遗留项 / 待确认」——无静默脑补 |

## 遗留项（落地时处理，不阻塞确认）

1. **加载中态未在原型模拟**：探活最长 10s，落码时表格用 `loading` 态（a-table spinning），原型不画时序。
2. **「查看日志」是 toast 占位**：落码复用现有日志抽屉（原 `ServiceMonitor.vue` 已有）。
3. **折叠组键盘可达**：原型用 div+onclick（整稿惯例），落码用 `a-collapse` 天然可达。
4. **场景②服务状态表只画了 1 行失败示例**：真实数据按主机取数失败时该主机全部行失败，行为一致，不再逐行铺陈。

## 设计假设（**已由用户确认 2026-09-24**）

| 假设 | 结论 |
|---|---|
| 自动刷新取数失败时：**保留上次成功数据 + 顶部横幅**，不清空表格 | ✅ 确认 |
| 仅 1 台主机时：**分组头保留但弱化**（避免 13 个进程被一层壳包住的多余感） | ✅ 确认 |

## 场景清单（屏内可切换）

| 场景 | 演示 |
|---|---|
| ① 单主机 · 全部正常 | dev 控制台基线：页签 DEV/PROD，12/12 在线 |
| ② 多主机 · 一台取数失败 | 顶部横幅 + 失败分组 Alert + 服务表失败行 |
| ③ 全部取数失败 | 即本次 dev 故障形态：一眼看出是 SSH 不通而非服务挂 |
| ④ 编排者本机控制台 | `managed_by=orchestrator` → 多「本地」页签，主机/地址列切到 127.0.0.1 |
| ⑤ 无可管环境（空态） | `/monitor/envs` 为空，唯一恢复入口「去主机管理登记」 |
