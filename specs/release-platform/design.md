# 发布平台 · 设计方案

> 类型：design.md（Design 阶段产物）
> 日期：2026-09-02
> 关联：需求 `requirements.md` · 实施 `tasks.md`
> 方法论：`ai-agent-kit/skills/rd-plan` + `rd-execute`（TDD）+ `rd-review`（独立自检）

## 概要

发布平台分 8 层（能力全景与 EARS 验收见 `requirements.md`）：

```
L8 接入层    控制台 UI · MCP · 发布 Agent
L7 灰度回滚  灰度 · 回滚 · 版本保留
L6 可观测    监控(本地/远程) · 度量 · 日志
L5 治理      并发锁 · 审批 · 审计 · 通知
L4 运行时    部署执行 · 进程管理 · 健康探活
L3 流水线    阶段编排 · 命令驱动 · 产物 · 版本 · 指针
L2 配置      环境变量 · 密钥 · 三级作用域 · 快照 · 注入
L1 资源      环境 · 服务器组 · 模块注册表 · 服务路由
```

结构关系：

```
模块(Module) --阶段命令(stage_commands)--> 产物(Version) --指针--> 环境(Environment)
配置(Config) --注入--> 运行时进程
```

**代码现状（事实，2026-09-02 核实）**：

- 九阶段编排：`pipeline.service.ts:420-460`
- 除 build 外各阶段均有 hook 覆盖：`runHook(p,stage)`（`:545` 调用 `hookService.resolveScript`），见 `:422/433/438/440/458/460`
- **build 是唯一无 hook 覆盖的阶段**：`:435` 直接 `await this.stageBuild(p)`（已改为只依赖 `buildCmd`）
- `deploy_module_hooks` 表：`(moduleKey, stage)` 唯一，`script` 为 text
- `deploy_modules.buildCmd`：`varchar(255)` 可空
- `src/config/`：**空目录**，配置中心未实现
- `config_change_logs`：旧 .env 文件管理留痕，非新配置中心

## 关键决策

1. **统一阶段命令表（单一真相源）**
   新建 `deploy_module_stage_commands`（moduleKey + stage + command + enabled + timeoutSec + updatedBy），**废弃 `deploy_modules.buildCmd` 字段与 `deploy_module_hooks` 表**，两套机制合并为一套——直接吸取本次「两套机制冲突、文档打架」的教训。

2. **所有可配置阶段统一走 `runStageCommand`，但按「是否有合理内置默认」分级**

   | 级别 | 阶段 | 语义 |
   |---|---|---|
   | **强制命令（fail-fast）** | `build` | 技术栈相关，无合理内置默认；未配置即阶段失败 |
   | **可选覆盖（内置兜底）** | `check` / `pull` / `upload` / `restart` / `verify` / `cleanup` | 有命令则执行并跳过内置；无命令用流水线内置逻辑 |
   | **固定（不可配置）** | `version` / `pointer` | 发布语义真相源，固定由流水线执行 |

   为什么不是「全部阶段强制 shell 化」：`upload`/`restart`/`verify`/`cleanup` 依赖平台内部知识
   （gateway 产物目录、pm2 进程、manifest 断言、版本表清理），强行改成「必须配置 shell」
   等于把平台核心能力推给模块脚本，回归面与风险都过大；
   统一到同一张表后，这些阶段保留**内置兜底 + 可选命令覆盖**（等价于原 hook 语义，能力不回归）。
   而 `build` 天然是模块自己的事（各模块技术栈不同），**必须配置命令**——这正是本次硬编码缺陷的根源。

3. **fail-fast 仅用于 build，不回退技术栈硬编码**
   build 阶段命令缺失 → 阶段失败并明确报错，绝不静默回退 `nest build`/`vite build`（杜绝硬编码复活）。

4. **默认模板数据化**
   按模块类型提供默认命令模板，一键填充进 `stage_commands`（数据在 DB，不在 TS 分支）。

5. **配置中心**
   三级作用域（全局→环境→模块）+ 密钥 AES 加密（页面掩码、不可读明文）+ 版本快照关联回滚 + 发布/重启时**强制覆盖注入** pm2 env（禁止 shell 写死 PORT）。

6. **评审覆盖发布核心**
   凡涉及 pipeline/配置中心的改动，必须经独立子代理评审，结论写入本文「评审结论」——补齐 `pipeline.service.ts` 从未评审的盲区。

7. **文档单一事实源**
   本 spec 为发布平台唯一事实源；`deploy-pipeline-dev.md:101`（buildCmd 已废弃）与 `release-system-design.md`（buildCmd 字段）的矛盾表述必须对齐（任务 T7）。

## 对外交付物

- **数据模型**
  - `deploy_module_stage_commands`(moduleKey, stage, command, enabled, timeoutSec, updatedBy)，UNIQUE(moduleKey, stage)
  - `config_items`(scope, envId, moduleKey, key, value, isSecret, enabled)
  - `config_snapshots`(id, envId, moduleKey, versionTag, payload, createdBy)
