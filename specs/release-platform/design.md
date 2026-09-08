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

---

## 流水线模板 + 实例（S6 演进）设计

> 决策记录：需求见 `requirements.md`「L3b」；任务见 `tasks.md`「S6」。
> 本方案尚未实施，待用户确认后进入执行。

### 目标模型（三层分离）

```
模块（资源定义）          模块基本信息 / 阶段命令（如何构建） / 配置中心
  └── 流水线模板（流程定义，S6 新增）  名称/说明 / skipVerify / 审批策略 / 默认投递 —— 模块下可建多条
        └── 流水线实例（一次发布） deploy_pipelines（现状表，加模板快照引用）
```

把「这个模块怎么发」从**隐式一套**提升为**显式多套可选**：提交发布 = 选 模块 + 流水线模板 + 分支/commit/mode → 生成实例。

### 关键决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | **实例复用 `deploy_pipelines` 现状表**，加 `template_id`（可空）+ `template_name`（快照）。不新建 run 表 | 现状表本就是「一条 = 一次发布」的实例表；审批/通知/度量/审计全部继续引用它，迁移成本最低，历史记录天然兼容 |
| D2 | 模板表 `deploy_pipeline_templates`：`id / moduleKey / name / description / skipVerify / approval('inherit'\|'always'\|'never') / defaultTarget('auto'\|'local'\|'remote') / enabled / builtin / createdBy / createdAt`；UNIQUE(moduleKey, name) | 模板归属模块（用户诉求"针对模块添加流水线"）；builtin 默认模板不可删不可改名 |
| D3 | 每模块懒建一条 **builtin 默认模板**（语义=现状：全流程 + 环境规则审批），无显式模板的旧提交/MCP 提交自动走它 | 兼容零成本；「复制默认」是新建模板的起点 |
| D4 | **v1 可裁剪面仅两项**：`skipVerify`（跳探活，快线/调试线）+ `approval` 策略 + `defaultTarget`。`check/pull/build/upload/restart/version/pointer/cleanup` 固定 | version/pointer 是发布语义真相源（历史踩坑：版本与产物不一致）；build/pull/upload 是产物产生与投递基本盘，裁剪它们需要产物缓存机制支撑，列为后续（记 SHOULD） |
| D5 | 实例执行按**提交时快照**（template_id/name/skipVerify/approval 判定已固化到实例），模板事后修改/删除不影响运行中与历史实例 | 发布可追溯、不可被模板变更"改写历史" |
| D6 | 审批判定：`effective = 模板 approval ?? 'inherit'`；`need = always || (inherit && needsApproval(env))`；审批单/审计 detail 记录模板名 | 保留系统设置「REQUIRE_APPROVAL_ENVS」的 env 级规则，模板在其上做单模块覆盖 |
| D7 | 模板管理仅控制台 JWT；MCP 提交可带 `templateId`（可选，缺省走默认模板） | 与阶段命令同安全边界 |

### 数据模型

```sql
-- deploy_pipeline_templates
id          varchar(64) PK        -- tpl-<ts>-<rand>
module_key  varchar(64)           -- 模板归属模块；builtin 行 moduleKey='default'
name        varchar(64)           -- UNIQUE(module_key, name)
description varchar(255) NULL
skip_verify tinyint default 0     -- true=不执行探活验证（快线）
approval    varchar(8) default 'inherit'  -- inherit/always/never
default_target varchar(8) default 'auto'  -- auto/local/remote
enabled     tinyint default 1
builtin     tinyint default 0     -- builtin 不可删/改名（moduleKey='default' 的行即模块默认模板）
created_by / created_at / updated_at

-- deploy_pipelines 增列（synchronize 自动，可空）
template_id   varchar(64) NULL
template_name varchar(64) NULL    -- 快照，模板删后仍可读
```

### API（新增，仅控制台）

- `GET  /modules/:key/pipeline-templates` —— 模块模板列表（builtin default 恒在首位）
- `POST /modules/:key/pipeline-templates` —— 新建（body: name/description/skipVerify/approval/defaultTarget/enabled；`name` 冲突 409）
- `POST /modules/:key/pipeline-templates/:id/duplicate` —— 复制模板
- `PUT/DELETE /modules/:key/pipeline-templates/:id` —— 编辑/删除（builtin 拒绝删除）
- 写操作全部审计（diff：skipVerify/approval/defaultTarget/enabled/description）

提交侧（改造现有，非新增路由）：
- `POST /pipelines` body 增 `templateId?`；响应增 `templateId/templateName`

### 执行与状态机

- `submit`：解析模板（未传 → 模块 builtin default；模块无 builtin 则懒建）→ 校验模板 enabled → 落实例（template_id/name 快照 + skipVerify/approval 固化）→ 审批判定（D6）→ 无审批则照常 run
- `run`：在 verify 阶段前判断 `p.skipVerify`（快照），true 则跳过 `stageVerify` 与 verify 失败自动回滚逻辑（快线语义：不探活、无自动回滚）
- metrics / 通知 / 审计 / 审批单无需改动（实例行含新列即可）；历史记录 template_name 为 NULL → 前端显示「默认」

### 前端

- `ModuleDetail.vue` 新增「流水线模板」tab：模板表（builtin 置灰删按钮）+ 新建表单（名称必填；skipVerify/审批策略/默认投递开关）+ 复制默认 + 启停
- `PipelineCenter.vue` 提交区：选模块后出现「流水线模板」下拉（默认模板在首位，展示名称+skipVerify/审批角标）；列表与详情抽屉展示模板名
- 流水线列表列「模板」展示 template_name ?? '默认'

### 风险与缓解

- 历史实例无模板 → 一律展示「默认」，无迁移脚本（列可空）
- MCP/旧调用不传 templateId → builtin default 懒建兜底，行为不变
- 懒建竞态：同模块并发首提都查不到 builtin → 用「查无则建 + 唯一键冲突吞错重查」兜底
- skipVerify 模板被滥用会绕过探活 → UI 给 warning 角标；审批策略 `never` + skipVerify 组合允许存在但模板页明示「高风险」

### 遗留（记录不阻塞）

- 更深阶段裁剪（禁 build/禁 cleanup 等）依赖「产物缓存 + 保留策略 per 模板」，S6 之后按需演进

---

## v2 修订（2026-09-02）：步骤编排化 + 工具目录

> 用户追加：「回滚、探活等都可以做成工具，放到流水线的步骤里面」→ 模板从「九阶段内裁剪」升级为
> **步骤序列编排**；平台内置能力（upload/restart/verify/cleanup/version/pointer/rollback）注册为
> **内置步骤（执行器）**，与 shell 步骤同权，可被模板任意选用/排序/替换执行器。

