# 模型清单更新：hy4 与 deepseek-v4.1 替换（流程凭证）

- 日期：2026-11-13
- 分支：`fix/model-account-chain`
- 范围：dev/本地（不碰 prod 云上部署）
- 目标：让「SSE 流式 Markdown 微前端 demo」接真实 ai-agent 时，模型清单与实际可用模型一致，hy3 走 TOKENHUB 调通。

## 一、三条模型决策（用户已确认）

1. `hy4-preview` 下架 → 换成 `hy4`。
2. `deepseek-v4-flash` 用尽 → 换成 `deepseek-v4.1-flash`。
3. `hy3` 走 TOKENHUB：使用 `TOKENHUB_API_KEY`（不再依赖单独的 `HY3_API_KEY`）。

## 二、改动点

| 位置 | 文件 | 改动 |
| --- | --- | --- |
| 代码内置清单 | `servers/ai-agent/src/agent/model-catalog.service.ts` 的 `BUILTIN_TOKENHUB_MODELS` | `'hy4-preview'`→`'hy4'`、`'deepseek-v4-flash'`→`'deepseek-v4.1-flash'` |
| 环境变量 | `servers/ai-agent/.env` 的 `TOKENHUB_MODELS` | `deepseek-v4-pro,deepseek-v4-flash` → `deepseek-v4-pro,deepseek-v4.1-flash` |
| DB 字典（真相源） | system-service（6004）`llm_models` 字典 | `hy4-preview`→`hy4`、`deepseek-v4-flash`→`deepseek-v4.1-flash`（参数化 SQL，禁拼字符串） |
| hy3 凭证回落（已完成，待 commit） | `packages/agent-core/src/clients/hy3.client.ts` 的 `getApiKey()` | 回落顺序 `TOKENHUB_API_KEY → HY3_API_KEY → LLM_API_KEY`，错误文案同步 |

## 三、影响面

- ai-agent 模型目录（`ModelCatalogService`，优先级 DB 字典 → TOKENHUB_MODELS → 代码内置）。
- demo `widget-demo` 默认走 hy3（TOKENHUB）。

## 四、验证方式

- 6010（worktree dist）`/health` 探活。
- 8798 `/agui` 冒烟：出现 `text_message_content` 增量帧（hy3 走 TOKENHUB 调通），不再 `MODEL_ERROR` / `HY3_API_KEY` / 402。
- 6010 日志出现「模型清单已更新」行确认 hy4 / deepseek-v4.1-flash 生效。
- 追加投票类提问观察 `present-widget` tool_call / fence 是否仍在（不调工具也如实记录）。