- **执行语义**
  - `cwd = $RELEASE_DIR/<module.dir>`
  - env 注入：`RELEASE_DIR / MODULE_DIR / MODULE_KEY / MODULE_TYPE / DEPLOY_ENV / BRANCH / COMMIT_ID / STAGE`
  - `spawn('bash', ['-c', command])`；退出码非 0 → 阶段失败中断；输出流式进流水线日志；按 `timeoutSec` 超时中断
- **API / 页面**
  - 模块详情「阶段命令」tab：阶段列表 + shell 编辑器 + 模板填充 + `bash -n` 校验（仅 JWT 可写，不暴露 MCP）
  - 「配置中心」页：模块/环境树 + 键值表 + 密钥掩码 + 端口冲突校验
- **迁移**
  - `buildCmd` → `stage_commands(build)`
  - `deploy_module_hooks` → `stage_commands`（script→command，冲突列清单交人工确认）
  - 按 type 填充默认模板；迁移前全量备份相关表并提供回滚脚本
- **文档**：对齐 `deploy-pipeline-dev.md` 与 `release-system-design.md`

## 风险与权衡

- 风险：存量模块命令为 NULL → 发布停滞。→ 缓解：迁移脚本按 type 全量填充默认模板（T5），迁移通过后才启用 fail-fast。
- 风险：历史已配 build hook 与 buildCmd 冲突。→ 缓解：迁移时检测冲突并输出清单交人工确认，不静默覆盖。
- 风险：命令为任意 shell，存在误操作面。→ 缓解：仅 JWT 可写、不暴露 MCP、`bash -n` 校验、审计留痕。
- 风险：合并两套机制是一次性破坏性迁移。→ 缓解：迁移前备份，提供回滚脚本。
- 权衡：version/pointer 不 shell 化，损失「完全自定义发布」的灵活性。→ 取舍：版本与指针是发布语义真相源，交给 shell 会导致版本与产物不一致（历史踩坑）。
- 风险：扩大评审范围拉长节奏。→ 缓解：按阶段评审，仅 pipeline/配置中心改动强制评审。
- 风险：**独立运维脚本（非 Nest 运行时的 DataSource）与服务端 entity 配置漂移**。实测踩过两次：
  脚本未配 `SnakeNamingStrategy` 导致建表列为驼峰、与服务端 synchronize 互相 ALTER；
  新增 `scripts/` 被 `nest build` 纳入编译，使产物由 `dist/main.js` 错位为 `dist/src/main.js`。
  → 缓解：脚本复用 `app.module` 的 namingStrategy；新增非服务目录须同步 `tsconfig.include`。
  详见 `tasks.md`「上线踩坑」。

## 评审结论（2026-09-02，命令驱动流水线）

**评审范围**：本次全部改动——`deploy-module-stage-command.entity.ts`、`stage-command` 模块（service/controller/module）、
`pipeline.service.ts`（执行器与编排）、`deploy.service.ts`、迁移脚本、前端 `stageCommandApi` 与 `ModuleDetail.vue`。

> 说明：本轮计划由独立子代理执行，但子代理两次均只回传工具调用、未输出报告文本（该子代理为只读，无法写文件），
> 故改由主 agent 按同一评审清单执行。**独立性不足，建议后续由另一 agent 或人工复核**。

### 🔴 MUST 必改（已修复）

1. **执行器丢失 `cwd`，默认模板命令会编译错目标** — `pipeline.service.ts` `runShell`
   从旧 `stageBuild` 重构时未继承 `spawn` 的 `cwd` 设置，导致命令在 deploy-console 自身目录下执行。
   9 个使用默认模板（`npx tsc -p tsconfig.json` / `npx vite build`）的模块会编译错误目标或直接失败。
   - 修复：新增纯函数 `resolveStageCwd()`（后端 `servers/<dir>`，其余 `apps/<dir>`），
     `runShell` 接收 `cwd` 并以发布目录兜底；补防回归测试 `pipeline.service.spec.ts`。
   - 教训：重构「带环境假设的执行逻辑」时，`cwd` / `env` / `PATH` 属于易丢失的隐式契约，必须有测试锁定。

### 🟡 SHOULD 建议改（未修，记为待办）

1. **`any` 使用**：`runStageCommand` 的 `mod: any`、`stage as any`，controller 的 `user: any`
   （沿用 `hook.controller` 既有写法）。建议定义 `ModuleSnapshot` 与 `CurrentUserDto` 收口。
2. **测试未覆盖**：执行器 `runStageCommand`/`runShell` 的真实执行与超时中断、controller 鉴权、
   迁移脚本的冲突检测分支。均需依赖 mock 或集成测试。
3. **死代码**：前端 `hookApi` 与后端 `hook` 模块已无调用方；随物理删表一并清理。
4. **`buildCmd` 仍在 `module-registry` 返回 DTO 中**，前端若仍可编辑会误导；建议前端隐藏该字段。

### 🟢 KEEP（做得好的点）

1. **权限正确**：`auth.module.ts:32` 注册全局 `APP_GUARD`(JwtAuthGuard)，阶段命令 API 未标 `@Public()`，
   **仅 JWT 可写、未被 MCP 暴露**——已实测确认。
