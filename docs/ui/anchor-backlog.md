# 存量锚点回填清单（anchor-backlog.md）

> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
> 设计：`specs/design-reviewer/design.md` §3.7.1（存量过渡）｜判据：`docs/ui/design-system.md` §3.2 A1–A4
> 批次顺序已拍板（Q4，2026-09-22）：**admin 主流程 → portal 主流程 → 小程序主包 → 分包低频**
> 单批次节奏已拍板（Q5）：**批次内先 `warn` 观察一轮，再升 `strict`**

## 1. 回填什么（不是"给所有元素打标"）

- 只给**关键结构元素**打 `data-dr="<key>"`（A2）：页头、主操作、筛选区、列表容器、状态区、主表单、主导航。**不逐元素打**。
- 原型侧与实现侧**同名同语义**（A3）；改名/删除须同步两侧并在评审报告登记。
- **未回填 ≠ 已漂移**：原型侧无 `data-dr` 时扫描器输出 `SKIP`，CI 不判违规（A4）。
- 匹配口径：**按 key 全局匹配，不按文件映射**——避免维护"原型文件 ↔ 页面文件"映射表（维护成本高于收益，且易腐）。

## 2. 存量现状（2026-09-22 实测 `git ls-files`）

| 批次 | 范围 | 界面文件数 | 状态 |
|---|---|---|---|
| **B1a** | `apps/deploy-console`（admin 系主流程） | 38 `.vue` | 待开始 |
| **B1b** | `apps/admin` | 26 `.vue` | 待开始 |
| **B2** | `apps/portal` | 35 `.vue` | 待开始 |
| **B3** | `apps/kedou-ai-minigram/pages`（小程序主包） | 8 `.wxml` | 待开始 |
| **B4** | `apps/kedou-ai-minigram/package*`（分包）+ `packages/ui` | 20 `.wxml` + 2 `.vue` | 待开始 |
| — | `apps/mcp-admin` | 0 `.vue` | 无文件，跳过 |

合计 **129** 个界面文件。B1a 与 B1b 可并行推进（同属 admin 系一个观察轮）。

### 2.1 2026-11-06 复测（⚠️ 上表数字已过时 + 换成「锚点维度」看）

**文件数漂移**（`git ls-files` 实测，对比 09-22 的 129）：`deploy-console` 38→42、`admin` 26→42、`portal` 35→41、小程序 28→35、`shell` 6（表里没列），**实际 166 个界面文件，偏差 +29%**。排期前须按本行重算，否则工作量低估。

**锚点维度**（真正决定工作量的口径：要落多少个 `data-dr`，而不是改多少个文件）：

| 端 | 原型侧锚点数 | 实现侧已回填 | 缺口 | 原型文件 |
|---|---|---|---|---|
| `admin` | **32**（2026-11-06 B2a 后定稿） | 25（B2a 19 + B2c 6） | **7** | `admin-agent-def-detail.html`(31) / `admin-agents.html` 独有 1（`agent-def-list`）；hub 为生成物不计数 |
| `deploy-console` | 5 | 0 | **5** | `deploy-console-domain.html` |
| `kedou-ai-minigram` | 7 | 0 | **7** | 小程序原型 |
| `shell` | 1 | 0 | **1** | `shell/prototype` |
| `portal` | 0 | 0 | 0 | 原型未打锚点 → SKIP |

**回填不是机械活**（2026-11-06 试水 8 个锚点的结论）：成本在**逐点判断**——`gen-params-preset` / `gen-params-payload-preview` / `gen-params-sampler` 在实现中不存在，`agent-def-edit-modal` 已被 page-spec v2 作废（应改原型，不是改代码）。
**半截回填无收益**（40→32 后 admin 仍 MISSING，必须到 0 才能开）；且改 UI 源码要 `Proto:` / `Design:` 凭证 → **回填必须与所属原型/规格批次成对提交**，不能孤立排期。

**32 个锚点的最终分组（2026-11-06 B2a 逐条定性，可复核）**

| 组 | 数量 | 含义 |
|---|---|---|
| ✅ 回填 | **17** | 实现中已有同语义同位置结构，只缺 `data-dr` |
| 🔧 补实现后回填 | **2** | 规格强制要求但实现缺失（`role-fallback` 角色降级提示 · `error-cta` 加载失败重试），按规格补最小实现 |
| ⏸ 阻塞 | **7** | 调试台分期 7（`bench-layout` / `run-bar` / `chat-send` / `chat-compare` / `chat-compare-card` / `cases-run` / `case-row`）——原「面板级 diff 2 + 字段级 badge 4」已于 B2c 回填 |

> 🔴 **7 个阻塞项（调试台分期）不清，admin 到不了 0，`scoped`/`strict` 永远开不了**。排期别按「32 个锚点 = 32 份工」算。

**B2c（2026-11-07）已把「面板级 diff 2 + 字段级 badge 4」6 个阻塞项回填**：`diff-bar` / `diff-table` / 4×`gen-params-*-badge` 落码 + 参数对比三级交互，并修 3 项 P1（D1 hint 样式 / D2 role-fallback 权限 / D3 crumb-list 面包屑）。实现侧已回填 **19 → 25**，缺口 **13 → 7**（仅剩调试台分期）。凭证：`docs/development/reports/2026-11-06-admin锚点回填B2c-*.md`。