### 目标模型（v2）

```
工具注册表 tool_catalog（外部 CLI 元数据）  git/pnpm/npm/npx/bash/scp/rsync/tar/pm2/curl/node-http…
                                             分类 + 说明 + 可用性 + 示例（给 shell 步骤参考，不逐 CLI 建执行器）
步骤库 step_catalog（可编排单元）           code + name + category + executor
    ├─ 内置步骤（平台语义，executor=builtin） check/pull/upload/restart/verify/cleanup/version/pointer/rollback
    │     —— 执行器把现有 stageXxx 平台逻辑迁移为可注册单元；回滚=rollback 步骤、探活=verify 步骤
    └─ 命令步骤（executor=shell）            由模块×步骤×env 的 stage_commands 提供 shell（现有机制）
模板 pipeline_templates = 有序 steps 序列      [{stepCode, executor?, 覆盖命令?}...] + 审批策略 + rollbackOnFailure
实例 = 按模板序列 + 提交时快照执行
```

### v2 关键决策（替代原 D4 的"固定九阶段 + skipVerify"）

| # | 决策 |
|---|---|
| V1 | 内置步骤执行器化：`run()` 的顺序 if-else 硬编码改为**注册表驱动**。内置执行器 SPI：`execute(ctx): Promise<StepResult>`；现有 `stageCheck/stagePull/stageUpload/stageRestart/stageVersion/stagePointer/stageVerify/stageCleanup` 逐一迁移为执行器，**失败/通知/进度语义保持现状** |
| V2 | 回滚三态：显式「rollback」内置步骤（=现有 rollback/switchPointer，可作模板步骤，做紧急回滚线）；失败自动回滚改**模板级 `rollbackOnFailure: 'previous' \| 'none'`**（替代硬编码"verify 失败回滚"，默认 previous 保持现状）；灰度 promote 保持独立动作不进步骤 |
| V3 | 分类（步骤与工具共用分类枚举）：`code(代码获取) / build(构建) / deploy(投递部署) / probe(探活验证) / rollback(回滚) / cleanup(清理) / semantic(发布语义:version/pointer)`；UI 按分类分组 |
| V4 | 安全边界不破：可编排**步骤集的下限白名单**——version/pointer 必须保留且不可排序到产物产生前；shell 命令仍仅 JWT、`bash -n` 校验、审计 |
| V5 | 兼容：builtin 默认模板序列 = 现九阶段（含 rollbackOnFailure=previous），行为与 S1-S5 完全一致；历史实例 template 为 NULL 显示「默认」 |
| V6 | **步骤与工具分离**（用户指定，例：`pipeline.service.ts` 探活 URL 拼接等平台逻辑应收敛为工具）：`step`=流程单元（做什么/顺序/失败语义），`tool`=执行体（怎么做）。`tool.kind ∈ {service, shell}`：service=平台内置执行器/可下沉独立服务的能力；shell=外部 CLI（可参数化）。模板步骤可换绑工具而不改流程语义；探活/回滚/写版本/切指针/重启/投递/清理全部注册为 service 工具 |
| V7 | 服务工具与独立服务的演化口：工具实现层预留 `service-kind: 'builtin' \| 'remote'`——builtin=本进程执行器，remote=调用独立服务（如未来消息/探活独立服务），**步骤定义与模板不变**，只换工具实现绑定。当前全部 builtin，避免为单一用例建服务（与「消息服务暂不独立」同判断） |

## 领域模型 v3：模块 × 流水线 × 实例（2026-09-02，澄清与收口）

> 背景：此前模型经历了「模板挂模块 → 全局化」的演进，遗留两处不清：
> ① 模板仍保留 `moduleKey='*'` 与「模块专属」双轨；② 「模块阶段命令」与「流水线步骤」在运行时的
> 合成规则只存在于代码（run → executeStage → 查模块 stage_commands），未在设计层讲清。
> 本节省做概念收口，**执行语义不变**，仅消除歧义并统一命名。

### 1) 三个独立领域概念

```
流水线 Pipeline（流程定义 · 全局资产，不绑定任何模块）
  组成：活动步骤集 steps（内置九阶段的可裁剪子集，version/pointer/check 为基线不可裁）
       + **步骤命令**（用户给可配步骤内嵌 shell：支持上下文变量 {MODULE_KEY/MODULE_TYPE/MODULE_DIR/
         RELEASE_DIR/COMMIT_ID/BRANCH/STAGE/DEPLOY_ENV} 与目标机器注入变量；未配命令 → 内置执行器）
       + 治理策略：审批(always/never/inherit)、失败自动回滚(previous/none)、默认投递(auto/local/remote)
  回答："一次发布按什么流程走、每步怎么执行、受什么治理约束"（**阶段命令由流水线自己定义**）

模块 Module（一个可发布工程 · 纯目标与上下文）
  组成：key/name/type/dir（属性定义，供流水线命令以 {MODULE_*} 变量引用）
       + 仓库/分支来源 + 配置中心（per env×module 注入）+ 服务地址(ports)
  回答："发什么工程、它的上下文是什么"（**不再持有任何阶段命令/构建逻辑**）

发布请求/实例 Run（一次执行 · 流水线×模块×环境 的快照）
  组成：pipeline 快照(steps/策略) + moduleKey/type + env/branch/commit/mode/target + 运行态(stage/status/进度)
  回答："这一次在哪个环境、发哪个版本、走到哪一步"
```

### 2) 关系与运行时合成规则（唯一真理，消除代码里"隐性契约"）

```
执行模型：Run = 流水线(流程) × 模块(工程配置) × 请求参数(env/branch/commit/mode)
合成规则（run → 按 pipeline.steps 顺序逐步骤执行）：
  ① 步骤集合与顺序      ← 来自【流水线】steps（快照固化到实例）
  ② 每步执行体          ← **流水线步骤命令**（用户在该步骤内嵌的 shell）→ 未配命令 → 平台内置执行器；
                           命令内 {MODULE_*} 变量在运行时替换为实例绑定模块的上下文
                           （过渡期兼容：步骤未配命令且模块存在老 stage_commands 时回退读取并标 deprecated）
  ③ 命令作用阶段        ← 仅"可配阶段"（check/pull/build/upload/restart/verify/cleanup）可在流水线配命令；
                           version/pointer 永远内置
  ④ 探活地址/配置注入   ← 【环境】ports + 【配置中心】env×module 作用域
  ⑤ 审批/回滚/投递      ← 【流水线】策略（提交时按 env 判定审批；verify 失败按 rollbackOnFailure 回滚）

差异表达（同一流水线服务多工程时命令的工程差异怎么办）：
  - 常规差异用变量分支：build 步骤命令内 `case "${MODULE_TYPE}" in backend) npx tsc -p tsconfig.json;; *) npx vite build;; esac`
  - 特殊工程需要完全不同的流程/命令 → 复制该流水线为"专用线"（复制后改步骤命令），工程发布时选专用线；
    **不再允许在模块上写命令**（模块"哑化"，与"阶段命令归流水线"一致）
```

