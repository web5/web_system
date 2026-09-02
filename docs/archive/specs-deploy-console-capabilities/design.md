# Deploy-Console 能力建设 · 设计方案

> 类型：design.md（Design 阶段产物）
> 日期：2026-09-02（按 ai-agent-kit 数字人方法论重梳；原稿 2026-09-01）
> 关联：意图 `docs/intents/2026-09-01-deploy-console-capabilities.md` · 需求 `requirements.md` · 实施 `tasks.md`
> 方法论：`ai-agent-kit/skills/rd-plan`（spec 三件套）+ `rd-execute`（TDD 红→绿→重构）+ `rd-review`（独立自检）

## 概要

Deploy-Console = 发布控制台单一入口：

- 前端：Vue3 + Vite + Ant Design Vue（`apps/deploy-console/`）
- 后端：NestJS（`servers/deploy-console/`），模块含 monitor / environment / module / pipeline / hook / audit
- 核心：九阶段流水线 `check→pull→build→upload→restart→version→pointer→verify→cleanup` + 各阶段 Hook（shell，DB 真相源）

结构关系：

```
模块(Module) --buildCmd(构建)--> 产物(Version) --指针--> 环境(Environment)
```

**当前核心缺陷（2026-09-02 排查确认）**：

- `pipeline.service.ts` 的 `stageBuild` 把构建命令硬编码为后端 `nest build` / 前端 `vite build`，模块无法自定义构建；
- 围绕 build 存在两套互斥的既有设计且都未落实：模块表 `deploy_modules.buildCmd`（`release-system-design.md`） vs `deploy_module_hooks` 的 build 阶段脚本（`deploy-pipeline-dev.md:101` 声明「buildCmd 已废弃」）；
- 原方案「发布核心流程保持稳定」被误用为「构建命令可以硬编码」，使 build 一直不是可配置点；
- 技术评审此前只覆盖批 1 的 monitor 5 个文件，`pipeline.service.ts`（发布核心）从未被独立评审——这是缺陷未被拦截的直接原因。

本方案目标：把 build 收敛为**模块级可配置的 shell 命令**，并修复文档事实源冲突。

## 关键决策

1. **build 真相源统一为 `deploy_modules.buildCmd`（已定）**
   - 决策：build 阶段只执行模块的 `buildCmd`；build 阶段 Hook 不再作为构建命令来源。
   - 理由：`buildCmd` 与模块一对一、语义单一（产出产物）、页面可配置；Hook 是「覆盖整阶段」的重型机制，用于 build 会与 version/pointer 等流水线固定职责混淆。
   - 依据：用户 2026-09-02 指令；`stageBuild` 已按此改造。

2. **buildCmd 缺失即失败（fail-fast，不回退内置）**
   - 决策：模块未配置 `buildCmd` 时，pipeline 停在 build 阶段并报明确错误，**绝不静默回退**到内置 `nest build`/`vite build`。
   - 理由：回退硬编码会掩盖配置缺失，重演「改一条构建命令要改 TS → 重建控制台」的问题。

3. **重新定义「发布核心稳定」**
   - 决策：稳定 = 九阶段编排与状态机稳定；**构建命令属于模块级配置数据，不属于稳定核心**。
   - 影响：修正 `requirements.md` 中把 `stageBuild` 硬编码合理化的原则表述。

4. **pipeline.service.ts 纳入独立子代理评审**
   - 决策：凡涉及 build/pipeline 的改动，必须经独立子代理评审，结论写入本文档「评审结论」节。
   - 理由：历史评审范围过窄，发布核心从未被审。

5. **文档单一事实源**
   - 决策：本文档为 build 机制的**唯一事实源**；`deploy-pipeline-dev.md:101`（buildCmd 已废弃）与 `release-system-design.md`（buildCmd 字段）的矛盾表述必须对齐（任务 T4）。

6. 沿用原分批策略与其余能力（③④⑤⑥⑦⑨⑩ / ⑪⑫⑬⑭⑯⑰⑮⑱），不重写发布核心编排。

## 对外交付物

- **数据**：`deploy_modules.buildCmd`（string，bash 语义）为 build 阶段唯一输入。
- **执行语义**：在发布目录模块子目录 `$RELEASE_DIR/<moduleDir>` 下 `spawn('bash', ['-c', buildCmd])`；退出码非 0 → build 阶段失败、中断发布；输出流式进流水线日志。
- **注入环境变量**：`RELEASE_DIR / MODULE_DIR / MODULE_KEY / MODULE_TYPE / DEPLOY_ENV / BRANCH / COMMIT_ID`。
- **接口/页面**：模块详情「构建命令」配置；保存前 `bash -n` 语法校验；**仅控制台 JWT 可写，不暴露 MCP**；变更写审计。
- **文档**：对齐 `deploy-pipeline-dev.md` 与 `release-system-design.md` 中 build 机制的表述。

## 风险与权衡

- 风险：存量模块 `buildCmd` 为 NULL → 发布直接停滞。→ 缓解：按类型提供默认模板（backend→`nest build`；frontend/micro-frontend→`vite build`）+ 一键填充迁移脚本（T2）。
- 风险：历史已配 build 阶段 Hook 的模块与新机制冲突。→ 缓解：迁移时检测并提示转为 `buildCmd`，随后清理 build 阶段 hook（T4）。
- 风险：`buildCmd` 是任意 shell，存在误操作/注入面。→ 缓解：仅 JWT 可写、`bash -n` 校验、审计留痕、不暴露 MCP。
- 权衡：放弃「build 阶段 Hook」会损失整阶段自定义能力。→ 取舍：build 只负责产出产物，整阶段自定义仍可在 check/upload/restart 等其他阶段用 Hook。
- 风险：把 pipeline 纳入评审会拉长每批耗时。→ 缓解：按批评审，仅 build/pipeline 相关改动强制评审。

## 评审结论

> 由独立子代理执行（`rd-review`），结论追加于此。
> 批 1 历史评审（命令注入 / CORS / 异常过滤器 / any 四项 MUST 已清零）见原稿与 `requirements.md`。
> **发布核心 `pipeline.service.ts` 的评审待 T5 执行**（历史盲区，本次补齐）。
