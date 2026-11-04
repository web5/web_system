# PC 端 portal 换血式升级 · 实现交接文档

> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
> 用途：**给新会话直接开工**，无需重读讨论过程。设计为已确认状态，只差落地代码。
> 权威文档：`design.md`（判断层）· `page-spec.md`（页面规格）· `apps/portal/prototype/index.html`（可点击原型）
> 原型/规格 commit：**`5c6f1d5`**（UI 动作门第 4 步已完成）

---

## 0. 三十秒理解

把 PC 端 portal 从「图像玩法站」（变变/画板）升级为「Agent 能力工作台」，与小程序共用同一条执行链路 `POST /api/ai-agent/agent/run`（SSE）。**后端几乎零改动**，主要工作量在前端重构。

原型的本地预览：`cd apps/portal/prototype && python3 -m http.server 8899` → 打开 http://localhost:8899/index.html

---

## 1. 已确认的设计决策（不要再问，直接执行）

### 1.1 结构

| 项 | 结论 |
|---|---|
| 形态 | 三栏：左栏（记录列表）/ 中栏（工作区）/ 右栏（上下文面板，360px 可折叠） |
| 一级导航 | **放顶栏**横向 tab：开始 / 对话 / 发现 / 翻译 / 合翻 / 实验室 |
| 「我的」 | **不在顶栏**，收进右上角头像下拉菜单（我的 / 退出登录） |
| 左栏 | 只放**会话 / 记录 / 信息列表**；**入口网格视图（发现、实验室）整体隐藏左栏**，中栏撑满 |
| 右栏 | **仅在一处渲染**：合翻报告（合同原文对照）；欢迎页/对话页/翻译页**不设右栏**（翻译术语库已移除，2026-09-21） |
| 会话模型 | **不按类型隔离**，统一一个会话流；`agentId=auto` 由后端自动识别意图 |
| 页面通栏 | 「我的」等内容页**不限宽**；仅对话消息流（760px）与欢迎页每日一句（560px）保留阅读限宽 |

### 1.2 命名与内容

| 项 | 结论 |
|---|---|
| 能力名 | 合同体检 → **合同翻译官（简称「合翻」）** |
| 变变 | 改名**「秀秀」**，与画板、相册、Todo、工具箱一起收入**实验室**，保留代码 |
| 会员 | **占位**（「科豆专业版 · 会员功能开发中」），不做积分/订单 |
| 欢迎页 | **逐项对齐小程序 `pages/welcome/index`**：`Hello.`（句点品牌橙）+ 副文案「科豆 AI · 体验不一样的 AI」+ 今日一句**中英对照** +「开始对话」+ 页脚备案声明 |
| 今日一句 | 词库与小程序 `utils/daily.ts` **同源**（7 条，字段 `cn/en`）；将来接后端运营接口后两端共用 |
| 欢迎页不做 | 不做输入框前置、不做能力 chip、不加定向行动按钮、**不重复展示最近对话**（左栏已承载） |

### 1.3 三条 PC 独占增强

1. **合翻报告 + 原文双栏联动**：点风险信号 → 右栏原文片段高亮定位。
2. **翻译并排对照**：原文 / 自然版 / 直译版 / 委婉版同屏（替代小程序折叠区）。
3. **快捷键与桌面级交互**：`⌘K` 命令面板、`⌘N` 新建、`⌘/` 帮助、`Esc` 关闭；合同记录批量导出。
4. **不做**：多任务并行、暗色模式、粘贴长文本自动识别为合同。

---

## 2. 分期任务（按序实现，每期独立可验）

### P1 · 骨架 + 欢迎页 + 对话工作台

