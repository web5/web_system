# kedou-agent · 需求文档（Requirements）

> 状态：方案（待确认）
> 日期：2026-08-25
> 分支：feature/ai-agent-harness
> 决策：monorepo 内 `packages/kedou-agent`；抽公共核心包 `@kedou-ai/agent-core`；增加 web-search 与 coding 工具；生图工具不放入包；无 demo。

## 1. 背景与目标

将 `servers/ai-service` 中已实现的 Agent harness + shell CLI 升级为**可发布的独立 npm 纯 CLI 工具 `kedou-agent`**，满足：

- 用户通过 `npx kedou-agent` 即可交互对话（REPL + 单轮）。
- **用户自带自己的大模型 API key**，不消耗作者 token。
- **生图工具不放入包**（image-gen 属于 ai-service 内部能力，需后端服务支撑，不适合独立 CLI 分发）。
- 增加 `web-search` 与 **coding 工具**（编程/开发场景）。
- 代码在 ai-service 与 CLI 之间**共享同一核心**，避免双份源码漂移。

## 2. 用户故事

1. 作为普通用户，我首次运行 `kedou-agent`，CLI 引导我配置大模型 API key（存本机 `~/.kedou`），配置后才能对话；**未配置无法对话，且不消耗作者 token**。
2. 作为已配置用户，我运行 `kedou-agent` 进入交互式 REPL，连续对话；Agent 可调用内置工具（计算、联网搜索、读取代码文件等）完成推理。
3. 作为开发者，我需要 Agent 具备 **coding 工具**（如读文件、列目录、搜索代码、受限执行 shell），辅助编码任务。
4. 作为开发者，我需要 Agent 能 **web-search**（联网检索 arXiv 论文 / 技术资讯等），无需额外配置密钥。
5. 作为 ai-service 维护者，我希望 harness 核心逻辑与 CLI 共用，改一处两端生效。

## 3. 验收标准（EARS）

### 3.1 独立 npm 包
- When 用户执行 `npx kedou-agent --version`，系统应输出语义化版本号。
- When 用户执行 `kedou-agent --help`，系统应展示子命令列表（chat/config/agents/models/--message）。
- When 用户执行 `kedou-agent`（无参数），系统应进入交互式 REPL 对话。
- While 配置不存在，when 用户尝试 `chat` 或 `--message`，系统应引导配置并拒绝对话（退出码 1）。

### 3.2 配置与安全
- When 用户执行 `kedou-agent config`，系统应交互引导选择模型并输入 API key（TTY 隐藏回显 `*`）。
- While 配置已保存，系统应写入 `~/.kedou/agent-cli.config.json` 且权限为 `0600`。
- While 配置文件存在，when 用户再次运行，系统应直接复用配置，不重复引导。
- While 构建 npm 包，包内**不得包含任何 API key**（`files` 白名单 + pre-publish 扫描）。
- While 展示模型状态（`agents`/`models`），系统不得回显 key。

### 3.3 工具能力
- When Agent 需要联网检索，系统应能调用 `web-search` 工具（通用互联网搜索，插件式 Provider，**默认内置 Bing Web Search API**，其他 Provider 可注册扩展）。
- When Agent 需要读取/搜索代码，系统应能调用 `read-file`、`list-dir`、`grep-search` 等 coding 工具。
- When Agent 需要写文件，系统应能调用 `write-file` 工具（支持新建/覆盖/追加）。
- While 执行任何写文件操作（新建/覆盖/追加），系统应**弹出权限确认**，仅在用户明确确认后写入，否则拒绝并返回"已拒绝"。
- While 使用 coding 工具，系统应限制危险操作，并在工具描述中明确边界。
- When Agent 通过 `shell-exec` 发起删除/覆盖写等危险操作，系统应**弹出权限确认**，仅在用户明确确认后执行，否则拒绝并返回"已拒绝"。
- While 处于非交互环境（无确认器注入），when Agent 发起删除类操作，系统应默认拒绝，不得静默执行。
- When 用户未配置生图，系统不应提供生图工具（image-gen 不打包）。

### 3.4 记忆与模型
- While 长对话，系统应按阈值触发摘要压缩，保留近期消息（行为对齐现有 `Compaction`）。
- When 模型调用失败，系统应给出友好错误并支持重试，不崩溃。
- While Agent 使用了摘要模型，摘要模型应跟随用户所选模型（不硬编码 hy3）。

### 3.5 代码共享
- When 项目构建，ai-service 与 `kedou-agent` 应通过 `@kedou-ai/agent-core` 共用 harness 核心（引擎/注册表/接口/工具）。
- While 在 ai-service 中给 harness 新增工具，CLI 不应出现功能漂移（共用核心）。

## 4. 范围（In/Out）

### In
- 独立包 `packages/kedou-agent`（CLI 层）
- 公共核心包 `@kedou-ai/agent-core`（纯 TS，零 Nest，harness 核心）
- 内置工具：`web-search`（插件式 Provider，默认 Bing）、coding 工具（read-file/list-dir/grep-search/shell-exec 受限）
- CLI 子命令：`chat` / `config` / `agents` / `models` / `--message` / `--version` / `--help`
- 交互配置持久化（`~/.kedou`）+ 安全发布

### Out（本次不做）
- 生图工具（image-gen）——不打包
- demo / 免费模型模式
- ai-service 内部 DB 记忆（`ConversationMemory` 走 DB 的路径）——CLI 用 InMemory
- `web-search` 的付费搜索引擎接入——先用现有零密钥数据源

## 5. 非功能需求
- **运行时零第三方依赖**（原生 fetch / Node ≥18）。
- 纯 CLI 可全局安装：`npm i -g kedou-agent` 或 `npx kedou-agent`。
- Node ≥18（用原生 fetch、AbortSignal.timeout）。