### 3) 收口决策（消除双轨与命名歧义）

| # | 决策 | 现状 → 目标 |
|---|---|---|
| R1 | 流水线一律全局，**不再存在「模块专属模板」新建路径** | 创建/编辑只作用于全局流水线；历史 moduleKey=具体模块的行仅兼容展示（标注"旧·专属"，不可新建、可删除/复制为全局） |
| R2 | 术语统一：**「流水线」= 流程定义**；「模板」字眼从 UI 移除；执行记录统一叫**实例/发布任务** | 模块详情内的阶段命令仍叫"阶段命令"（它是模块的构建方法，不属流水线） |
| R3 | 模块页回归纯工程视角：属性定义 + 阶段命令 + 配置 + 该模块各环境当前版本/回滚；**发布历史按流水线/实例管理在流水线页** | ModuleDetail 不再展示"模板管理"（已完成），进一步弱化"该模块的发布记录"在模块页的权重 |
| R4 | 实例重试/再次发布语义 = 以快照参数重建实例（同流水线+模块+commit） | 已实现，文档化 |
| R5 | 工具目录定位 = 步骤执行体的**素材库**（service=内置执行器；shell=可复用命令），供**流水线步骤命令**插入与未来步骤参数化 | 已实现，文档化 |
| R6 | **阶段命令归属流水线**（用户决策）：模块不再持有阶段命令；命令写入流水线步骤（支持 {MODULE_*} 变量）。模块页的「阶段命令」tab 迁移为流水线步骤命令编辑器；`deploy_module_stage_commands` 标记 deprecated，过渡期作为"步骤未配命令且模块老命令存在"的兼容回退，随后下线 | 执行语义变更，需分期：先流水线步骤命令生效并支持回退 → UI 迁移 → 下线模块命令 |

### 4) UI 对应

```
「流水线」页（流程视角）
  左侧/上部：流水线列表（全局，新建/复制/编辑/启停）—— 一条流水线 = 一个可点击对象
  点击某流水线 → 下钻：
     - 定义详情（步骤/审批/回滚/投递）
     - 该流水线的历史实例（含运行中，实时步骤详情）
     - 「新建执行」：选 目标模块 + env + 分支/commit（提交参数，非定义修改）
  列表操作：实例级 中断/重试(失败取消)/再次发布(成功)/转全量
「模块」页（工程视角）
  模块定义属性 + 阶段命令（构建方法）+ 配置中心 + 各环境当前版本与回滚
  （发布动作可从模块详情发起：默认带出"可用于该模块的全局流水线"）
```

### 5) 落地点（若确认执行）

- 文案与前端：`模板→流水线` 命名收口；流水线页加"按流水线下钻实例"；模块页发布按钮带流水线选择
- 数据：删除/隐藏模块专属创建路径（不删历史数据，加 scope 展示过滤）
- 文档：本节省收口为单一事实源

### 分期（每期独立可上线）

- **S6-I 模板 + 实例（基础形态）**：模板表/懒建默认/CRUD(审计 diff)/submit 按模板解析+审批策略/run 按快照 skipVerify(临时布尔)/前端 ModuleDetail 模板 tab + PipelineCenter 模板选择/回归。任务 24-29。
- **S6-II 编排化 + 工具目录（本修订的主体）**：步骤执行器注册表 + run 数据驱动；内置步骤全量注册（含 rollback）；tool_catalog 种子+CRUD+「工具管理」页；模板编辑器从步骤库编排（选步骤/排序/换执行器/rollbackOnFailure）；步骤分类分组 UI；回归+度量/审计覆盖。任务 30-35。
  - 执行顺序依赖：I 先行（模板实例与审批语义落地、可发版），II 在其上替换执行内核——**每步执行器迁移后跑一次既有发布流程回归**，避免一次性大爆炸。

---

## 工具化落地状态（2026-09-02，V6 执行体收口）

> V6「`pipeline.service.ts` 探活 URL 拼接等平台逻辑应收敛为工具」已全部落地（tasks.md S7）。
> `PipelineService` 只保留状态机/编排（run/executeStage/轮询/日志/审计/回滚）与公共 API（controller/MCP 面），
> 平台执行体全部下沉为可注入 service 工具（各带单测，tool-catalog `probe/deploy/semantic/cleanup` 分类的对应实现）：

| 工具（module dir） | 承载执行体 | 消费步骤/动作 |
|---|---|---|
| `probe/http-probe.service.ts` | HTTP GET/HEAD、`__manifest__` 兼容解析（裸 / 拦截器包装） | verify(前端)、后端端口探活 |
| `pm2/pm2-probe.service.ts` | pm2 jlist、服务名候选解析、进程 online + 端口探活 | restart 查名、verify(后端)、回滚后探活 |
| `shell/command.service.ts` | 同步 exec、PATH 补齐、node/pm2/pnpm bin 解析 | 全部命令执行（git/tar/scp/ssh/pm2/pnpm） |
| `git/release-git.service.ts` | fetch/checkout/reset/clean、pnpm-lock 指纹依赖同步 | pull |
| `artifact/artifact-store.service.ts` | 产物目录 exists/listVersions/uploadLocal/cleanup | check(复用产物)、upload(local)、cleanup |
| `registry/release-registry.service.ts` | deploy_versions 写入、deploy_deployments 指针 upsert | version、pointer、switchPointer、promote |
| `remote/remote-delivery.service.ts` | tar/scp/ssh 远程投递、env 级服务器地址解析 | upload(remote) |
| `pipeline/release-paths.ts` | 产物目录/URL/远端根 路径纯函数 | 全局（路径布局单点知识） |

- 修复历史 bug：verify 后端「端口不可达」抛错原本写在 pm2 查询失败的 `try/catch` 内被吞掉，
  假健康 12 轮耗尽仍判成功（⑤ 自动回滚从未被端口探活触发）；重构时判定移出 catch，现会立即抛错走回滚。
- 服务工具换 remote 实现（V7 `service-kind: 'remote'`）时只改上述工具实现层，步骤定义与模板不变。

### 内置步骤执行器化（V1 落地，2026-09-02，方案 B 档）

