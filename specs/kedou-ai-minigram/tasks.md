# 科豆 AI 小程序 · 实施清单（Tasks）

> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
> 状态：**待拍板已清（2026-09-20）**，批次 1 可开工
> 范围：`apps/kedou-ai-minigram`（前端）+ `servers/ai-agent` / `servers/ai-service`（后端）+ `migrations/`
> 上游设计（不重复其内容，只做执行）：
> - `apps/kedou-ai-minigram/docs/产品规划分析与实现方案-梳理.md`（总纲）
> - `apps/kedou-ai-minigram/docs/技术架构拆解-双入口.md`（架构层）
> - `apps/kedou-ai-minigram/docs/多Agent意图路由-架构设计.md`（决策层）
> - `apps/kedou-ai-minigram/docs/意图识别-实现方案.md`（代码层）
> - `apps/kedou-ai-minigram/docs/实现方案-三Tab骨架.html`（前端落地层）
> - 交互原型：`apps/kedou-ai-minigram/prototype/index.html`

---

## 0. 已拍板结论（2026-09-20）

| # | 问题 | 结论 |
|---|---|---|
| Q1 | tabBar | **按原型改**为 对话 / 发现 / 我的；翻译、合同评估降级为「发现」页能力卡 |
| Q2 | 翻译链路 | **复用 `agent/run`** —— 配 `translate` agent + 前端抽 `createAgentApi(agentId)` 工厂；不新增 `/api/translate` |
| Q3 | 主题 | **一期只做浅色**；原型暗色套标为「未来态」，`app.json` 本期不声明 `darkmode` |
| Q4 | 双份合同链路 | **留 `pages/assess/*`（3 页）**；`pages/contract/*` 仅把 `chat` 能力并入 `assess/result` 追问后下架 |
| Q5 | agent prompt / 合规 | **先定合规口径再写 prompt**：命理类内置免责声明；6 个 agent 内容工作为批次 5 硬前置 |
| Q6 | 会话归属 | **完全隔离（方案 A）**：发现页应用会话进「我的→各应用历史」，主对话列表只显示主对话产生的会话 |

**附加口径**（承接上游文档建议）：
- 应用形态默认「通用对话壳」`entry.ui='chat'`，只对翻译、合同评估做专属 UI `entry.ui='custom'`。
- `entry.icon` 用图标 key + 前端映射，不引入图片托管。
- 批次 5 上线前必须已配好 6 个 agent（emotion / baike / horoscope / translate / tool / **general 兜底**），否则开关打开后所有输入落 `general`，比不开更糟。

---

## 1. 批次划分与依赖

```
批次1(前端骨架收口) ─────────────────────┐
批次2(翻译链路) ──→ 批次3(复用工厂,合同接真) ┤
批次4(发现页数据驱动) ──────────────────┴─→ 批次5(意图路由)   ← 硬前置：6 个 agent 已配好
批次6(legacy 清理) 独立一期
```

| 批次 | 内容 | 估时 | 阻塞项 |
|---|---|---|---|
| 1 | 前端骨架收口（M0） | 1~1.5 人日 | 无（零后端依赖） |
| 2 | 翻译链路打通（M1） | 1~2 人日 | 需 Q2 已定（已定） |
| 3 | 合同评估接真 + 双链路收口（M2） | 1 人日 | 批次 2 的工厂 |
| 4 | 发现页数据驱动（M3） | 1 人日 | 无（发现页可先写死两张卡上线） |
| 5 | 主对话意图路由（M4） | 2~3 人日 + 内容工作 | **6 个 agent + 合规口径** |
| 6 | legacy 页面清理 | 1~2 人日 | 独立一期 |

> 关键路径红利：批次 1–4 是一条完整可交付线（发现页多应用），完全不依赖意图识别。

---

## 2. 批次 1 · 前端骨架收口（M0）

