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

## 评审结论

> 由独立子代理执行（`rd-review`），结论追加于此。
> 批 1 历史成果（本地监控、tab 化、命令注入/CORS/异常过滤器/any 四项 MUST 修复）已收编，见 `tasks.md` S0。
> **`pipeline.service.ts` 的评审待 S1 完成后执行**（历史盲区，本次补齐）。