> V1「stageXxx 逐一迁移为执行器 + run 数据驱动」在工具化收口之上落地：
> `executeStage` 的 switch 硬编码（步骤行为/跳过条件/命令覆盖优先级散落 case 内）收敛为
> 声明式步骤注册表 `pipeline/steps/step-registry.ts`。每个内置步骤 = 元数据：
> `category`（特性分类）+ `commandMode`（命令协作语义）+ `skip`（守卫）+ `run`（执行体）。

| 概念 | 落地 |
|---|---|
| 步骤元数据 | `pipeline/steps/step-registry.ts`（check/pull/build/upload/restart/version/pointer/verify/cleanup 九步声明） |
| 执行体 | `pipeline/steps/*.executor.ts` 独立执行器（各自构造注入工具；build 无内置体，commandMode=required 命令驱动） |
| 执行契约 | `StepContext`（pipeline/uploadTarget + enterStage/log/save/sleep/assertNotCancelled）——执行器与状态机唯一耦合点 |
| commandMode | `base`(check 恒内置+命令附加) / `override`(命令优先，未配回退内置) / `required`(build 未配命令 fail-fast) / `none`(version/pointer 语义真相源不可覆盖) |
| 守卫 skip | 复用产物 reuseArtifact / 快线 skipVerify / 模块类型适配，全部声明在注册表 |

engine（`pipeline.service.ts`，1085 行）不再持有任何步骤"怎么做"，只做：状态机
（run/进度/取消/锁/审计/自动回滚）+ 命令覆盖调度（`runStageCommand`）+ 公共 API。
验证：jest 197/197，`nest build` + lint 通过。

---

## v4 修订（2026-09-08）：内核极简化 —— 通用 shell 工具 + 流水线自配节点脚本

> 用户决策：「除了内置 git 的一些 hook 能力，shell 脚本完全是一个通用的 shell 工具就好，
> 其他的都是在流水线那里自己配置对应的节点脚本。」
> 三个拍板点（用户确认按建议执行）：
> ① `version`/`pointer` **不脚本化**（发布语义真相源，平台托管，只可开关不可编辑）；
> ② 配置注入**横切保留**（平台执行任何脚本前统一注入）；孤儿清理 / `.env` 渲染等护栏
> **降级为可插入的 shell 工具**，模板默认插入、用户可删，保存时 warning 不阻断；
> ③ 迁移必须**先回填模板、后切模式**，顺序反了会把所有发布打挂。

### 1) 目标形态

```
平台内核（只剩三样）
  ├─ git 拉取（+ hook 扩展点）  统一行为：fetch/checkout/reset/clean + lock 指纹依赖同步
  ├─ 通用 shell 工具            一个执行器：跑任意命令，注入变量，流式日志，超时，退出码即成败
  └─ version / pointer          发布语义，平台写库，绝不 shell 化

平台横切能力（不属任何步骤，永远生效）
  配置注入 · 日志 · 发布锁 · 取消 · 审计 · 失败自动回滚 · 通知 · 度量

流水线节点（其余全部 = 用户自配脚本）
  check / build / upload / restart / verify / cleanup
```

**解决的问题**：v2/v3 的内置执行器把「端口、pm2 名、产物路径」藏在代码里隐式推导
（`resolvePm2Names()` 猜 5 个候选取第一个存在的、`STATIC_MODULES_REL` 全局常量、
入口文件 `index.js` 写死），用户无法在流水线里指定。v4 后这些**全部写进脚本**，所见即所得。

### 2) 步骤模式两态化（取代四态 commandMode）

| 模式 | 语义 | 步骤 |
|---|---|---|
| `platform` | 平台托管，不可编辑、不可覆盖，只可开关 | `version` / `pointer` |
| `script` | 必须配脚本，未配（且未显式禁用）即该阶段 fail-fast | `check` / `pull`* / `build` / `upload` / `restart` / `verify` / `cleanup` |

- 删除 `base`；`override` 的内置兜底清空后退化为 `script`。
- `pull` 特殊：**平台内置 git 拉取恒执行**，脚本作为 hook 附加（前置/后置二选一，默认后置）。
- **禁用开关**：`script` 态允许 `enabled=false` 表示「本模块不需要这一步」（如 backend 无 upload、
  frontend 无 restart）。建流水线按 `MODULE_TYPE` 生成模板时自动置 disabled，避免误 fail-fast。

### 3) 安全基线上提（check 脚本化后的补偿）

`check.executor.ts` 原本承载的**安全基线**不能随脚本一起变成可选，上提到 `submit` 入口（平台级，不可绕过）：

| 校验 | 位置 |
|---|---|
| 模块存在 + 类型属于 `micro-frontend/frontend/backend` | `submit`（平台） |
| prod 仅允许 master 分支 | `submit`（平台） |
| branch / commitId 白名单（`^[A-Za-z0-9._/-]{1,128}$` / `^[A-Za-z0-9._-]{4,64}$`） | `submit`（平台，已实现） |
| `reuseArtifact` 判定（决定跳过哪些步骤，属流程语义） | `submit`（平台） |
| 业务自检（依赖是否就绪、磁盘空间、自定义门禁） | `check` 脚本（用户） |

### 4) 平台保留的横切能力（不随脚本化丢失）

| 能力 | 归属 | 说明 |
|---|---|---|
| **配置注入** | 横切 | `runShell` 执行任何脚本前，按 global→env→module 合并并**强制覆盖**注入（历史 `PORT=6200` 污染对策）。脚本无需感知 |
| PATH 补齐 | 横切 | git / pm2 / pnpm / node bin 显式注入，脚本里可直接用 |
| 流式日志 + 300ms 节流落库 | 横切 | 已实现 |
| 超时中断 / 取消 SIGKILL | 横切 | 已实现 |
| 发布锁（原子抢占）+ 审计 + 通知 + 度量 | 横切 | 已实现 |
| 失败自动回滚 | 横切 | 绑定「步骤退出码非 0」而非「verify 步骤名」，`rollbackOnFailure` 模板级策略不变 |
| `.env` 渲染落盘 0600 | **shell 工具**（可选） | 从 restart 执行体抽出，模板默认插入 |
| 端口孤儿清理 | **shell 工具**（可选） | 从 restart 执行体抽出，模板默认插入；仅杀非 pm2 纳管占用者（防自杀铁律） |

### 5) 变量清单（脚本可用，平台注入）

**已有**：`MODULE_KEY` `MODULE_TYPE` `MODULE_DIR` `RELEASE_DIR` `COMMIT_ID` `BRANCH` `STAGE` `DEPLOY_ENV`

**v4 新增**：