### T1.1 设计变量层
- [ ] `apps/kedou-ai-minigram/app.wxss`：落 `--brand / --brand-deep / --brand-soft / --brand-txt / --accent / --page-bg / --card / --line / --t1 / --t2 / --t3` 等 token（取原型同源）。
- 验收：新增页面一律从变量取色；无硬编码 `#F97316` / `#1E6FFF`。

### T1.2 app.json 换骨架
- [ ] `pages` 数组插入 `pages/chat/index/index`、`pages/discover/index/index`（启动页 `pages/welcome/index/index` 保持首位）。
- [ ] `window.navigationBarBackgroundColor` `#1E6FFF` → `#FFFFFF`；`navigationBarTextStyle` `white` → `black`。
- [ ] `tabBar.selectedColor` `#1E6FFF` → `#C2410C`（对比度 5.4:1；纯品牌橙 2.9:1 不达标）；`list` 换为 对话 / 发现 / 我的。
- 验收：三 tab 可切；对话 tab 默认选中。

### T1.3 新建通用对话页 `pages/chat/index/index`
- [ ] 复制 `pages/contract/chat/` 骨架，删 `chat-head` 的「基于本次合同上下文回答」提示条。
- [ ] 首屏注入「今日一句」作为 AI 首条消息。
- [ ] 数据源接 mock adapter，接口签名按批次 2 的 `services/agent-stream.ts` 预留。
- 验收：页面可编译、可发送、有回流假数据；无合同语义残留。

### T1.4 新建发现页 `pages/discover/index/index`
- [ ] 两张能力卡（语言翻译官 → `pages/translate/index/index`；合同评估 → `pages/assess/index/index`），`navigateTo` 抵达。
- [ ] 预留后续技能槽位（批次 4 改数据驱动时直接替换渲染源）。
- 验收：两入口可达，无死链。

### T1.5 改写欢迎页 `pages/welcome/index/index`
- [ ] 结构换为 Hello. + 今日一句 + 「开始对话」。
- [ ] 今日一句抽到 `utils/daily.ts`，欢迎页与对话首条共用同一份，避免文案漂移。
- [ ] 「开始对话」用 `switchTab` 进对话。
- 验收：启动进 welcome（底部无 tabBar）；`switchTab` 后不可后退回欢迎页。

### T1.6 改写我的页 `pages/mine/index/index`
- [ ] 三条并列设置（小程序设置 / 翻译设置 / 合同评估设置）→ 收敛为「应用设置」分组，各设置降为二级页。
- [ ] 清除「我的翻译 128 条」「我的合同 12 份」硬编码，改为按 Q6 隔离口径的入口（数据在批次 4/5 接真）。
- 验收：三套设置全部可达，无死链。

**批次 1 总验收**：**本批次改动文件** `tsc` 零错误；开发者工具可编译；三 tab 可切；欢迎页跳对话不可后退；发现页两入口可达；新增页无硬编码色值；底部 AI 生成声明 + 备案号各页一致。

> ⚠️ 关于 `tsc --noEmit`：小程序 `tsconfig.json` 存在既有缺陷（`types` 写了未安装的 `miniprogram-api-typings` / `weixin-miniprogram`，且缺 `moduleResolution`，导致命令直接失败）；绕过配置后全仓仍有 **130 个既有类型错误**（集中在 `app.ts` / `pages/bianbian/*` / `pages/contract/*` 等 legacy 文件）。
> 因此**验收口径改为「本批次改动文件零错误」**，全仓零错误要等批次 6 legacy 清理 + tsconfig 修正后才成立。

---

## 3. 批次 2 · 翻译链路打通（M1）

### T2.1 SSE 管线参数化
- [ ] 新增 `apps/kedou-ai-minigram/services/agent-stream.ts`：抽工厂 `createAgentApi(agentId)`，把 `services/contract-api.ts` 的 SSE / 缓冲切行 / 会话持久化 / 追问能力通用化。
- [ ] `services/contract-api.ts` 改为 `createAgentApi('contract-risk')` 调用，**行为不变**。
- 验收：合同评估链路不回归；工厂可被第二个 agentId 复用。