| # | 任务 | 涉及文件 |
|---|---|---|
| 1 | 导航**配置化**：把 `AppNavbar.vue` 里硬编码的菜单抽到 `src/config/nav.ts` | `src/components/AppNavbar.vue`（改）→ `src/config/nav.ts`（新） |
| 2 | **三栏外壳**：顶栏导航 + 左栏列表 + 中栏 + 右栏（可折叠）；实现左栏显隐规则 | `src/App.vue`、`src/components/AppNavbar.vue`（改）；新增 `src/components/AppSideList.vue`、`AppContextPanel.vue` |
| 3 | 头像下拉菜单（我的 / 退出登录） | `src/components/AppNavbar.vue` |
| 4 | **欢迎页**：单列居中 landing 排版 + 品牌橙光斑 + 今日一句（cn/en）+「换一句」+ 页脚声明 | `src/views/Welcome.vue`（新，替代 `Home.vue` 的默认落地） |
| 5 | **对话工作台**：左栏会话列表 + 中栏消息流 + 输入区；改接 `/api/ai-agent/agent/run`（SSE） | `src/views/AiChat.vue`（重写） |
| 6 | 路由调整：`/` → Welcome；`/chat` 保留；补全 `/discover` `/translate` `/contract` `/lab/*` | `src/router/index.ts`（改） |
| 7 | 主题收敛：portal 现用主色 `#FF8C42` → `--ws-brand-500:#F97316`（`packages/ui/src/tokens.css`） | `src/App.vue`、`src/styles/global.css` |

### P2 · 发现 + 翻译工作台

- `src/views/Discover.vue`（新）：能力卡片网格（依赖 B2 接口，未就绪前按规格写死）。
- `src/views/Translate.vue`（新）：左历史（=统一会话）/ 中输入 + 右对照栏（并排对照，无术语库面板）。
- 三版译文解析可直接复用小程序侧已实现的 `apps/kedou-ai-minigram/utils/translate-parse.ts`（commit `ab98693`，含测试）——建议抽到 `packages/` 共享，避免两套实现。

### P3 · 合翻（合同翻译官）

- `src/views/Contract.vue`（新，七页合一）：选择 → 上传（**拖拽 + 点击 + 粘贴**）→ 分析进度（含「查看完整思考」抽屉）→ 报告。
- 报告 ↔ 原文**双栏联动**：P3 先**关键词回查**兜底（用 `signalTitle`/`plainText` 关键词在原文定位，找不到则不高亮、不报错）；后端补 `excerpt` 字段后升级为精确定位。
- 报告结构复用小程序 `services/contract-api.ts` 的 `ContractReport` 类型。

### P4 · 我的 + 桌面级交互

- `src/views/Profile.vue`（重写）：账号卡 + **会员占位卡** + 应用设置 + 通用 + 我的数据 + 退出（内容区**通栏**）。
- ⌘K 命令面板、⌘N、⌘/、批量导出报告。

---

## 3. 后端待办（前端开工前确认排期）

| # | 事项 | 阻塞 |
|---|---|---|
| B1 | 每日一句运营接口（C 端读 + 运营配置） | P1 欢迎页（接口未就绪前端先用同源本地词库） |
| B2 | C 端 agent 清单接口 + `agent_definitions` 展示元数据列（名称/描述/图标/排序/上线状态） | P2 发现页（**不能**复用 admin 接口，会漏 systemPrompt） |
| B3 | 合同 signal 补原文片段字段（如 `excerpt`）并在报告快照存合同原文 | P3 双栏联动精度（可选增强；补了小程序端也受益） |
| B4 | 开启意图路由 `agentId=auto`（小程序规划第 3 批 M4，开关默认关） | P1 对话（需 6 个 agent 配好 + 合规口径通过） |
| B5 | agent 展示名同步「合同体检官」→「合同翻译官」 | P2/P3（小程序端是否同步改名另议） |

**Q1 已查证结论**：当前产物**无**原文定位字段——前端 `ContractSignal` 只有 `legalBasis.quote`（法条引用，非合同原文）；后端 `ContractReportSnapshot`（`servers/ai-agent/src/contract/contract-report.parser.ts`）对 signals 仅白名单透传，且合同原文不落库。

