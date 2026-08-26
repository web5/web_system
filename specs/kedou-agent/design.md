# kedou-agent · 架构设计（Design）

> 状态：方案（待确认）
> 日期：2026-08-25

## 1. 整体结构（monorepo 内双包）

```
packages/
├── agent-core/            # 🆕 公共核心包 @kedou-ai/agent-core（纯 TS，零 Nest，可发布）
│   ├── package.json       # name: @kedou-ai/agent-core
│   ├── tsup.config.ts
│   └── src/
│       ├── index.ts               # 统一导出（引擎/注册表/接口/工具）
│       ├── interfaces/            # tool / agent / runtime 接口（从 ai-service 平移）
│       ├── core/                  # agent-engine / agent-runner（ReAct）
│       ├── registry/              # tool / agent / client registry
│       ├── memory/                # stored-message / in-memory-memory / compaction
│       ├── clients/               # base-ai / hy3 / deepseek（原生 fetch 版）
│       ├── lib/
│       │   ├── logger.ts          # 内置极简 logger（替代 Nest Logger）
│       │   └── timeout.ts         # 内联 API_TIMEOUT 常量（剥离 @web-system/shared）
│       └── tools/
│           ├── web-search.tool.ts     # 通用搜索（插件式 Provider，默认 Bing）
│           └── coding/                 # 🆕 coding 工具集
│               ├── read-file.tool.ts
│               ├── list-dir.tool.ts
│               ├── grep-search.tool.ts
│               └── shell-exec.tool.ts  # 受限白名单执行

└── kedou-agent/           # 🆕 CLI 包（发布为 kedou-agent）
    ├── package.json       # bin + files 白名单 + engines
    ├── tsup.config.ts
    ├── bin/kedou-agent.mjs
    └── src/
        ├── cli/index.ts        # bin 入口：解析 argv → 分发子命令
        ├── cli/commands/       # config.ts / chat.ts / agents.ts / models.ts
        ├── cli/config-store.ts # 交互配置持久化（~/.kedou，权限 600）
        ├── cli/repl.ts         # 交互式 REPL 对话
        └── cli/agents/         # study-assistant / dev-assistant（含 coding 工具）
```

**关键设计**：`@kedou-ai/agent-core` 是两端共享的核心（ai-service 通过它跑 Agent，CLI 也通过它跑 Agent）。ai-service 在其外层保持 Nest 装饰器 + DB `ConversationMemory` + controller，但**引擎/注册表/客户端/工具逻辑来自 agent-core**。

### ai-service 侧改造（收敛到 agent-core）
- `servers/ai-service/src/agent/core/*`、`registry/*`、`interfaces/*`、`common/http/*`（hy3/deepseek）、`memory/compaction.ts`、`memory/stored-message.ts`、`tools/*`（web-search/coding）→ **移到 agent-core 后从 agent-core re-export / 复用**
- ai-service 保留：`agent.module.ts`、`agent.controller.ts`、`ConversationMemory`（DB 版）、`ImageGenTool`（生图，不打包）、Nest 各 client 的装饰器封装

## 2. 解耦 Nest 改造清单

| 现状（ai-service） | 处理 | 位置 |
|---|---|---|
| `@Injectable()`/`@Module()` | 删除（agent-core 手动 new，CLI 不走 DI） | 全部 classes |
| `Logger`（Nest） | → `lib/logger.ts`（`console` + level + 前缀） | engine/registry/clients/compaction |
| `OnModuleInit`（client.registry） | 删除接口，构造时 `register()` | client.registry |
| `HttpService`(@nestjs/axios) + `rxjs.firstValueFrom` | → 原生 `fetch`（`fetch-http.ts`） | hy3/deepseek client |
| 裸 `axios`（流式） | → 原生 `fetch` + `ReadableStream` | hy3/deepseek client |
| `API_TIMEOUT`（@web-system/shared） | → `lib/timeout.ts` 内联常量 | 各 client |
| `reflect-metadata` | 删除 | cli 入口 |
| shebang `ts-node` | → `#!/usr/bin/env node` + 编译产物 | bin |

