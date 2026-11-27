# 模型清单更新：hy4 与 deepseek-v4.1（流程凭证 · 2026-11-27 修订）

- 分支：`fix/model-account-chain`
- PR：#719
- 修订：2026-11-27（原稿 2026-11-13，因与实测不符而更正；同日用户拍板模型迁移暂不执行，见 §六）
- 范围：dev / 本地；**不碰 prod**

> 🔴 **微调豁免**：本次代码改动为零行为变化的一致性回滚（把内置兜底清单恢复为与 dev/prod 字典**重名的 3 个 id 一致**），不新增接口、不改契约、不改数据结构。

## 一、三条模型决策（用户 2026-11-13 已确认；其中决策 1、2 已于 2026-11-27 改判为暂不执行，见 §六）

> 🔴 **2026-11-27 改判**：第 1、2 条（换 `hy4` / `deepseek-v4.1-flash`）**暂不执行**，理由与重立项条件见 §六；第 3 条（hy3 走 TOKENHUB 凭证）已落地并随 PR #719 合入。

1. `hy4-preview` → 换 `hy4`。（2026-11-13 确认；**2026-11-27 改判为暂不执行**，见 §六）
2. `deepseek-v4-flash` → 换 `deepseek-v4.1-flash`。（2026-11-13 确认；**2026-11-27 改判为暂不执行**，见 §六）
3. `hy3` 走 TOKENHUB：用 `TOKENHUB_API_KEY`，不再依赖单独的 `HY3_API_KEY`。

## 二、2026-11-27 一手实测（替换原稿的推断）

### 2.1 上游可用性（真实 inference，非 /models 列表）

| 模型 id | 结果 | 说明 |
| --- | --- | --- |
| `hy3` | 200，正文「可用」 | 仅持 `TOKENHUB_API_KEY` 即可调通 → **决策 3 成立** |
| `hy4` | 200 | 新名可调 |
| `deepseek-v4.1-flash` | 200 | 新名可调 |
| `hy4-preview` | 200 | 旧名仍可用，**未下线** |
| `deepseek-v4-flash` | 200，上游回显 `deepseek-v4.1-flash-1017` | 旧名是别名，已被路由到 v4.1 |

结论：旧名暂不会失效，模型改名**不紧急**；但旧名终究是别名，不能长期依赖。

### 2.2 真相源状态（更正原稿错误）

原稿写「DB 字典已参数化 SQL 改成 hy4 / deepseek-v4.1-flash」，**与实测不符**：

| 环境 | `llm_models` 字典实际值 |
| --- | --- |
| dev（6004 `/internal/dict/llm_models`） | `deepseek-v4-flash`、`deepseek-v4-pro`、`hy4-preview` |
| prod（同上） | `deepseek-v4-flash`、`deepseek-v4-pro`、`hy4-preview` |

即：**两套环境的字典都还是旧值，模型迁移从未落地。**

### 2.3 由此暴露的不一致

PR 原改动只把 ai-agent 的 `BUILTIN_TOKENHUB_MODELS` 换成新名，其余五处仍为旧名，导致 CI「改动包 build/test」失败（`builtin` 与 `db 字典不可用` 两个用例）：

- `intent.service.ts:52` 的 `INTENT_MODEL` 默认值仍为 `deepseek-v4-flash`
- `model-catalog.service.spec.ts` 测试数据仍为旧名
- dev `ai-agent/.env` 显式设了 `INTENT_MODEL=deepseek-v4-flash`
- `packages/agent-core/src/clients/thinking-policy.ts` 的 maxTokens 表只有 `hy4-preview` / `deepseek-v4-flash`
- `servers/ai-service/src/agent/model-catalog.service.ts` 同源副本未同步（该文件自注「改一处要改两处」）

后果（**回滚前状态**；本次已按 §三 回滚，清单与字典中重名的 3 个 id 一致，该风险当前不存在）：一旦 6004 字典抖动、回落到内置清单，意图分类会因模型未注册而**静默回退 hy3**。