### T2.2 后台配 `translate` agent ✅（2026-09-20 已写入本地库）
- [x] 写入 `agent_definitions`：`id=translate`、`name=语言翻译官`、`model=deepseek/deepseek-v4-flash`、
      `max_steps=4`、`temperature=0.3`、`tools=[]`、`capabilities=[]`、`status=published`、`enabled=1`、`version=1`、
      `memory={"enabled":true,"keepRecent":6,"compactionThreshold":20}`。
      连接来源：`servers/ai-service/.env`（本地 `127.0.0.1:3306` / `web_system`）；脚本幂等，已存在则跳过。
- 验收：`AgentRegistry` 热同步（约 30s）后在册；改 prompt 用 `UPDATE` 即可，**不发版**。
- ⚠️ **其它环境另行执行**：`specs/kedou-ai-minigram/agent-translate.sql`（幂等，重复执行不覆盖）。
- ⚠️ **前端契约**（T2.3 接真时照此拼装）：
      - 入参：`【源语言】…\n【目标语言】…\n【语气】…\n【风格】…\n【原文】…`
      - 出参：四段 `【推荐译文】` / `【直译对照】` / `【委婉版】` / `【语气要点】`，结果页按标题切分渲染。

> 实测补充（2026-09-20）：库里现有 **7 个** agent（`acc-agent` / `bianbian` / `contract-risk` / `deploy` /
> **`general-assistant`** / `study-assistant` / `web-system-dev`）。其中 **已存在 `general-assistant`**
> （通用问答 + web-search），批次 5 意图路由的兜底 agent 可直接复用或改 id；
> 规划文档里「seed 只有 5 个、一个都没有」的说法已过时。`entry` 列确认不存在（批次 4 才加）。

### T2.3 翻译页接真 ✅（2026-09-20 已落码；失败态 / 中间态原型先确认过）
- [x] `pages/translate/index/index.ts`：删除 `const res = null` 空实现与两处 TODO（R3 红线），
      改为把「源语言 / 目标语言 / 语气 / 风格 / 原文」经 storage 交给结果页（原文较长，不放 URL 参数）。
- [x] `pages/translate/result/result.ts`：**结果页自己发起流式请求**（与原型一致 —— 中间态与失败态都落在结果页）：
      - `createAgentApi('translate').stream(...)` 逐字渲染；
      - 按 `【推荐译文】/【直译对照】/【委婉版】/【语气要点】` 切四段（`parseSections`）；
      - 失败态：明确原因 + 唯一主操作「重试」（`retry` 用同一批参数重发）；
      - 中间态：`loading` 时结果卡片内显示「翻译中」动点。
- 验收：输入 → 流式出结果 → 结果页真实译文；失败态明确且可重试；无 API Key 落到小程序端（V10/V11/V12）。

---

## 4. 批次 3 · 合同评估接真 + 双链路收口（M2）

### T3.1 上传与进度接真
- [ ] `pages/assess/index/index.ts`：`takePhoto / chooseAlbum / chooseFile` 接 `services/ocr-api.ts`；`setTimeout(800ms)` 假进度换成真实 SSE 进度（`createAgentApi('contract-risk')`）。

### T3.2 结果页接真
- [ ] `pages/assess/result/result.ts`：渲染真实 `ContractReport`，替换硬编码示例（score 62 + 4 条）。

### T3.3 双链路收口（Q4）
- [ ] `pages/contract/chat` 的追问能力并入 `assess/result`；`pages/contract/*` 其余下架（页面删除集中在批次 6 执行，本批次先停止演进并标注）。
- 验收：真上传 → OCR → 评估 → 报告全链路可跑；`contract-risk` 老链路行为不回归。

---

## 5. 批次 4 · 发现页数据驱动（M3）

### T4.1 migration：`agent_definitions.entry`
- [ ] `migrations/0010_agent_entry_and_intent_routing.sql`：`agent_definitions` 加 `entry JSON NULL`（**与批次 5 的会话锁定列合并为一条 0010**）。
- 结构：`{visible, icon, title, desc, category, sort, ui, route, suggestions, inputMode}`。
- 或 `servers/ai-service` 实体同步加字段。