---

## 4. 实现约束（硬性）

| 项 | 约束 |
|---|---|
| 技术栈 | Vue 3.4 + vue-router 4 + Pinia 2 + Vite 5 + ant-design-vue 4；**未使用** `packages/ui`（本次宜接入其 token） |
| 微前端 | portal 是 gateway 子模块，构建用 `MF_FORMAT=system npx vite build --mode mf` |
| 生效三步 | ① 构建 → ② 拷贝 `dist/*` 到 `servers/gateway/public/static/modules/portal/<hash>/` → ③ `UPDATE deploy_deployments SET current_version='<hash>'`（**该表在 `web_system_deploy` 库，不是 `web_system`**）；gateway 有 10s TTL 缓存，必要时 `pm2 restart web-gateway` |
| Token | 一律写 token 名（`--ws-brand-500` 等），**禁裸 hex**；图标用 `@tabler/icons-vue` 或内联 SVG，**禁 emoji**；字重只用 400/500/600 |
| 鉴权 | 沿用 `src/api/request.ts`（axios baseURL `/api`，Bearer + refreshToken 重试 + 401 跳 `/login?redirect=`） |
| 主要接口 | `/api/ai-agent/agent/run`（SSE，唯一执行链路）、`/api/ai-agent/agent/conversations`、`/api/ai-agent/ocr/recognize`、`/api/ai/tts/speak`、`/upload/*` |
| 端口 | gateway 6000、auth 6101、ai-service 6003、ai-agent 6010、system 6004 |

### 4.1 UI 动作门（新会话必须遵守）

改动任何 `*.vue` 前：① 原型已改（本次已完成）② 规格已同步 ③ **用户已确认** ④ 原型/规格单独 commit（`5c6f1d5`）⑤ 落码的 UI commit message **必须带一行 `Proto: 5c6f1d5`**（`.githooks/commit-msg` 强制 + CI R10 兜底）。

若后续还要改原型，需**再单独 commit 原型**，新 UI commit 引用**新的** sha。

---

## 5. 易踩坑（项目特定）

1. **改前端不生效**：portal 是微前端模块，改完源码必须走「构建 → 拷贝 → 更新版本表」三步，浏览器才加载新产物。
2. **版本表库名**：`deploy_deployments` 在 `web_system_deploy` 库（gateway 用独立数据源 `DEPLOY_DB_NAME`），不是业务库。
3. **在 release 目录构建**：`~/web_system_release` 通常停在 master，工作区分支改动进不去 → 表现「改了不生效且无报错」。
4. **主色不一致**：portal 现用 `#FF8C42`，小程序与 `packages/ui` 是 `#F97316`（深档 `#EA580C`/`#C2410C`），必须收敛，否则两端不同色。
5. **翻译解析别写第二套**：小程序侧已有 `utils/translate-parse.ts` + 测试，抽到共享包复用。
6. **会话隔离已废弃**：不要再按「对话/翻译/合同」做三个列表，统一一个会话流。

---

## 6. 未决项（开工前可快速确认，不阻塞 P1）

1. 合翻流程里的**动词**是否改名（现为「开始体检 / 取消体检 / 体检报告」，能力叫“翻译官”后是否改「解读」等）。
2. B1（每日一句接口）是否本轮一起排。
3. 小程序端是否同步把「变变」改名「秀秀」、「合同体检官」改名「合同翻译官」。

---

## 7. 交接检查清单（新会话开工前勾选）

- [ ] 读 `design.md` §2（IA）与 §6（决策 + 后端待办）
- [ ] 读 `page-spec.md` §0（欢迎页）与 §1（外壳）
- [ ] 打开原型走一遍：顶栏导航 → 合翻报告双栏联动 → 翻译对照 → ⌘K
- [ ] 确认本期做到 P 几（默认从 P1 开始）
- [ ] 落码 commit 带 `Proto: 5c6f1d5`
