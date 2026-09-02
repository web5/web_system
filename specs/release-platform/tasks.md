# 发布平台 · 实施计划

> 类型：tasks.md（Plan 阶段产物）
> 日期：2026-09-02
> 关联：需求 `requirements.md` · 方案 `design.md`
> 执行：`rd-execute`（TDD 红→绿→重构）→ `verification-before-completion` → `rd-review`
> 约定：每个任务 = 一个可独立验证的功能模块；验收 EARS；标注依赖；**本文件是进度真相源**（勾选状态跨会话可续）。

## S0 · 已完成并收编（原批 1）

- [x] 0.1 ① 本地服务监控（`execLocal` + 3 个非 SSH 路由 + 前端「本地」tab）
- [x] 0.2 ② 模块管理按类型 tab 化 + 计数
- [x] 0.3 评审 MUST 收尾：命令注入 DTO / CORS 白名单 / 全局异常过滤器 / 清理 `any`

## S1 · P0 命令驱动流水线（L3）

> 目标：消除构建硬编码，统一阶段命令为唯一真相源。

- [x] 1. 数据模型 `deploy_module_stage_commands` + 建表
  - 依赖：无
  - _验收：当 应用启动后，应存在 deploy_module_stage_commands 表且 (module_key, stage) 唯一_
  - 落地：`src/entities/deploy-module-stage-command.entity.ts`（synchronize 自动建表）
- [x] 2. 迁移脚本：`buildCmd` + `deploy_module_hooks` → `stage_commands`（冲突列清单）
  - 依赖：1
  - _验收：当 执行迁移后，每个已配置阶段应在 stage_commands 中有且仅有一条命令；当 buildCmd 与 build hook 冲突时，应输出冲突清单而非静默覆盖_
  - 落地：`scripts/migrate-stage-commands.ts`（默认 dry-run，`--apply` 才写库）；**待建表后执行 dry-run 验证**
- [x] 3. 执行器 `runStageCommand` + 阶段统一（含 build 接入）+ 删除 `buildBackend`/`buildFrontend` 硬编码
  - 依赖：2
  - _验收：当 模块配置了阶段命令时，pipeline 应执行该命令；当 命令退出码非 0 时，应中断发布_
  - 落地：`pipeline.service.ts` 新增 `runStageCommand`/`runShell`，删除 `runHook`/`runScriptFile`/`stageBuild`；`pipeline.module.ts` 以 `StageCommandModule` 取代 `HookModule`
- [x] 4. fail-fast + 超时控制
  - 依赖：3
  - _验收：当 模块未配置某可配置阶段命令时，应在该阶段失败并明确报错，不执行任何内置技术栈命令；当 超过 timeoutSec 时，应超时中断_
  - 落地：编排中 build 未配置命令即抛错终止；`runShell` 按 `timeoutSec`（缺省 `BUILD_TIMEOUT_MS`）超时中断
- [x] 5. 默认命令模板（按 type 一键填充）
  - 依赖：1
  - _验收：当 按 backend 填充模板时，应生成可用构建命令；当 按 frontend/micro-frontend 填充时，应生成 vite build_
  - 落地：迁移脚本 `DEFAULT_BUILD_CMD`（backend→`npx tsc -p tsconfig.json`；frontend→`npx vite build`；micro-frontend→`npx vite build --mode mf`；mini-app→`npx vite build`）
- [x] 5b. 阶段命令服务单元测试（防回归）
  - 依赖：1
  - _验收：当 resolve 遇到未配置/空白/未启用时应返回 null；当 upsert 传入 version/pointer 或空命令时应抛 BadRequestException_
- [x] 6. 模块详情「阶段命令」页面配置（`bash -n` 校验，仅 JWT 可写）
  - 依赖：3
  - _验收：当 保存非法 shell 时应拒绝并提示；当 保存合法命令时应落库且审计留痕_
  - 落地：后端 `stage-command.controller.ts`（GET/PUT/DELETE/validate/templates，仅 JWT 不暴露 MCP）；前端 `api/index.ts` 新增 `stageCommandApi`，`ModuleDetail.vue` 的「发布脚本」tab 替换为「阶段命令」tab（build 标红「必填」）
- [x] 7. 废弃 `buildCmd` 字段与 `deploy_module_hooks` 表 + 对齐 `deploy-pipeline-dev.md:101` / `release-system-design.md`
  - 依赖：3、迁移验证通过
  - _验收：当 查阅两份文档时，其关于阶段命令的陈述应与 design.md 一致_
  - 落地：`deploy.service.ts`（旧 `deploy.sh` 路径）改读 `stage_commands`；`buildCmd` 标 `@deprecated`；两份文档矛盾表述已对齐
  - ⚠️ **物理删列/删表待执行**：本轮只做逻辑废弃以保证可回滚；建议观察一个发布周期后再删 `deploy_modules.build_cmd` 列与 `deploy_module_hooks` 表
- [ ] 8. `pipeline.service.ts` 纳入独立子代理评审
  - 依赖：3
  - _验收：当 S1 代码完成后，design.md 应存在独立评审结论记录_

## S2 · P0 配置中心（L2）

- [ ] 9. `config_items` + `config_snapshots` 数据模型
  - 依赖：无
  - _验收：当 保存配置时，应生成快照并与版本关联_
- [ ] 10. 密钥 AES 加密 + 页面掩码（不可读明文）
  - 依赖：9
  - _验收：当 保存密钥后读取，应返回掩码且 DB 中无明文_