### T4.2 C 端只读应用清单接口
- [ ] `GET /ai/agents`（`servers/ai-service`）：仅返回 `enabled=1 AND status='published' AND entry.visible=1`，字段白名单，**绝不返回 systemPrompt**。
- [ ] **禁止** C 端复用 `admin/agent-defs`（管理端域，含 prompt）。
- 验收：接口响应无 prompt 字段。

### T4.3 发现页数据驱动
- [ ] `pages/discover/index/index` 改为 `GET /ai/agents` 渲染；`ui='custom'` 跳专属页，`ui='chat'` 跳通用壳（带 `agentId`/`title`）。
- 验收：后台新增 agent 并勾 visible → 小程序刷新即出现（不发版）。

---

## 6. 批次 5 · 主对话意图路由（M4）

按 `apps/kedou-ai-minigram/docs/意图识别-实现方案.md` 执行，**须按其 §4 的 6 处修正落地**（`getOrFallback`、ai-service 端口 6003、类型 `RunInput`、无 JSON mode 需解析容错、实体真实列名 `summarized_count/messages/report/meta`、6 个 agent 需从 0 配）。

### T5.0 硬前置（内容工作）
- [ ] 定星座时运**合规口径**（生成式 AI 备案 / 内容安全），prompt 内置免责声明。
- [ ] admin 后台配 6 个 agent：`emotion` / `baike` / `horoscope` / `translate` / `tool` / `general`，全部 publish。

### T5.1 分类器
- [ ] 新增 `packages/agent-core/src/core/intent-classifier.ts`：三级快通道（L1 显式 / L2 规则 / L3 flash 档 LLM / L4 `general` 兜底），纯 TS 可单测。
- [ ] 解析容错：剥 markdown 围栏、正则取 JSON、幻觉 agentId 丢弃。
- [ ] 分类模型用 `getOrFallback('deepseek-v4-flash')`；`candidates` 实时取自 `agentRegistry.list()`。

### T5.2 事件类型
- [ ] `packages/agent-core/src/interfaces/runtime.interface.ts`：`StreamEventType` 加 `'intent'`；`StreamEvent` 加 `intent?`。

### T5.3 IntentService
- [ ] 新增 `servers/ai-agent/src/agent/intent/intent.service.ts`：读会话锁定 → 调分类器 → 写回 `agent_conversations.agent_id`。
- [ ] 切换阈值：explicit 无条件 / rule ≥0.88 / llm ≥0.75 / fallback 不切。

### T5.4 契约与接线
- [ ] `servers/ai-agent/src/agent/dto/agent-run.dto.ts`：`agentId` 加 `@IsOptional()`（向后兼容显式传值）。
- [ ] `servers/ai-agent/src/agent/agent.controller.ts`：stream 前解析意图 → **先推 `intent` 事件**（早于任何 token）→ **定义快照与埋点均用 `resolvedAgentId`**（不改会静默降级为空）。
- [ ] `servers/ai-agent/src/agent/agent.module.ts`：注册 `IntentService`，注入 `ClientRegistry`。

### T5.5 落库
- [ ] `migrations/0010_*.sql` 内追加：`agent_conversations` 加 `agent_id VARCHAR(64)` + `intent_history JSON` + 索引。
- [ ] `servers/ai-agent/src/agent/memory/agent-conversation.entity.ts` 同步字段。

### T5.6 灰度开关
- [ ] `.env`：`INTENT_ROUTING_ENABLED=false`（默认关）、`INTENT_MODEL=deepseek-v4-flash`、`INTENT_TIMEOUT_MS=1200`。

### T5.7 前端配合
- [ ] `pages/chat/index/index`：**`conversationId` 每轮回传**（P0 硬约束，漏传 = 每轮重分类）。
- [ ] （P1）渲染 `intent` 徽标 + 手动切换入口。