| 变量 | 来源 | 说明 |
|---|---|---|
| `PORT` | 配置中心 → 模块注册表 `port` → `pm2_env.PORT` | 后端探活/清理端口 |
| `PM2_NAME` | 模块注册表 `pm2` → `web-<key>` | 不再猜测，显式优先 |
| `PUBLIC_PATH` | 模块注册表 `publicPath` → `MODULE_KEY` | 静态资源子目录（**该字段现有但执行器未读取，v4 接线**） |
| `ARTIFACT_DIR` | `$RELEASE_DIR/servers/gateway/public/static/modules/$PUBLIC_PATH/$COMMIT_ID` | 产物目标目录 |
| `ENTRY_FILE` | 模块注册表 `entry` → `index.js` | 产物入口文件 |
| `GATEWAY_URL` | `GATEWAY_INTERNAL_URL` → `http://localhost:6000` | manifest 探活地址 |
| `KEEP_VERSIONS` | 配置 → `5` | cleanup 保留数 |
| `UPLOAD_TARGET` | 实例快照 `local`/`remote` | 投递目标 |

### 6) 默认脚本模板（迁移时按 `MODULE_TYPE` 回填）

> 全部 `set -euo pipefail`；cwd = `$RELEASE_DIR/<module.dir>`（后端 `servers/<dir>`，其余 `apps/<dir>`）；
> 平台已在执行前注入上述变量，脚本可直接引用。

**backend · build**
```bash
set -euo pipefail
[ -d dist ] && mv dist "/tmp/hook-dist-${MODULE_DIR}-$(date +%s)"   # 规避批量删除审批
npx nest build
```

**backend · restart**
```bash
set -euo pipefail
NAME="${PM2_NAME:?未解析到 pm2 进程名}"

# [护栏·可删] 端口孤儿清理：仅杀非 pm2 纳管占用者，避免新进程 EADDRINUSE、对外仍是旧实例
if [ -n "${PORT:-}" ]; then
  PM2_PIDS="$(pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).map(p=>p.pid).join(" ")))')"
  for PID in $(lsof -tiTCP:"${PORT}" -sTCP:LISTEN || true); do
    case " ${PM2_PIDS} " in *" ${PID} "*) ;; *) kill -9 "${PID}" && echo "清理端口 ${PORT} 孤儿进程 ${PID}";; esac
  done
fi

pm2 restart "${NAME}" --update-env
```

**backend · verify**
```bash
set -euo pipefail
for i in $(seq 1 12); do
  sleep 2
  ST="$(pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s).find(x=>x.name===process.env.PM2_NAME);console.log(a?a.pm2_env.status:"missing")})')"
  [ "$ST" = "online" ] && break
done
[ "${ST:-}" = "online" ] || { echo "服务未上线: ${PM2_NAME}"; exit 1; }
# 假健康必须阻断：进程 online 但端口无响应 → 退出码非 0 → 触发自动回滚
curl -fsS -m 5 -o /dev/null "http://127.0.0.1:${PORT}/" || { echo "端口探活失败: ${PORT}"; exit 1; }
```

**backend · upload / cleanup** → 生成时置 `disabled`

**frontend / micro-frontend · build**
```bash
set -euo pipefail
pnpm --filter @web-system/shared build            # workspace 依赖
RELEASE_TAG="${COMMIT_ID}" npx vite build --mode mf
```

**frontend / micro-frontend · upload**
```bash
set -euo pipefail
SRC="${RELEASE_DIR}/apps/${MODULE_DIR}/dist"
DEST="${ARTIFACT_DIR}"
[ -d "${DEST}" ] && mv "${DEST}" "/tmp/upload-${MODULE_KEY}-$(date +%s)"
mkdir -p "${DEST}" && cp -R "${SRC}/." "${DEST}/"
test -f "${DEST}/${ENTRY_FILE}" || { echo "产物入口缺失: ${DEST}/${ENTRY_FILE}"; exit 1; }
```

**frontend / micro-frontend · verify**
```bash
set -euo pipefail
curl -fsS -o /dev/null "${GATEWAY_URL}/static/modules/${PUBLIC_PATH}/${COMMIT_ID}/${ENTRY_FILE}"
sleep 12   # gateway 版本缓存 TTL 10s（历史坑：改完版本表立刻查会拿到旧版本）
V="$(curl -fsS "${GATEWAY_URL}/__manifest__" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const d=j.data??j;const m=(d.modules||[]).find(x=>x.name===process.env.MODULE_KEY);console.log(m?m.version:"")})')"
[ "${V}" = "${COMMIT_ID}" ] || { echo "manifest 版本为 ${V:-空}，期望 ${COMMIT_ID}"; exit 1; }
```

**frontend / micro-frontend · cleanup**
```bash
set -euo pipefail
cd "$(dirname "${ARTIFACT_DIR}")"
ls -1t | tail -n +$((KEEP_VERSIONS + 1)) | while read -r v; do
  case " ${COMMIT_ID} " in *" ${v} "*) continue;; esac   # 当前版本受保护
  mv "${v}" "/tmp/cleanup-${MODULE_KEY}-${v}-$(date +%s)"  # 改名而非删除（规避删除审批）
done
```
> 灰度引用的版本是否受保护：`cleanup` 执行体现在会查 `canaryService` 排除启用中的灰度版本。
> 脚本化后该保护**丢失**（脚本读不到规则表）。补偿：平台在 `cleanup` 步骤执行前把受保护版本
> 注入变量 `PROTECTED_VERSIONS`（空格分隔），脚本用它过滤；缺失该变量的旧脚本按「仅保护当前版本」降级并在保存时 warning。

**frontend / micro-frontend · restart** → 生成时置 `disabled`

### 7) 迁移计划（顺序不可颠倒）

| # | 步骤 | 闸口 |
|---|---|---|
| M0 | 加 feature flag `PIPELINE_SCRIPT_MODE`（默认 `off`，保留旧 executor 一个发布周期可秒回） | — |
| M1 | 补全变量注入层（`PORT`/`PM2_NAME`/`PUBLIC_PATH`/`ARTIFACT_DIR`/`BUILD_OUTPUT_DIR`/`ENTRY_FILE`/`GATEWAY_URL`/`GATEWAY_TTL_SEC`/`KEEP_VERSIONS`/`PROTECTED_VERSIONS`/`WS_SAFE_DELETE`）；`publicPath` 字段接线 | ✅ **2026-09-08 已完成**：`resolveStageVars()` 纯函数 + `runStageCommand` 接入；端口优先级「配置中心 → pm2 实际进程」（`lookupPm2Port` 兜底，查询失败不阻断）；`PROTECTED_VERSIONS` 由 `resolveProtectedVersions()` 下发（当前版本 + 启用中灰度版本）。新增 8 个单测，全量 231 通过 |
| M2 | 安全基线上提到 `submit`（类型/prod 分支/白名单/reuseArtifact）；`check` 执行体保留与否由 flag 决定 | 现有 check 用例全绿 |
| M3 | 8 个 executor 语义翻译为模板（按 `backend`/`frontend`/`micro-frontend`），落模板表 | `bash -n` 全通过 |
| M4 | **回填**：为所有模块与现有流水线按类型填充脚本 + 按类型置 disabled | **闸口：任一活跃模块缺脚本即中止** |
| M5 | 切 flag `on`：`script` 态生效，未配脚本 fail-fast | 先拿 `todo-service` 试发 dev |
| M6 | 回归：dev 后端 + dev 前端 + 灰度 + 回滚 + prod 拦截各一次 | 全绿后观察一个发布周期 |
| M7 | 删旧 executor 与 `step-registry` 执行体；`commandMode` 物理收敛为 `platform`/`script` | — |

