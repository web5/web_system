# kedou-agent · 实施清单（Tasks）

> 状态：方案（待确认）
> 日期：2026-08-25
> 依赖：先 `@kedou/agent-core`，后 `kedou-agent` CLI，最后 ai-service 收敛。

---

## 阶段一：`@kedou/agent-core` 公共核心包（纯 TS，零 Nest）

### T1. 包骨架与基础
- [ ] 1.1 建 `packages/agent-core/`（package.json name=`@kedou/agent-core`、tsup.config.ts、tsconfig）
- [ ] 1.2 `lib/logger.ts`：极简 logger（level + 前缀）
- [ ] 1.3 `lib/timeout.ts`：内联 `API_TIMEOUT` 常量（剥离 `@web-system/shared`）
- [ ] 1.4 `interfaces/`：tool / agent / runtime 接口（从 ai-service 平移，删 Nest 依赖）
- **验收**：`tsc` 零错误；`@kedou/agent-core` 可在 workspace 内被 import

### T2. 模型客户端（原生 fetch）
- [ ] 2.1 `lib/fetch-http.ts`：封装 `POST` + 超时（AbortSignal）+ SSE 流式迭代
- [ ] 2.2 `clients/base-ai.client.ts`：`chat/chatStream/chatWithTools` 抽象 + 类型
- [ ] 2.3 `clients/hy3.client.ts`：原生 fetch 版（chatWithTools / chatStream）
- [ ] 2.4 `clients/deepseek.client.ts`：原生 fetch 版
- **验收**：单测覆盖 `chatWithTools` 的 tool_calls 解析 / tool 消息格式 / 错误归一化；`isAvailable()` 校验一致

### T3. 引擎与注册表（ReAct）
- [ ] 3.1 `registry/tool.registry.ts`、`registry/agent.registry.ts`、`registry/client.registry.ts`
- [ ] 3.2 `core/agent-engine.ts`（ReAct：maxSteps 熔断、工具回写、final）
- [ ] 3.3 `core/agent-runner.ts`
- **验收**：单测覆盖 final 直出 / 工具回写 / 超步数熔断 / 摘要拼接；**修复已知 bug**（失败分支不 persist、重复 get 工具）

### T4. 记忆
- [ ] 4.1 `memory/stored-message.ts`、`memory/in-memory-conversation-memory.ts`
- [ ] 4.2 `memory/compaction.ts`（摘要模型跟随所选模型，不硬编码 hy3）
- **验收**：单测覆盖续聊 / 压缩触发 / 压缩失败回退

### T5. 工具集
- [ ] 5.1 `search/`：`provider.interface.ts` + `registry.ts`（插件式 Provider 注册/选择）
- [ ] 5.2 `search/providers/bing.provider.ts`（默认内置 Bing Web Search）+ `web-search.tool.ts`
- [ ] 5.3 `tools/coding/`：`list-dir` / `read-file` / `grep-search` / `shell-exec`（受限白名单）
- [ ] 5.4 `ToolContext` 增加可选 `confirm()` 确认器；`shell-exec` 检测删除/覆盖写命令时调用确认器，未注入/拒绝则不执行
- **验收**：单测覆盖 web-search Provider 注册/优先级/无 key 提示、coding 工具边界（禁止危险命令）、shell-exec 删除命令的确认/拒绝路径

## 阶段二：`kedou-agent` CLI 包

### T6. CLI 骨架
- [ ] 6.1 建 `packages/kedou-agent/`（package.json bin + files 白名单 + engines、tsup、bin/kedou-agent.mjs）
- [ ] 6.2 `cli/config-store.ts`（复用现有：`~/.kedou` 配置、权限 600、TTY/管道）
- [ ] 6.3 `cli/index.ts`：argv 解析 + 子命令分发 + `--version`/`--help`
- **验收**：`npx kedou-agent --version` / `--help` 可用

### T7. 子命令
- [ ] 7.1 `commands/config.ts`：交互配置 + `applyConfigToEnv`
- [ ] 7.2 `commands/models.ts` / `commands/agents.ts`
- [ ] 7.3 `commands/chat.ts`：单轮 `--message`
- [ ] 7.4 `cli/repl.ts`：交互 REPL（`/exit` `/help` `/agent` `/clear`）
- **验收**：未配置时 `chat`/`--message` 引导配置并退出码 1；已配置直接对话；`--models` 不回显 key

### T8. Agent 定义
- [ ] 8.1 `study-assistant`（web-search + coding 工具）
- [ ] 8.2 `dev-assistant`（coding 工具：read-file/list-dir/grep-search/shell-exec）
- **验收**：`agents` 列出两者；dev-assistant 可读文件/搜代码

## 阶段三：ai-service 收敛到 agent-core

### T9. 迁移与收敛
- [ ] 9.1 ai-service 依赖 `@kedou/agent-core`，引擎/注册表/客户端/web-search 改为从 agent-core 复用
- [ ] 9.2 ai-service 保留：`ConversationMemory`（DB 版）、`ImageGenTool`（生图，不打包）、controller/module、Nest client 封装
- [ ] 9.3 更新 `harness-factory.ts` 用 agent-core
- **验收**：ai-service 编译通过；既有单测仍绿；CLI（现有 shell 测试）仍可用

## 阶段四：测试 / 打包 / 发布预检

### T10. 测试与发布
- [ ] 10.1 agent-core 全量单测（T2/T3/T4/T5）
- [ ] 10.2 kedou-agent CLI 单测（config-store、参数解析、退出码）
- [ ] 10.3 `pnpm build`（tsup 打包）+ `pnpm pack` 预检 tarball 内容（确认无 key、无 src）
- [ ] 10.4 pre-publish 扫描脚本：`dist/` 含 `sk-`/`Bearer` 即中止
- [ ] 10.5 更新根 README / 文档
- **验收**：`npm pack` 产物仅含 dist/bin/README；全量测试通过

---

## 验收关联（对应 requirements.md 编号）
| Task | 验收项 |
|------|--------|
| T6/T7 | 3.1 独立包 / 3.2 配置与安全 |
| T7 | 3.2（config 引导、权限、不回显 key）|
| T5 | 3.3 工具能力（web-search、coding）|
| T4 | 3.4 记忆与模型 |
| T9 | 3.5 代码共享 |

## 发布顺序
1. 发布 `@kedou/agent-core`
2. 发布 `kedou-agent`
3. ai-service 依赖 agent-core（内部，非发布）