**验收 7 条**：
- [ ] 省略 `agentId` 时 SSE **第一个**事件是 `intent`
- [ ] 同 `conversationId` 追问 `via='locked'` 且 agentId 不变
- [ ] `agent_log.agent_id` 是具体 agent，**不是 `auto`**
- [ ] 埋点 `system_prompt` 非空
- [ ] 分类 P95 < 400ms；首字延迟增幅 < 300ms
- [ ] 关 `INTENT_ROUTING_ENABLED` 行为与改动前完全一致
- [ ] 后台下线某 agent 后 `candidates` 同步移除

---

## 7. 批次 6 · legacy 页面清理（独立一期）

- [ ] 下架页面：`pages/index` · `pages/draw` · `pages/records` · `pages/scan` · `pages/bianbian/*`(5) · `pages/contract/*`(7，chat 能力已在 T3.3 并入)。
- [ ] 连带清理：`utils/CanvasEngine*`、`utils/Brush.ts`、`utils/Layer.ts`、`utils/History.ts`、`utils/shapes.ts`、`utils/catmullRom.ts`、`services/drawing-records.ts`、`services/bianbian-storage.ts`、`utils/bianbian-constants.ts`（**需整体引用评估后删除**）。
- [ ] `app.json` pages 数组同步收缩。
- 验收：`tsc --noEmit` 零错误；无悬空引用；编译产物体积下降。

---

## 8. 门禁与风险

| 项 | 口径 |
|---|---|
| 类型检查 | 小程序侧 `tsconfig.json` 既有缺陷（见批次 1 注），暂用限定范围检查：`npx tsc --noEmit --moduleResolution node --types wechat-miniprogram,jest` 后**只看本批次改动文件**是否有错；后端跑相关包 `pnpm lint` / `pnpm typecheck` |
| tsconfig 修正 | 待用户确认后修 `apps/kedou-ai-minigram/tsconfig.json`：`types` 对齐实际安装的 `@types/wechat-miniprogram`、补 `moduleResolution: "node"`（否则任何批次都无法用 tsc 做门禁） |
| 迁移 | `NODE_ENV=production` 环境 `synchronize` 关闭，**必须手工执行 migration** |
| 环境 | 工作区含 `servers/ai-agent`、`servers/ai-service`，但**运行时后端在发布目录 `~/web_system_release`**，改动须走发布流程才生效 |
| 假数据风险 | 新骨架 11 页看着完整实则 0 请求，排期按「接真」而非「新建」估工 |
| 双份链路 | `contract/*` 与 `assess/*` 并存期间禁止各自演进，批次 3 内收口 |
| 意图误判 | 强制 `general` 兜底 + 阈值保守 + 前端徽标可手动切 |
| 成本 | 分类器限 flash 档 + `maxTokens:60` + `temperature:0`；规则层挡掉 70–80% |

---

## 9. 并行线（不在本清单内）

`specs/mp-platform/`（小程序研发管理平台，仅设计无代码）与小程序本体**无强依赖**，唯一交叉点为 D7（自有小程序走 M4 密钥模式发布）。其里程碑 P0/M1/M2/M3/M4 见该目录 `design.md §5`。

---

## 10. 验证判据表 V1…Vn（设计与交付同构，交付时按同一编号给证据）

> 四列缺一 = 判据未定义。实现完成后逐条实跑取证，不得用「应该没问题」替代（`rd-execute` 完成验证门）。

### 批次 1 · 前端骨架收口