- [ ] 11. 三级作用域合并 + 发布/重启时强制覆盖注入 pm2 env（禁 shell 写死 PORT）
  - 依赖：9
  - _验收：当 注入执行时，应按 模块级>环境级>全局默认 覆盖；当 shell 中已存在 PORT 时，应被配置中心值强制覆盖_
- [ ] 12. 配置中心页面 + 校验（端口冲突/必填/密钥格式）
  - 依赖：9、10
  - _验收：当 配置端口冲突时，应拒绝保存并提示_
- [ ] 13. 配置变更审计（前后 diff，密钥不记明文）
  - 依赖：9
  - _验收：当 配置变更时，应可查询到变更人/时间/前后值_

## S3 · P0 可靠性（L4/L5）

- [ ] 14. 真实端口/HTTP 健康探活（替换仅查 pm2 status）
  - 依赖：S1
  - _验收：当 verify 执行时，应做 HTTP 探活并写入发布记录与审计_
- [ ] 15. 回滚真正重建后端进程
  - 依赖：无
  - _验收：当 回滚执行后，目标 pm2 进程应实际运行旧版本代码（探活确认）_
- [ ] 16. verify 失败自动回滚
  - 依赖：14、15
  - _验收：在 verify 失败时，应自动回滚到上一稳定版本并留痕_
- [ ] 17. 并发锁/幂等（moduleKey+env）
  - 依赖：无
  - _验收：当 并发发布同一模块同一环境时，应串行化或拒绝，不覆盖指针_

## S4 · P1 治理与可观测（L5/L6）

- [ ] 18. 审批门禁（prod）— _验收：当 未审批的 prod 发布提交时，应被阻断并留记录_
- [ ] 19. 通知中心 — _验收：当 发布/失败/审批/回滚事件发生时，应送达已配置通道_
- [ ] 20. 审计增强（全量 diff）— _验收：当 任意变更发生，应可追溯人/时间/前后 diff_
- [ ] 21. 发布度量仪表盘 — _验收：当 查看度量页，应按环境/模块/时间筛选展示成功率与时长_

## S5 · P1 灰度与接入（L7/L8）

- [ ] 22. 灰度增强（规则/放量/全量）— _验收：当 灰度放量时，命中流量应加载 canary 版本_
- [ ] 23. 自助诊断工具 — _验收：当 执行端口检测/进程重启/日志检索时，应在页面完成无需 SSH_

## 发布记录

- **2026-09-02 首次上线**（分支 `feature/contract-risk-ai`）
  - 提交：`c447795`（命令驱动流水线）→ `d9703bf`（tsconfig 只编译 src）→ `3974e70`（迁移脚本原生 SQL + SnakeNamingStrategy）
  - 发布目录 `~/web_system_release`：`git pull` → `nest build` → `pm2 start web-deploy-console`
  - 结果：服务 online、监听 6200、`synchronize` 无报错；阶段命令 6 个路由全部 Mapped
  - 数据：`deploy_module_stage_commands` 20 条（11 条迁移 + 9 条默认模板）

### 上线踩坑（务必记住）

1. **新增 `scripts/` 导致构建产物错位**：tsconfig 无 `include` 时，运维脚本被纳入编译，
   tsc rootDir 退化为项目根，产物由 `dist/main.js` 变为 `dist/src/main.js`，pm2 启动报 `MODULE_NOT_FOUND`。
   → 已修：`include: ["src/**/*"]` + `exclude` 加 `scripts`。**今后新增非服务代码目录必须同步检查 tsconfig**。
2. **独立脚本的 DataSource 必须对齐 `SnakeNamingStrategy`**：否则建表列是驼峰（`moduleKey`），
   与服务端 synchronize 期望的下划线列（`module_key`）互相 ALTER，服务连不上库。
   → 复用 `app.module` 的 namingStrategy，勿在脚本里另起一套配置。
3. **typeorm `repo.upsert` 传 `conflictPaths` 会漏写列**：曾导致 20 行 `module_key` 全为空串，
   唯一索引建不起来。→ 批量迁移改用原生 `INSERT ... ON DUPLICATE KEY UPDATE`。
4. **`pm2 restart` 退不干净旧进程 → 双实例抢端口（`EADDRINUSE: 6200`）**：
   直接 restart 会出现两个 `dist/main.js` 并存、restart 计数飙升（本次已达 65）。
   → 正确姿势：`pm2 stop` → `pkill -f "deploy-console/dist/main.js"` → 确认 `lsof -i :6200` 空闲 → `pm2 start`。
   这正是本项目历史上「改代码 → 重建控制台 → 6200 端口冲突」反复踩坑的直接原因，
   也正因如此，把构建命令数据化（不必为改一条命令而重建重启）才格外重要。

## 执行约定（方法论）

- **TDD**：每个任务 RED（写失败测试）→ GREEN（最少代码通过）→ REFACTOR，逐项勾选本文件。
- **防回归**：每个缺陷修复补一个「修复前会失败」的测试；校验对外可见行为，不校验实现细节。
- **证据**：宣称通过必须附实际运行结果（lint / 测试 / 接口返回）。
- **收尾**：每阶段完成走 `verification-before-completion` + `rd-review`；**不主动 commit**。
- **阶段门**：S1 完成并评审后启动 S2；S1/S2/S3 为 P0，必须先闭环。
- **上下文对抗**：每轮开工先重读本文件与 `design.md`，不依赖对话记忆。