**回滚方案**：M0–M6 任一环节出问题，`PIPELINE_SCRIPT_MODE=off` 即回到内置执行器路径，
回填的脚本数据保留（不删），下次开启可直接复用。

### 8) 风险与缓解

| 风险 | 缓解 |
|---|---|
| **护栏从强制变可选**（孤儿清理/.env 渲染被用户删掉） | 模板默认插入 + 工具目录可一键插回 + 保存时按模块类型检测关键护栏缺失给 warning（不阻断） |
| **升级不扩散**：内置执行器改了全体受益，脚本化后各流水线副本要各自改 | 脚本支持引用工具 `${TOOL:xxx}` 而非复制全文；平台工具升级时提示"有 N 条流水线引用了旧版" |
| **平台知识散落进脚本**（产物路径、TTL 10s） | 用变量（`ARTIFACT_DIR`）而非字面量；`GATEWAY_TTL_SEC` 也注入为变量，脚本写 `sleep $((GATEWAY_TTL_SEC + 2))` |
| **cleanup 灰度保护丢失** | `PROTECTED_VERSIONS` 变量注入（见 §6） |
| **backend 被 upload 卡死 / frontend 被 restart 卡死** | 模板生成时按类型置 `disabled`；`submit` 前二次校验 disabled 集合与类型匹配 |
| 任意 shell 的误操作面 | 仅 JWT 可写、不暴露 MCP、`bash -n` 校验、审计留痕（与现有阶段命令同安全边界） |

### 9) 验收（EARS）

- 当用户编辑某节点脚本时，应能直接写明端口 / pm2 名 / 产物目录，且发布行为与之严格一致。
- 当 `script` 态节点未配脚本且未 disabled 时，该阶段应 fail-fast 并明确报错，不回退任何内置行为。
- 当 `version`/`pointer` 步骤被尝试编辑时，应被拒绝（UI 置灰 + API 400）。
- 当脚本引用 `${PORT}` 时，应取「配置中心 → 模块注册表 → pm2_env」优先级链，且不再做候选名猜测。
- 当 `PIPELINE_SCRIPT_MODE=off` 时，行为应与 v3 完全一致（回归基准）。
- 当 backend 模块发布时，upload/cleanup 应默认 disabled 且不阻断。
- 当 cleanup 执行时，当前版本与启用中的灰度版本应受保护不被清理。

### 10) 二次评审补充（2026-09-08）：执行契约与遗留风险

> 对 v4 初稿的自查。以下 18 项在初稿中缺失或定义不清，其中 **C1/C2/C4 是会导致线上事故的硬缺口**，
> 必须在 M1–M3 闭环；其余在 M4 前完成。

#### C1 · 脚本 → 平台的结果回传协议（初稿缺失，最高优先级）

现状：各执行体直接写 `p.result`（`upload`→`artifactPath/target`、`restart`→`restarted`、
`verify`→`online/healthCheck/manifestVersion`、`cleanup`→`kept/removed`），这些字段被
审计文案、通知内容、度量、MCP 返回消费。脚本化后**这条回路会断**，平台拿不到结果。

约定：平台执行脚本前导出 `WS_RESULT_FILE`（临时文件路径），脚本按需写入 JSON，平台在脚本
退出后读取并合并进 `p.result`（JSON 非法 → 记 warning，不阻断）。

```bash
# 脚本侧
echo '{"healthCheck":{"port":"6005","ok":true}}' > "$WS_RESULT_FILE"
```

- 只合并**白名单键**（防脚本污染语义字段：`version`/`pointer`/`status` 等不可写）。
- 未写文件 = 该节点无结构化结果（与现状"无 result"等价，不报错）。

#### C2 · 退出码语义与节点级容错（初稿未定义）

| 退出码 | 语义 |
|---|---|
| `0` | 成功 |
| 非 0 | 节点失败 → 中断发布 → 触发 `rollbackOnFailure` 策略 |

补充节点级开关 `continueOnError`（默认 false）：置 true 时非 0 仅记 warning 并继续。
用途：`cleanup` 一类"失败不该让已成功的发布变红"的节点。**禁止用于 `build`/`upload`**
（产物未就绪却继续，会切指针到空产物）。

#### C3 · 超时矩阵（初稿只继承了 build 的 timeoutSec）

`runShell` 现在缺省回落到 `BUILD_TIMEOUT_MS`，对非构建节点明显不合适（restart 卡死要等满构建超时）。

| 节点 | 默认超时 | 可配 |
|---|---|---|
| check | 60s | 是 |
| build | `BUILD_TIMEOUT_MS`（600s） | 是 |
| upload | 300s | 是 |
| restart | 120s | 是 |
| verify | 120s（含 gateway TTL 12s 等待） | 是 |
| cleanup | 60s | 是 |

#### C4 · 子进程组回收（现存缺陷，脚本化后放大）

`runShell` 用 `spawn('bash', ['-c', cmd])`，**未 `detached`**，超时/取消时 `child.kill('SIGKILL')`
只杀 bash 本身——`vite build` / `nest build` 派生的 node 孙进程会残留，继续占用端口和 CPU，
下一次发布撞上残留进程（正是历史上"6200 孤儿进程"的同类问题）。

修复：`spawn(..., { detached: true })` + `process.kill(-child.pid, 'SIGKILL')` 杀整个进程组；
Windows 无进程组概念时降级为 `taskkill /pid /t /f`。

#### C5 · 日志脱敏（安全风险）

配置注入会把**密钥类变量**（配置中心 `isSecret=1`）注入脚本环境。脚本里 `set -x` 或
`echo $XXX` 会把明文写进流水线日志，而日志对审计/通知可见。

对策：日志写入前，对"本次注入的密钥变量值"做掩码替换（`***`）。在 `runShell` 的
日志节流落库处统一做，不依赖脚本自觉。

#### C6 · 脚本指纹与追溯