| 编号 | 判据（做成 = 一句话可验证） | 验证手段 | PASS 条件 | 不通过如何处理 |
|---|---|---|---|---|
| V1 | 启动页为欢迎页，且欢迎页不在 tabBar 中 | `node -e "const a=require('./apps/kedou-ai-minigram/app.json');console.log(a.pages[0]);console.log(a.tabBar.list.map(t=>t.pagePath+':'+t.text).join(','))"` | 首行 `pages/welcome/index/index`；次行恰为 `pages/chat/index/index:对话, pages/discover/index/index:发现, pages/mine/index/index:我的` | 修 `app.json` |
| V2 | tabBar 选中色为达标深橙（非纯品牌橙、非旧蓝） | 同上命令检查 `selectedColor` | `#C2410C`；且 `navigationBarBackgroundColor === '#FFFFFF'` | 修 `app.json` |
| V3 | 新增页面文件齐备（chat / discover 各 4 件） | `ls apps/kedou-ai-minigram/pages/chat/index apps/kedou-ai-minigram/pages/discover/index` | 各含 `index.json` / `index.ts` / `index.wxml` / `index.wxss` | 补缺失文件 |
| V4 | 今日一句两处同源（欢迎页与对话首条不漂移） | `grep -rn "getDailyQuote" apps/kedou-ai-minigram/pages apps/kedou-ai-minigram/utils` | welcome 与 chat 的 import 均指向 `utils/daily`，且无第二份文案常量 | 改为共用同一函数 |
| V5 | 本批次改动文件类型零错误 | `cd apps/kedou-ai-minigram && npx tsc --noEmit --moduleResolution node --types wechat-miniprogram,jest 2>&1 \| grep -E "^(pages/(chat\|discover\|welcome\|mine)/\|utils/daily)"` | 无输出 | 修该文件类型错误 |
| V6 | 新增页面无硬编码品牌色（走 token） | `grep -rn "#F97316\|#1E6FFF\|#C2410C" apps/kedou-ai-minigram/pages/chat apps/kedou-ai-minigram/pages/discover` | 无命中 | 改用 `var(--brand*)` |
| V7 | 三 tab 可切；欢迎页 `switchTab` 后不可后退 | 微信开发者工具：启动 → 点「开始对话」→ 切三个 tab | 进入对话 tab 且**无返回到欢迎页的返回箭头**；三 tab 均可切 | 修 `app.json` / 跳转 API |
| V8 | 对话页输入框多行行距正常（本轮反馈项） | 开发者工具：输入框连续输入 3 行文字 | 行距紧凑（`line-height: 44rpx` 生效），无 76rpx 级空隙 | 修 `pages/chat/index/index.wxss` |

### 批次 2 · 翻译链路打通

| 编号 | 判据（做成 = 一句话可验证） | 验证手段 | PASS 条件 | 不通过如何处理 |
|---|---|---|---|---|
| V9 | 抽工厂后合同链路行为不回归 | 开发者工具走 `pages/contract/chat` 追问一次（或直连 `POST /api/ai-agent/agent/run`） | SSE 流式正常、报告解析与重构前一致 | 回退 T2.1 |
| V10 | 工厂可按 agentId 复用（不再写死） | 翻译页发起一次请求，看开发者工具 Network 的请求体 | `body.agentId === 'translate'`（合同页为 `contract-risk`） | 修 `services/agent-stream.ts` 参数化 |
| V11 | 翻译结果页有明确失败态 | 断网或 `INTENT`/接口 500 时触发一次翻译 | 结果页显示失败文案 + 可重试入口，不静默空白 | 补失败态 UI（须先过原型） |
| V12 | 后端零新增接口即可换 prompt | admin 后台改 `translate` 的 systemPrompt 后重试 | 不发布前端即生效 | 检查是否走了 `agent/run` |

### 待拍板项（拍板后补判据）

| 编号 | 判据 | 状态 |
|---|---|---|
| V13 | 对话页隐藏 tabBar 且「发现/我的」仍可达 | **阻塞**：等 §7-Q1（实现方式）与补偿入口方案拍板，见 `apps/kedou-ai-minigram/prototype/index.html` 页首「待确认」 |

### 批次 4/5 · 发现页数据驱动 / 意图路由

判据出处：`apps/kedou-ai-minigram/docs/意图识别-实现方案.md` §10「验收清单」7 条 + 本清单 §5「验收」。批次启动时按同一四列格式补入本节。