2. `bash -n` 校验写临时文件而非 heredoc，规避命令体包含 `EOF` 的冲突。
3. **fail-fast 语义正确**：build 未配置即抛错终止，不回退任何内置技术栈命令。
4. `version`/`pointer` 确实拒绝配置（`CONFIGURABLE_STAGES` 白名单约束）。
5. 迁移脚本默认 dry-run，冲突**只列清单、绝不静默覆盖**；执行前自动备份。
6. 单一真相源落地：两套互斥机制已合并，`pipeline.service.ts` 内无任何技术栈分支。

### 基线结论

修复 `cwd` 后**可作为 S2（配置中心）基线**；SHOULD 四项不阻塞，建议随 S2 一并处理。
**`pipeline.service.ts` 从未被评审的历史盲区，本次已补齐。**

---

## 独立子代理评审结论（2026-09-02 终版，任务 8）

**评审方式**：`code-explorer` 子代理按清单独立审查 `pipeline.service.ts`（只读，报告带行号），
主 agent 对关键路径（发布锁、runShell/取消协作、命令拼接）二次读码核实后修复并补单测。
评审对象为**当前最新代码**（含阶段命令驱动、审批门禁、通知等历次改动，非 S1 快照）。

### 🔴 MUST 已修复（本次）

1. **发布锁非互斥（并发双跑竞态）** — `release-lock.service.ts` `acquire`
   原「findOne → 判断 → upsert」三步：两条并发发布同时读到"无锁"后都 upsert 成功
   （ON DUPLICATE 无条件后写覆盖），**双双返回 true**，同一模块×环境并行发布、互相覆盖版本指针。
   - 修复：改单条 `INSERT ... ON DUPLICATE KEY UPDATE` + IF 条件做**原子抢占**，
     后到者不满足「自己持有或锁已过期」则不覆盖；读回校验最终持有者是否是自己。
     单条语句决定 winner，跨实例同样互斥。
   - 单测：`release-lock.service.spec.ts` 重写（含「并发落败方确认后返回 false」防回归用例）。

2. **取消不中断子进程、且终态被 run 覆盖** — `pipeline.service.ts`
   取消只置 DB 状态；`runShell` 内长命令（build 分钟级）不因取消中断，
   run 继续跑完后以 succeeded 覆盖已取消行 → "已取消"的发布照样完成并上报成功。
   - 修复：进程内登记运行中 `shells: Map<pipelineId, child>`，`cancel()` 立即 SIGKILL 子进程；
     `run` 的 catch 里**取消优先于失败**（`cancelled.has(id)` → 终态 cancelled），
     成功路径保持 succeeded（发布真实完成不可撤销）。
3. **git 命令注入面** — `stagePull` 将用户可控 `gitBranch` / `versionTag` 直接拼进
   `git checkout -B ${branch} ...` / `git reset --hard ${commit}`（无引号/白名单）。
   - 修复：`submit` 入口白名单校验（branch `^[A-Za-z0-9._/-]{1,128}$`；
     commit `^[A-Za-z0-9._-]{4,64}$`），非法输入 400 拒绝。

### 🟡 SHOULD 已修复（本次顺手）

1. **日志全量序列化**：`runShell` 每行输出都 `save` 整个 `p.logs`（JSON 数组随命令输出增长）。
   → 300ms 合并节流落库，命令结束 flush。

### 🟡 SHOULD 记录（未修，后续按需）

1. **审批单并发创建非原子**：同一 env+module 并发提交 prod 时，`approval.create` 的重复检查
   （findOne→save）存在窗口，理论上可产生两条 pending 审批单。**实际由发布锁兜底**：
   approve 恢复执行时 acquire 失败即拒绝，不会双跑。若要根治，可加
   `UNIQUE(env, module_key, status)` 化改造（status 演进需软删/历史表），成本高收益低，暂缓。
2. `runShell` 真实执行/超时中断/取消中断的自动化测试依赖子进程 mock，未覆盖（记测试债）。
3. `hook` 模块与前端 `hookApi` 死代码随 `deploy_module_hooks` 物理删表一并清理（S1 遗留 SHOULD）。

### 🟢 KEEP（做得好的点）

1. 发布锁带 TTL + 只释放自己持有的锁（强杀后不产生死锁、不误删他人抢占后的锁）。
2. 失败处理按阶段差异化：verify 失败自动回滚到上一版本，并**等回滚任务真正跑完 + 探活确认**
   才落审计（而非"发起了动作就宣称回滚"）。
3. 取消采用阶段边界 `assertNotCancelled` + 本次补的 SIGKILL 双保险；锁在 finally 释放。
4. 配置注入强制覆盖 + PATH 显式补齐（git/pm2/npx 不缺目录）。
5. 审批门禁状态机经核验：approve/reject/cancel 竞争由 `ApprovalService.resolve` 幂等保护收敛，
   pending-approval 提交不占 running 锁、不会误伤 dev 发布。

### 终版结论

**3 项 MUST 全部修复并有测试锁定；`pipeline.service.ts` 的独立评审盲区至此补齐（任务 8 达成）。**
遗留 SHOULD 不阻塞，均已记录行号与建议，后续迭代按需处理。