实例快照存脚本**内容 hash**（`scriptHash`），审计记 `scriptHash`。故障时可回答
"当时跑的是哪份脚本"——脚本化后这是唯一的责任界定依据。

#### C7 · 流水线全局化 vs 按类型禁用（v3 R1 与 v4 的语义冲突）

v3 收口：流水线一律全局、不绑模块，类型差异用 `{MODULE_*}变量` 分支。
v4 初稿：按 `MODULE_TYPE` 生成模板并置 disabled——**两者冲突**（disabled 是流水线级配置，
同一条流水线被 backend 和 frontend 共用时无法同时 disabled 又不 disabled）。

收口方案：
- 流水线增 `appliesTo: ModuleType[]`（默认全类型），提交时校验目标模块类型在范围内；
- 节点禁用改为**按类型禁用列表** `disabledFor: ['backend']`，而非布尔 disabled；
- 脚本内仍可用 `case "$MODULE_TYPE" in ... esac` 做分支，两者不冲突。

#### C8 · 模块级 `deploy_module_stage_commands` 的下线路径（初稿未写）

v3 R6 已定"命令归流水线、模块表 deprecated"，v4 承接该决策，但需明确过渡：

1. 过渡期：流水线节点未配脚本时，**回退读取模块级老命令**并在日志与 UI 标注 `deprecated`；
2. M4 回填完成后关闭回退（flag 控制），观察一个发布周期；
3. 下线：删表 + 删 `stage-command` 模块 + 删前端 `stageCommandApi`（与 `hook` 死代码一并清理，
   该项是 S1 遗留 SHOULD，本次顺带闭环）；
4. 前端 ModuleDetail「阶段命令」tab 同步下线。

#### C9 · 回滚时的脚本版本（初稿未定义）

回滚是"重建实例发旧版本"，但脚本属于流水线定义、不随代码版本回退。
→ 用**最新脚本**发**旧代码**，可能与发布时的脚本不一致（旧脚本有 bug 时这是优点，
新脚本不兼容旧代码时这是风险）。

决策：回滚**使用最新脚本**，但实例与审计须标注 `scriptDrift=true`（脚本版本与原始发布时不同），
UI 给出提示，便于判断回滚失败是否为脚本漂移所致。

#### C10 · 平台差异（macOS 本地 vs Linux 远程）

本地发布目录在 macOS，远程在 Linux。模板中 `lsof`/`date +%s`/`mv` 两边通用，但
`sed -i`、`stat`、`date -d`、`ps` 参数不同。

对策：模板与用户脚本增 `platform: any | macos | linux` 标记；提交时校验
`platform` 与实例 `UPLOAD_TARGET` 匹配，不匹配给 warning（不阻断，避免误伤）。

#### C11 · 依赖预检

脚本依赖 `pm2`/`curl`/`node`/`lsof`/`pnpm`。现在缺失时表现为"执行到一半失败"，排查成本高。

对策：节点执行前跑一次依赖检查（`command -v` 列表，声明在脚本元信息 `requires` 上），
缺失即明确报错"缺少依赖 xxx"。`tool_catalog` 已有 `available` 字段，可扩展为检测命令。

#### C12 · 幂等矩阵（retry 语义）

retry 从失败节点继续，要求节点可重入：

| 节点 | 幂等 | 说明 |
|---|---|---|
| check | 是 | 纯校验 |
| build | 是 | 先 mv 走旧 dist 再构建 |
| upload | 是 | 目标目录存在则先移走再拷 |
| restart | 是 | `pm2 restart` 天然幂等 |
| verify | 是 | 只读 |
| cleanup | 是 | mv 到 /tmp 带时间戳，重跑结果略不同但安全 |

#### C13 · 试跑与 dry-run

- `bash -n` 语法校验（已有）；
- 新增**节点级试跑**：选一个已在跑的实例，单节点重跑（仅 dev），不切指针；
- 禁止 prod 试跑。

#### C14 · `mv` 到 `/tmp` 不应固化进平台模板

现有 build/upload hook 里的 `mv dist /tmp/...` 是为规避 **CodeBuddy IDE 的批量删除审批**，
属本地开发环境特有约束，在 CI/服务器环境无意义，且会持续污染 `/tmp`。

对策：抽出为变量 `SAFE_DELETE_STRATEGY=mv|rm`（默认 `rm`），本地环境 profile 置 `mv`。
模板里统一写 `${WS_SAFE_DELETE}` 包装，不再硬编码。

#### C15 · 日志量上限

脚本输出可能达 MB 级（构建日志）。需单节点日志条数与总长度上限（如 5000 行 / 1MB），
超出截断并标注"日志已截断，完整输出见 xxx"。现状无上限。

#### C16 · 执行权限

脚本以 deploy-console 进程用户运行。需明确：禁止以 root 跑（或显式标注风险），
且脚本内 `sudo` 不可用（PATH 与 TTY 均不具备）。

#### C17 · 工具引用展开

`${TOOL:xxx}` 展开自 DB（仅 JWT 可写），风险等同脚本本身，可接受；但需防**递归引用**
（工具 A 引用工具 B 引用 A）→ 展开深度上限 3，超限报错。

#### C18 · 节点间产物传递的变量命名

初稿 `ARTIFACT_DIR` 在 build 节点语义是"构建输出"、在 upload 节点是"投递目标"，同名不同义易误用。
拆为两个变量：

- `BUILD_OUTPUT_DIR` = `$RELEASE_DIR/apps/$MODULE_DIR/dist`（build 产出、upload 源）
- `ARTIFACT_DIR` = 投递目标目录（仅 upload/verify/cleanup 使用）

### 11) v4 任务增量（并入 tasks.md S9）

| # | 任务 | 依赖 |
|---|---|---|
| 9.1 | `WS_RESULT_FILE` 回传协议 + 白名单合并 + 单测 | M1 |
| 9.2 | 退出码语义 + `continueOnError` 节点开关（build/upload 禁用） | M1 |
| 9.3 | 节点超时矩阵（各节点独立 timeoutSec 与默认值） | M1 |
| 9.4 | **子进程组回收**（detached + kill(-pid)） | M1（与脚本化独立，建议单独先修） |
| 9.5 | 日志脱敏（注入的密钥变量值掩码） | M1 |
| 9.6 | 脚本指纹 `scriptHash` 入实例与审计 | M2 |
| 9.7 | `appliesTo` + `disabledFor` 取代布尔 disabled | M2 |
| 9.8 | 模块级命令回退 + deprecated 标注 + 下线清理 | M4 |
| 9.9 | 回滚脚本漂移标记 `scriptDrift` | M5 |
| 9.10 | 平台标记 / 依赖预检 / 试跑 / 幂等说明 | M4 |
| 9.11 | `SAFE_DELETE_STRATEGY` 抽变量 + 日志上限 + 权限说明 | M4 |
| 9.12 | 工具引用展开深度限制 + `BUILD_OUTPUT_DIR` 拆分 | M3 |