### 2.2 三个“实现里没有”的锚点已按定稿撤除（2026-11-06，逐个核过）

撤的是**锚点**，不是功能——三个都查到了“定稿不做”或“已被取代”的记录，所以正确动作是改原型而不是往实现塞锚点：

| 锚点 | 定性 | 判据（可复核） | 处理 |
|---|---|---|---|
| `gen-params-preset` | 定稿不含「按场景套用」预设下拉 | `docs/ui/reviews/2026-10-28-b3-tuning-ui-design-review.md`「五控件：temperature / maxTokens / topP / thinking（三态）/ max_steps」+ `agent-def-detail-page-2026-10-28.md:42`「B3 五控件口径不设预设下拉，未实现」 | 原型撤锚点（控件留作演示），`page-spec v2 §3` 第 6/7 项同步标废弃 |
| `gen-params-sampler` | 「采样方式二选一 + 禁用另一侧」被 **C7-b 同填报错**取代 | 实现 `AgentTuningPanel.vue`（temp/topP 两输入 + 双字段红字）；`page-specs/form-controls-and-toggles-v1.md:277`「互斥类校验 → 两个字段同时红字…现状 C7-b 即按此」 | 原型撤锚点，`page-spec v2 §3` 第 1/3 项同步标废弃 |
| `gen-params-payload-preview` | 旧屏专属（提交内容预览） | 屏② 已被 `admin-agent-def-detail.html` 取代；新形态是「生效策略预览」`AgentStrategyPreview.vue`（已实现） | 旧原型撤锚点 + 整屏标作废 |

撤除后 admin 缺口 **40 → 37**。

### 2.3 第二批 33 个锚点的可回填比例（2026-11-06 逐条对照实现）

**只有 15 个现在能回填**，3 个归属待定，**14 个卡在“功能未做”**（调试台分期 9 · 字段级“原值→新值”badge 4 · 角色降级无提示 1）。
→ 逐条对照表见 `~/AiWorkspace/30-任务产物/2026-11-06-R11b修复与锚点试水/02-锚点处置与第二批排期.md` §2。

🔴 **排期不要按“33 个锚点 = 33 份工”算**：不解决那 14 个（做功能 或 撤锚点），admin 永远到不了 0，`scoped`/`strict` 也就永远开不了。

## 3. 推进方式（`DESIGN_ANCHOR_MODE` 四档）

```bash
# ① 回填前（默认）：全部跳过，存量 PR 零摩擦
DESIGN_ANCHOR_MODE=off    bash scripts/redline/scan-rules.sh diff origin/master...HEAD

# ② 批次内观察一轮：全部 warn（不阻断）
DESIGN_ANCHOR_MODE=warn   bash scripts/redline/scan-rules.sh diff origin/master...HEAD

# ③ 该批升 strict（按 app 白名单，其余仍 warn）—— Q5 的落地形态
DESIGN_ANCHOR_MODE=scoped DESIGN_ANCHOR_SCOPE=deploy-console \
  bash scripts/redline/scan-rules.sh diff origin/master...HEAD

# ④ 全量回填完成：全局 strict
DESIGN_ANCHOR_MODE=strict bash scripts/redline/scan-rules.sh diff origin/master...HEAD
```

两个引擎（`scan-rules.sh` / `gate.ts`）读**同一份**档位声明（`scripts/redline/gates.yaml` R11b `level_switch`），同档位下 stdout 必须逐字节一致 —— 由 `scripts/redline/test-r11b-anchors.sh` E 节守着（warn / strict / scoped / cached / 未知档位五种情形）。
`cached`（pre-commit）下 R11b 恒不跑，由 `skip_scan_modes` 声明；档位拼错（如 `stric`）两个引擎都 `exit 2`，不会静默降级成 warning。

单批自检（不进 CI，随时可跑）：

```bash
python3 scripts/redline/scan-design-drift.py anchors HEAD      # 锚点集合比对
python3 scripts/redline/scan-design-drift.py lint <file...>    # 可机检视觉条目（G1/E3/X4/X5/F1）
```

## 4. 每批的完成定义（DoD）

- [ ] 该批关键结构元素**两侧**锚点已打且同名
- [ ] `scan-design-drift.py anchors HEAD` 对该 app 输出 `INFO`（集合一致），而非 `SKIP` / `MISSING`
- [ ] `warn` 观察一轮无异常（无误报、无噪音）
- [ ] 该批 app 名写入 `DESIGN_ANCHOR_SCOPE`（CI 侧对该批 error，其余仍 warn）
- [ ] 本表「状态」与日期已更新

## 5. 逐文件清单不在此硬编码

上百行路径会腐化（文件增删即失效）。需要时按批次命令生成：

```bash
git ls-files 'apps/deploy-console' | grep -E '\.vue$'
git ls-files 'apps/kedou-ai-minigram/pages' | grep -E '\.wxml$'
```

## 6. 关联

- 判据条目：`docs/ui/design-system.md` §3.2 A1–A4
- 评审关口：D3 实现一致性（`design-reviewer` SKILL.md）
- 上线值守：R11=error 首周专人值守（Q6，用户已安排）