**结论**：agent-core 为**纯 TS、零运行时依赖**，Node ≥18（原生 fetch）。

## 3. WebSearch 工具（插件式 Provider）

**决策**：web-search 作为**插件机制**提供搜索能力，**默认内置 Bing Web Search API**（开箱即用，用户配 `BING_SEARCH_API_KEY` 即可），其他 Provider（博查等）通过**插件注册**扩展。

### 插件化设计
```
search/
├── provider.interface.ts   # SearchProvider 插件接口
├── registry.ts             # SearchProviderRegistry：注册/优先级/选择
├── providers/
│   ├── bing.provider.ts        # 默认内置（Bing Web Search API）
│   └── bocha.provider.ts       # 可选插件（博查，注册后启用）
└── web-search.tool.ts      # 工具门面：委托 registry 选择 provider
```

- **默认**：`Bing Web Search` 内置为默认 Provider（稳定、有免费 tier）。
- **插件**：`SearchProvider` 接口 + `SearchProviderRegistry`，未来加 provider 只需实现接口并 `register()`。
- `WebSearchTool.execute({ query })` → `registry.select()` 选择已启用且已配 key 的 provider → 返回 `[{title, url, snippet, date}]`。
- 若一个 key 都没配 → 返回 `success=false`，提示配置 `BING_SEARCH_API_KEY` 或注册搜索插件。

> 实测说明：DuckDuckGo / Wikipedia / arXiv 等无 key 源在当前环境全部不可达（网络/反爬限制），故不作为默认依赖；用稳定 API（默认 Bing）。

**配置**（config 引导时可选填）：
- `BING_SEARCH_API_KEY`（默认）
- `BOCHA_API_KEY`（+ 可选 `BOCHA_ENDPOINT`，作为插件启用）

## 4. Coding 工具集（编程场景）

> 安全边界：coding 工具默认**只读优先 + 受限执行 + 删除/破坏操作需用户确认**，防止 CLI 成为任意命令执行漏洞。

| 工具 | 能力 | 安全约束 |
|---|---|---|
| `list-dir` | 列出目录（受 cwd 限制） | 仅列目录结构 |
| `read-file` | 读取文本文件（上限 64KB） | 只读；忽略 node_modules/.git 等 |
| `grep-search` | 在目录内正则搜索文本 | 只读；过滤二进制/忽略目录 |
| `write-file` | 新建/覆盖/追加写文件（上限 64KB） | **所有写操作均需权限确认**（非交互默认拒绝） |
| `shell-exec` | 受限执行 shell 命令 | 白名单命令 + cwd 沙箱 + 超时；**删除/破坏类命令需权限确认** |

**安全设计**：
- 默认 `cwd` 为当前工作目录；`shell-exec` 仅允许预定义白名单命令前缀，拒绝 `sudo`、重定向到敏感路径等。
- **删除/破坏操作弹权限确认**：
  - `shell-exec` 在执行前解析命令，若命中危险模式（`rm` / `mv`（覆盖）/ `rmdir` / `>`, `>>`（覆盖写文件）等）→ 调用 `ctx.confirm(...)` 弹交互确认框。
  - `ToolContext` 增加可选确认器 `confirm(message): Promise<boolean>`：
    - 交互式 CLI（REPL / `chat`）→ 注入确认器，弹出 `⚠️ 确认执行删除？ [y/N]`，用户输入 `y` 才执行，其余拒绝。
    - 非交互（脚本 / 无确认器注入）→ 默认拒绝危险操作，返回 `ToolResult.success=false`，提示需人工确认。
  - 确认通过才真正执行，否则不执行并返回"已拒绝"。
- 每个工具 `execute` 内部 try/catch，失败返回结构化 `ToolResult`，不抛裸异常。
- 工具描述明确告知模型边界，Agent 的 systemPrompt 也约束"只读优先、删除/写入需用户确认"。