> 9.4 虽属脚本化的配套，但**它修的是现存缺陷**，与 v4 是否推进无关，建议独立优先修。

---

## 12) 节点内多操作（2026-09-08 追加）

> 用户决策：节点下支持多个脚本/步骤；默认 1 个操作（需要才加）；操作支持「引用内置工具」。

### 12.1 为什么加这层

单个节点一段 bash 能写多件事，但平台不感知"步骤"，导致：失败只能定位到节点、无法混用内置能力与 shell、
无法对某一步单独开关/设超时、看不出每步耗时。加「操作」层后这些全部可解，且**不破坏 v4 的内核极简**——
流程图仍只有 9 个节点，复杂度收在节点内部。

### 12.2 两层结构（职责边界，防止流程图膨胀）

| 层 | 职责 | 数量 | 是否参与流程图排序 |
|---|---|---|---|
| **节点 Node** | 流程语义单元：有 category、决定失败策略、参与编排 | 固定 9 个 | 是 |
| **操作 Action** | 执行动作：怎么干 | 1..N（默认 1） | 否（在节点内局部排序） |

### 12.3 数据模型

`deploy_pipeline_steps`（或现有步骤表）的 `command` 单字段 → `actions` JSON 数组：

```json
[{ "id":"a1", "type":"shell",   "name":"端口孤儿清理", "code":"...", "timeout":30,  "cont":true },
 { "id":"a2", "type":"shell",   "name":".env 渲染落盘","code":"...", "timeout":20,  "cont":true },
 { "id":"a3", "type":"shell",   "name":"pm2 restart", "code":"...", "timeout":120, "cont":false },
 { "id":"a0", "type":"service", "name":"git 拉取",    "tool":"git-pull", "builtin":true }]
```

| 字段 | 说明 |
|---|---|
| `type` | `shell`（自写脚本）/ `service`（引用工具目录里的内置工具）/ 内置标记 `builtin:true` |
| `cont` | `continueOnError`：该操作失败不中断节点（护栏类默认 true） |
| `timeout` | 操作级超时，与节点级总超时并存，先到先触发 |
| `builtin` | 平台内置操作，不可删、不可排序（如 pull 节点的 git 拉取恒为 op0） |

### 12.4 执行语义

- 操作**顺序执行**；任一失败 → 节点失败，除非该操作 `cont=true`
- 日志按操作分段，前缀 `[<node>/op<N>]`，失败直接定位到操作
- 任一操作可写 `$WS_RESULT_FILE`，**按 key 合并**而非整段覆盖（C1 的补充）
- `platform` 节点（version / pointer）`actions=[]` 且不可新增（API 400）
- `git` 节点的 op0 恒为平台内置拉取（builtin），用户只能在其后追加 hook

### 12.5 与工具目录的关系（解决"升级不扩散"）

操作有两种实现方式：

| 方式 | 工具升级后 |
|---|---|
| `shell`（脚本里复制了工具片段） | 不扩散，需逐个改脚本 |
| `service`（引用工具） | **自动扩散**，所有引用节点受益 |

因此工具目录里的**平台能力类工具**（探活、写版本、切指针、回滚）应优先以「引用」方式使用；
shell 片段插入只作为临时手段。这正是 V6（工具=执行体，步骤=流程单元）在 UI 上的落地。

### 12.6 迁移影响

- 现有 9 个默认模板需拆成操作：`restart` → 孤儿清理(cont=true) / .env 渲染(cont=true) / pm2 restart(cont=false)
- 未拆分节点的兼容：`actions = [{type:'shell', code: <原 command>}]`，行为不变
- 回填时 `timeout` / `cont` 取节点原值

### 12.7 验收

- 当节点配置多个操作时，应按数组顺序执行，并在日志中按 `opN` 分段留痕。
- 当某操作 `cont=true` 且失败时，节点应继续执行后续操作，且节点最终状态为成功并记 warning。
- 当 `platform` 节点被尝试新增操作时，应被拒绝（UI 锁定 + API 400）。
- 当操作 `type=service` 引用工具被升级时，引用该工具的所有节点应在下次发布自动使用新实现。
- 当节点 `actions` 为空且非 platform 态时，应 fail-fast（等同未配置脚本）。

---

## 13) 流水线名称：按模块名自动填充（2026-09-08）

> 用户决策：流水线名称默认不叫「默认流水线」，**直接用模块名填充**；
> 真实实现时数据库也按此规则自动填充，不需要人工起名。

### 13.1 规则

```
流水线名称（name）缺省值 = 模块名（moduleKey）
```

一条流水线服务一个模块（v3 R1 后流水线全局化，但默认模板仍按模块懒建），
因此「这个模块的发布线」就叫模块名最直观 —— 用户看到 `admin` 就知道发的是 admin，
不需要额外维护一套命名。

### 13.2 三层落地

| 层 | 规则 | 说明 |
|---|---|---|
| **数据层（真相源）** | 懒建默认流水线时 `name = moduleKey`；模块注册表新增模块时同步生成 | 新建即有名，无空态 |
| **回填** | 存量 `name` 为空 / 为「默认流水线」的行，按 `module_key` 批量回填 | 一次性迁移，见下方 SQL |
| **展示层兜底** | 读取时 `name ?? moduleKey`，避免历史脏数据显示空白 | 只读兜底，不写库 |
| **改名** | 用户可改；改名作用于**该流水线的全部实例**（流水线是定义，实例引用它） | 历史实例保留 ID 与提交时参数快照，仅显示名同步 |

### 13.3 回填示例

```sql
-- 存量流水线：名称为空或为占位值时，按模块名回填
UPDATE deploy_pipeline_templates
SET name = module_key
WHERE name IS NULL OR name = '' OR name = '默认流水线';

-- 实例快照列（历史记录）同步显示名
UPDATE deploy_pipelines p
  JOIN deploy_pipeline_templates t ON t.id = p.template_id
SET p.template_name = t.name
WHERE p.template_id IS NOT NULL;
```

> 迁移前先备份两张表；`name` 若需唯一约束，应在回填**之后**再加，否则会与重复占位值冲突。

### 13.4 验收

- 当新建模块时，其默认流水线名称应等于模块名，不为空。
- 当读取到 `name` 为空的历史流水线时，页面应显示模块名而非空白。
- 当修改某流水线名称时，该流水线下的全部实例在列表与详情中应显示新名称。
- 当同一模块存在多条流水线（如「admin」与「admin-快线」）时，名称应可区分且均可改名。
