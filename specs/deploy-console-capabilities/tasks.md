# 任务清单：Deploy-Console 能力建设

> 类型：plan.md / tasks.md（Build 阶段产物）
> 日期：2026-09-01
> 关联：意图 `docs/intents/2026-09-01-deploy-console-capabilities.md`；产品设计 `requirements.md`；技术方案 `design.md`

---

## 批 1 · 本地监控 + tab 化（编码中，待评审收尾）

### 已完成编码（git status 5 文件）
- [x] ① 前端 `ServiceMonitor.vue` 环境切换新增「本地」tab
- [x] ① 后端 `monitor` 新增 3 个非 SSH 路由 + `execLocal()` + 本地 pm2/health/logs
- [x] ① 前端 `api/index.ts` 新增 `localPm2/localHealth/localLogs`
- [x] ② `ServiceManager.vue` 改为按类型 tab 分组 + 计数

### 待收尾（来自 design.md 评审 MUST/SHOULD）
- [x] **MUST** 修复本地命令注入：`monitor/dto/logs-query.dto.ts` + 控制器改用 DTO（`@Matches(/^[a-zA-Z0-9_-]+$/)`）
- [x] **MUST** 修复 CORS 越权：`main.ts` 读 `CORS_ORIGINS` 白名单，移除 `origin: true`
- [x] **MUST** 补全局异常过滤器：`common/filters/all-exceptions.filter.ts` 注册
- [x] **MUST** 清理 `any`：`monitor.service.ts` 定义 `RawPm2Process` + 抽 `toPm2Process()`，消除两份解析漂移
- [x] **SHOULD** 本地/远端 pm2 解析重复 → 抽公共 `toPm2Process` 已随 MUST#4 完成
- [ ] **SHOULD** 本地健康对齐 env 表 `ports` 映射（避免无 `PORT` 服务被过滤导致空表）
- [ ] **SHOULD** `execLocal` 显式 `cwd`/`PATH` 兜底
- [ ] **SHOULD** `ServiceManager.vue` tab 计数改用 `computed` 映射
- [x] 收尾后 `nest build` 通过，lints 0，铁律 MUST 清零（2026-09-01）

> 状态：批 1 编码 + MUST 收尾已完成，`design.md` 已解除基线阻塞。SHOULD 三项不阻塞批 2，可随批 2 一并处理。

---

## 批 2 · P0 可靠性闭环 + 配置中心（待启动）

- [ ] ③ 回滚真正重建后端（restart 到目标版本产物）
- [ ] ④ 发布后健康检查探针（verify 阶段探活写记录）
- [ ] ⑤ verify 失败自动回滚（含 backend restart + 审计留痕）
- [ ] ⑥ DB Migration 纳入发布（backend 模块触发，失败阻断）
- [ ] ⑦ 发布并发锁 / 幂等（`moduleKey + env` 锁）
- [ ] ⑧ 多环境发布编排（`targets: env[]` 顺序 + 统一回滚边界）
- [ ] ⑨ 发布前预检（分支/DB/配置就绪，失败早停）
- [ ] ⑩ 配置中心（环境变量 + 密钥页面可配置，AES 加密，三级作用域，强制覆盖注入，版本化回滚，审计 diff）

> 启动批 2 前：先读 `design.md` 第三节 + 本文件批 1 收尾状态，确认 MUST 已清零再开工。

---

## 批 3 · P1/P2 治理与可观测（待启动）

- [ ] ⑪ 模块详情聚合增强（版本历史/部署记录/环境统一入口）
- [ ] ⑫ 发布流水线可视化增强（阶段进度/耗时/日志）
- [ ] ⑬ 灰度/金丝雀发布增强（规则/放量/全量/回滚）
- [ ] ⑭ 审批流（发布门禁，prod 审批闸门）
- [ ] ⑯ 通知中心（站内 + Webhook + 企业微信）
- [ ] ⑰ 审计增强（全量操作 diff，密钥不记明文）
- [ ] ⑮ 可观测性仪表盘（成功率/时长/失败分布时间序列）
- [ ] ⑱ 自助诊断/运维工具（端口冲突/进程重启/日志聚合）

---

## 阶段与 Agent 沟通契约（本文件存在的意义）

- **Plan** → `docs/intents/2026-09-01-deploy-console-capabilities.md`
- **Design** → `specs/deploy-console-capabilities/requirements.md`（产品）+ `design.md`（技术 + 评审）
- **Build** → 本 `tasks.md`（批 1/批 2/批 3 任务卡）
- **评审隔离**：技术评审由独立子代理执行，结论写入 `design.md` 第四节，主 agent 不自评自批。
- **后续批 agent 的输入契约**：批 2/批 3 启动时直接读取上述文件，不依赖对话上下文（规避 `<cb_summary>` 压缩导致的「上下文蒸发」），并修复 playbook 缺口①（intent/spec 落盘）。