**接口设计（agent-core）**：
```ts
// interfaces/tool.interface.ts
export interface ToolContext {
  userId: string;
  runId: string;
  deps: Record<string, unknown>;
  /** 权限确认器：危险操作前调用。未注入（非交互）时视为拒绝 */
  confirm?(message: string): Promise<boolean>;
}

// tools/coding/shell-exec.tool.ts
const DANGEROUS_PATTERNS = /\b(rm|rmdir|mv)\b|\b(?:>|>>)/; // 删除/覆盖写
execute(args, ctx) {
  if (DANGEROUS_PATTERNS.test(command)) {
    const ok = await ctx.confirm?.(`⚠️ 即将执行危险命令: ${command}\n确认继续? [y/N]`);
    if (ok !== true) return { success: false, content: '', error: '操作已被用户拒绝' };
  }
  // ... 白名单校验后执行
}
```

**交互方注入**（kedou-agent CLI）：REPL / `chat` 在构造 engine 时，把确认器注入 `ToolContext.deps` 或直接作为运行时上下文，弹出 `readline` 确认框。

> 说明：现有 `mcp-skills/dev-machine` 是 SSH 远程技能，**不是**本地 coding 工具，本次独立实现本地安全版。

## 5. CLI 交互

```
kedou-agent                      # → REPL（默认 chat）
kedou-agent chat [--agent <id>]  # 交互对话
kedou-agent config               # 交互配置大模型
kedou-agent agents               # 列出 Agent（含模型就绪状态）
kedou-agent models               # 列出模型配置状态
kedou-agent --message "<text>" [-a id] [-c convId]   # 单轮非交互
kedou-agent --version / -v
kedou-agent --help / -h
```

- 交互配置复用现有 `config-store`（TTY 隐藏回显 `*` / 非 TTY 管道降级）。
- REPL 支持内置指令：`/exit`、`/help`、`/agent <id>`、`/clear`。
- 流式输出：引擎 `AsyncGenerator<StreamEvent>`，CLI 逐事件打印（tool_call/tool_result/final）。
- 退出码：0 成功；1 配置缺失/运行错误；2 参数错误。

## 6. 安全与发布

- **配置**：`~/.kedou/agent-cli.config.json`，权限 600，仅本人可读。
- **打包**：`package.json` 用 `files: ["dist","bin","README.md"]`；`.npmignore` 兜底 `.env*`、`*.key`、本地配置。
- **pre-publish 扫描**：脚本检查 `dist/` 是否含 `sk-`/`Bearer ` 等疑似密钥字样，含则中止发布。
- **环境变量优先级**：进程环境变量 > `~/.kedou` 配置文件。
- **绝不打包作者 key**：agent-core / kedou-agent 都不含任何真实 key。

## 7. 数据流（一次 Agent run）

```
用户输入 → CLI (config/命令分发)
        → agent-core.engine.run(agent, input, ctx)
            → ClientRegistry.get(model).chatWithTools(messages, tools)   # 原生 fetch → 模型
            → toolCalls? → ToolRegistry.execute → 回写 tool 消息 → 继续
            → 无 toolCalls → final → memory.persist(摘要压缩)
        → CLI 打印 tool_call/tool_result/final → REPL 循环
```

## 8. 依赖关系（实现顺序）

1. `@kedou-ai/agent-core` 骨架（interfaces + lib/logger + lib/timeout）
2. agent-core clients（hy3/deepseek 原生 fetch）
3. agent-core engine + registries（ReAct）
4. agent-core tools（web-search → coding）
5. agent-core memory（in-memory + compaction）
6. `kedou-agent` CLI（config-store + commands + repl）
7. ai-service 收敛到 agent-core（迁移引擎/客户端，保留 DB 记忆/生图/controller）
8. 测试 + 打包 + 发布预检

## 9. 风险
- 双包源码同步 → 用 agent-core 共享核心缓解；ai-service 的 `conversation-memory.ts`（DB 版）仍留在 ai-service。
- 模型 API 变更 → agent-core 统一 client 解析，单一维护点。
- coding 工具安全 → 白名单 + 只读优先 + 描述明确边界。
