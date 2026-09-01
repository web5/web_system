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

## 批 2 · P0 可靠性闭环 + 配置中心（Plan 已细化，待 Build）

> 启动前提：`design.md` 批 1 收尾 MUST 已清零（已完成，2026-09-01 发布验证通过）。
> 建议 Build 顺序：④ → ③ → ⑤ → ⑥ → ⑨ → ⑦ → ⑧ → ⑩（先探针与回滚闭环，再配置中心）。每完成一个能力走一次「构建 + 独立子代理评审」。

### ④ 发布后健康检查探针
- [ ] 在 `verify` 阶段调用 monitor 探活逻辑（复用 `getLocalHealth` / 端口探活）
- [ ] 探活结果写入发布记录与审计
- 验收：发布记录含健康探活结果字段

### ③ 回滚真正重建后端
- [ ] 定位 `rollback` / `publishVersion` 中 backend 仅切指针的代码点
- [ ] 改为 restart 到目标版本产物（从发布目录拉取 / 重建 pm2 进程）
- [ ] 重启后端口探活确认旧版本实际运行
- 验收：回滚后 pm2 进程实际运行目标版本代码（探活确认）

### ⑤ verify 失败自动回滚（依赖 ④）
- [ ] verify 失败触发自动回滚到上一稳定版本（含 backend restart）
- [ ] 回滚动作写审计留痕
- 验收：探活 / 校验失败时系统自动回退

### ⑥ DB Migration 纳入发布
- [ ] pipeline 增加 `migration` 阶段（或 pre-check 校验），仅 backend 模块触发
- [ ] 迁移失败阻断发布（不切指针）
- 验收：发布流水线含 migration；失败不切指针

### ⑨ 发布前预检（pre-check）
- [ ] `check` 阶段前插入 pre-check（分支存在 / DB 可达 / 配置就绪）
- 验收：预检失败不进入构建

### ⑦ 发布并发锁 / 幂等
- [ ] 以 `moduleKey + env` 为键的发布锁（DB / redis）
- [ ] 拒绝 / 串行化并发发布，job 幂等去重
- 验收：并发发布不互相覆盖

### ⑧ 多环境发布编排
- [ ] pipeline submit 支持 `targets: env[]`，顺序执行 + 统一回滚边界
- 验收：多环境发布有统一进度与回滚边界

### ⑩ 配置中心（最高价值，工作量最大）
- [ ] 新增 `config` 模块（controller / service / entity）：`config_items` + `config_snapshots` 表
- [ ] 密钥 AES 加密（服务侧主密钥来自启动环境变量），页面掩码 `••••`
- [ ] 注入时按 全局 → 环境 → 模块 合并并**强制覆盖** pm2 env（禁 shell 写死 `PORT`，吸取 `PORT=6200` 污染教训）
- [ ] 保存时校验（端口冲突 / 必填 / 密钥格式）
- [ ] 审计 diff（密钥不记明文）
- [ ] 前端「配置中心」页 + 模块详情入口
- 验收：运维无需 SSH 在页面完成配置与注入；密钥明文不落库 / 不回显

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
