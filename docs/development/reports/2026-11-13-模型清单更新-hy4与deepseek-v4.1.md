# 模型清单更新：hy4 与 deepseek-v4.1（流程凭证 · 2026-11-27 修订）

- 分支：`fix/model-account-chain`
- PR：#719
- 修订：2026-11-27（原稿 2026-11-13，因与实测不符而更正）
- 范围：dev / 本地；**不碰 prod**

> 🔴 **微调豁免**：本次代码改动为零行为变化的一致性回滚（把内置兜底清单恢复为与 dev/prod 字典逐字一致），不新增接口、不改契约、不改数据结构。

## 一、三条模型决策（用户 2026-11-13 已确认）

1. `hy4-preview` → 换 `hy4`。
2. `deepseek-v4-flash` → 换 `deepseek-v4.1-flash`。
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

后果：一旦 6004 字典抖动、回落到内置清单，意图分类会因模型未注册而**静默回退 hy3**。

## 三、本次 PR 的改动（已收窄）

| 位置 | 文件 | 本次动作 |
| --- | --- | --- |
| hy3 凭证回落 | `packages/agent-core/src/clients/hy3.client.ts` | **保留**：`getApiKey()` 回落 `TOKENHUB_API_KEY → HY3_API_KEY → LLM_API_KEY`；`getBaseUrl()` 增加 `TOKENHUB_BASE_URL` 优先；错误文案同步 |
| 内置清单 | `servers/ai-agent/src/agent/model-catalog.service.ts` | **回滚**：恢复 `deepseek-v4-flash` / `hy4-preview`，与 dev/prod 字典逐字一致 |

收窄理由：清单是「三级回落」的最后一级，与字典同步改名才有意义。在字典仍是旧值的情况下先改清单，会制造两个真源，且让字典抖动路径上的意图分类失效。迁移应作为独立任务一次做全。

## 四、影响面

- 行为变化：无。清单恢复旧值后，`MODEL_SOURCE` 三级回落结果与改动前完全一致。
- hy3 路径：本地/无 `HY3_API_KEY` 环境不再报「请配置 HY3_API_KEY」，改用 TOKENHUB 凭证（已实测 200）。

## 五、验证

- CI：`改动包 build/test` 必须转绿（本地等价命令 `bash scripts/ci/changed-packages.sh origin/master --lint`）。
- 上游：`hy3` 用 `TOKENHUB_API_KEY` 单钥匙返回 200 + 正文（2026-11-27 已实测）。
- 字典：dev/prod `/internal/dict/llm_models` 保持旧值（本次不改）。

## 六、后续独立任务：模型迁移（待用户拍板后执行）

必须一次做完，顺序不可颠倒：

1. dev DB 字典改名（参数化 SQL + 改前备份 + 校验 `affectedRows`）。
2. 代码引用同步：`intent.service.ts` 默认值、`thinking-policy.ts` maxTokens 表（新旧并存过渡）、`ai-service` 同源副本。
3. dev `ai-agent/.env` 的 `INTENT_MODEL` 更新。
4. 单测数据更新，全量通过。
5. 观察一个轮询周期后，再择期迁移 prod 字典（单独一次变更）。

## 七、回滚

代码侧：`git revert` 本次 commit 即可（清单本来就是旧值）。
DB 侧：本次未写库，无需回滚。