## 三、本次 PR 的改动（已收窄）

| 位置 | 文件 | 本次动作 |
| --- | --- | --- |
| hy3 凭证回落 | `packages/agent-core/src/clients/hy3.client.ts` | **保留**：`getApiKey()` 回落 `TOKENHUB_API_KEY → HY3_API_KEY → LLM_API_KEY`；`getBaseUrl()` 增加 `TOKENHUB_BASE_URL` 优先；错误文案同步 |
| 内置清单 | `servers/ai-agent/src/agent/model-catalog.service.ts` | **回滚**：恢复 `deepseek-v4-flash` / `hy4-preview`，与 dev/prod 字典**重名的 3 个 id 一致**（兜底清单共 8 项，另有 5 个字典外模型，属历史别名与多厂商兜底） |

收窄理由：清单是「三级回落」的最后一级，与字典同步改名才有意义。在字典仍是旧值的情况下先改清单，会制造两个真源，且让字典抖动路径上的意图分类失效。迁移应作为独立任务一次做全。

## 四、影响面

- 行为变化：无。清单恢复旧值后，`MODEL_SOURCE` 三级回落结果与改动前完全一致。
- hy3 路径：本地/无 `HY3_API_KEY` 环境不再报「请配置 HY3_API_KEY」，改用 TOKENHUB 凭证（已实测 200）。

## 五、验证

- CI：`改动包 build/test` 必须转绿（本地等价命令 `bash scripts/ci/changed-packages.sh origin/master --lint`）。
- 上游：`hy3` 用 `TOKENHUB_API_KEY` 单钥匙返回 200 + 正文（2026-11-27 已实测）。
- 字典：dev/prod `/internal/dict/llm_models` 保持旧值（本次不改）。

## 六、模型迁移：已决定暂不执行（2026-11-27 用户拍板）

用户拍板口径：**以现有 dev 为准**（dev 字典此前已实测验证）。

- dev 与 prod 的 `llm_models` 字典保持现值：`deepseek-v4-flash`、`deepseek-v4-pro`、`hy4-preview`。
- 代码侧 `BUILTIN_TOKENHUB_MODELS` 中与字典重名的 3 个 id（`deepseek-v4-flash`、`deepseek-v4-pro`、`hy4-preview`）均为旧名，本次不再改名；该兜底清单共 8 项，另含 `deepseek-v4-pro-0813`、`glm-5.3`、`kimi-k3`、`qwen3.5-plus`、`minimax-m3` 这 5 个字典外模型，属历史别名与多厂商兜底，不在本次迁移范围。
- `intent.service.ts` 的 `INTENT_MODEL` 默认值与 dev/prod `.env` 中的显式值均保持 `deepseek-v4-flash`，不动。
- 新名 `hy4` / `deepseek-v4.1-flash` 虽已实测可调（200 + 正文），但**本次不迁移**。

重新立项的触发条件（满足任一即需单独立项、一次做全）：

1. 上游下线 `deepseek-v4-flash` / `hy4-preview` 旧别名（当前 `deepseek-v4-flash` 已被上游路由到 `deepseek-v4.1-flash-1017`，属别名可用状态）。
2. 业务需要 `hy4` / `deepseek-v4.1-flash` 的独有能力，旧名无法替代。

届时必须同步改动（漏一处即意图分类静默失效）：DB 字典 → `intent.service.ts` 默认值 → dev/prod `.env` 的 `INTENT_MODEL` → `packages/agent-core/src/clients/thinking-policy.ts` 的 maxTokens 表 → `servers/ai-service/src/agent/model-catalog.service.ts` 同源副本 → 单测数据。

## 七、回滚

代码侧：`git revert` 本次 commit 即可（清单本来就是旧值）。
DB 侧：本次未写库，无需回滚。
