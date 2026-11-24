# 页面规格书 · 大橙子个人助理小程序（#4 首页改造 + #7 对话 markdown）

> 建：2026-11-10
> 方案真源：`30-任务产物/2026-11-10-小程序人工测试问题第二轮/01-首页与markdown改造方案.md`
> 参考实现：`apps/kedou-ai-minigram/`（同仓科豆 AI 小程序，橙色系 → 大橙子蓝色系）

## 范围

两项前端增量，均**不改 app.json**、**不新增 npm 依赖**、**不改后端接口**：

| # | 需求 | 方案 |
|---|---|---|
| #4 | 首页参考科豆 AI 首页 | 方案 A 增量对齐：保留现有骨架，新增「今日一句」+ 把「最近使用」空态升级为真实「最近对话」卡片 |
| #7 | 对话气泡 markdown 渲染 | 方案 A 移植科豆自研 rich-text 渲染器（`utils/markdown.ts`，零依赖） |

## 页面清单

| 页面 | 路径 | 文件 | 说明 |
|---|---|---|---|
| 首页 | `pages/home/index/index` | `index.wxml` / `index.ts` / `index.wxss` | 问候 hero 后新增「今日一句」；「最近使用」→「最近对话」三态卡片 |
| 对话页 | `pages/chat/index/index` | `index.wxml` / `index.ts` | 普通气泡 AI 回复由 `<text>` 改 `<rich-text nodes>` markdown 渲染 |

## #4 首页改造（方案 A · 增量对齐）

> 2026-11-23 注（原型 114 已由用户确认）：#4「新增今日一句」为 2026-11-10 历史表述，现状已实现；本轮不再新增，只改问候与句源，详见文末 §2026-11-23 三条需求规格。

问候语改为按设备本地时区 5 段动态生成、格式「<昵称>，<问候语>」（2026-11-10 版「保留『下午好』，不改成 Hello.」判据**作废**，详见 §2026-11-23 ①）；今日一句本轮不加「换一句」；不做长文本折叠/复制；全程走 `app.wxss` 蓝色 token，不引入科豆橙。

### 交互判据

| # | 判据 | 实现 |
|---|---|---|
| H1 | 今日一句同天稳定、隔天换 | `getDailyQuote()` 已接真实 NCE 句池 `NCE_LINES`（`dayIndex()` 对 `NCE_LINES.length` 取模 → `pickNceLine()` 同句配对），`FALLBACK_QUOTES`（7 条兜底）保留仅用于空池回落。✅ 用户 2026-11-24 撤销 A2「不落盘」，句池快照已落盘（`utils/nce-quotes.ts`，真实 NCE2 96 课 / 1601 条）；仍不接 `services/nce.ts`（本轮走随包快照，非接口方案），见 §2026-11-23 ② |
| H2 | 最近对话三态 | data 增 `recent` / `recentLoading`；`loadRecent()` 渲染三态：骨架 `.sk` / 有会话卡片 / 空态（保留原文案） |
| H3 | stale-while-revalidate | 本地缓存键 `welcome_recent_cache` 秒显；后台 `listConversations(1,1)` 取最近会话 + `getConversation(id)` 取最后一条预览（≤60 字），成功写回缓存 |
| H4 | 未登录不发请求 | `loadRecent()` 先判 `isLoggedIn()`，未登录直接空态（退出登录已由 auth 清缓存） |
| H5 | 点卡片恢复会话 | `openConv()` → `wx.navigateTo('/pages/chat/index/index?conversationId=<id>')`（复用现有 `conversationId` 路由参数） |

### 验收判据

| # | 判据 | 通过标准 |
|---|---|---|
| H-V1 | 今日一句稳定 | 同一天多次进出文案一致 |
| H-V2 | 最近对话三态 | 无会话空态；有会话显示最近一次（标题 + 预览 ≤60 字 + 时间）；加载中骨架占位不跳变 |
| H-V3 | 二次秒显 | 二次进入先读本地缓存，后台刷新 |
| H-V4 | 点卡片聚焦 | 进入对话页并聚焦该会话最新一条 |
| H-V5 | 能力入口回归 | 翻译 / 新概念英语 / 新对话入口点击可达；未登录仍走「先登录」引导；合规两行保留 |

## #7 对话气泡 markdown 渲染（方案 A · 移植科豆自研渲染器）

### 渲染器

`utils/markdown.ts` 移植科豆 ~300 行 `mdToNodes(md) → rich-text nodes` + `mdToPlain(md) → 纯文本`，仅改硬编码色值（科豆橙 → 大橙子蓝）：

| 常量 | 科豆值 | 大橙子值 |
|---|---|---|
| `brand` | `#F97316` | `#3B82F6` |
| `brandTxt` | `#EA580C` | `#2563EB` |
| `codeText` | `#C2410C` | `#1D4ED8` |
| `quoteBg` | `rgba(249,115,22,0.06)` | `rgba(37,99,235,0.06)` |

其余常量（`t1` / `t2` / `codeBg` / `line`）不变；渲染逻辑一条不改。

四条硬约束原样保留：① 色值硬编码（rich-text 是 webview 隔离渲染，拿不到页面 CSS 变量）；② 单位用 px 不用 rpx（内部按 `wx.getSystemInfoSync().windowWidth` 做 rpx→px，jsdom 下单测回退 375）；③ nodes 是对象数组非 HTML 字符串（`<>&` 按纯文本，天然无 XSS）；④ 流式友好（未闭合 `**` / `` ` `` / `[` 原样输出、未配对 ``` 围栏按普通段落）。

### 交互判据

| # | 判据 | 实现 |
|---|---|---|
| M1 | 气泡改 rich-text | 普通气泡 AI 回复 `<text class="bub-text">` → `<rich-text nodes="{{item._nodes}}">`，流式光标 `.caret` 保留在 rich-text 旁；用户消息 / 失败态仍走 `<text>`（蓝底白字 / 红字，保可读、不回归） |
| M2 | nodes 生成在页面层 | `withMdNodes(msgs)` 放 `chat/index.ts`；`utils/chat-msg.ts` 仅加 `_nodes?: any[]` / `_mdSrc?: string` 字段，保持「不 import wx / services」裸跑约束 |
| M3 | 流式增量重算 | `patchAi` 在 `patch.text` 变化时顺带重算 `_nodes`（路径级 setData，不全量序列化） |
| M4 | 全链路过渲染 | 历史 `loadHistory` / 种子 `buildSeedBubbles` / 入列 / `onReply` 最终气泡统一过 `withMdNodes` |

### 验收判据

| # | 判据 | 通过标准 |
|---|---|---|
| M-V1 | markdown 语法 | 加粗 / 标题 / 列表 / 代码块 / 表格 / 链接 / 行内代码 / 引用 / 分隔线均正确排版 |
| M-V2 | 流式降级 | 未闭合 `**` / `` ` `` / `[` 原样输出不吞字；未配对 ``` 不误判为代码块 |
| M-V3 | 无 XSS | 文本含 `<>&`、`<script>` 按纯文本渲染 |
| M-V4 | 单测 | 移植 `tests/markdown.test.ts`（含 `assertNoBareString` 守「children 无裸字符串」）全绿 |
| M-V5 | 回归 | 翻译卡气泡（`item.card`）交互（#3）与顶部导航（#5）不受影响 |

## 工程门禁状态

- ✅ 本页规格为 **Proto commit**（只含 specs/），后续 UI 落码另 commit 并带 `Proto: <本 commit sha>` + `Design: pass`（设计评审真源即上文方案文档）。
- ⚠️ 微信开发者工具真机目视仍待人工（今日一句 / 最近对话三态 / markdown 气泡排版 / rich-text 与光标同行），不因单测全绿视为已验收。

## 2026-11-23 · 三条需求规格（原型 114 已由用户确认）

> 原型真源：`30-任务产物/2026-11-17-大橙子小程序NCE交互与登录态整改/114-原型稿-加载态骨架屏靠上-2026-11-23.html`
> 冻结值：938 行 / 67013 B / sha16 `a64aab5fd20613f0`；用户 2026-11-23「好的原型稿，我看可以了」。
> 设计决策记录：同目录 `115-…md`。本规格书是工程侧护照，原型 HTML 不进应用代码目录。

### ① 首页 hero 动态问候 + 昵称
- 5 段（设备本地时区，不写死 UTC+8）：`[0,6)` 夜深了 / `[6,12)` 早上好 / `[12,14)` 中午好 / `[14,18)` 下午好 / `[18,24)` 晚上好。
- 展示格式严格「<昵称>，<问候语>」，长昵称按 `NICKNAME_MAX_CHARS` 截断。
- 昵称三态：本地 `readLocalNickname()` 秒显 → `fetchProfile()` 拉取（仅 `loggedIn=true`） → `isNicknameUnset()` 判空/`wx_` 占位 → 兜底「同学」；拉取中给占位，不闪烁、不编造。
- 纯函数层已落 `utils/greeting.ts`；页面只做接线，不另抄文案表。
- 回归约束：未登录整页 `login-gate` **零业务请求**不被破坏；`profile:updated` 广播须在 `onUnload` 退订。

### ② 每日一句（中英配对）
- 页面 `quote.cn` / `quote.en` 双行中英**同句配对**不变；按本地日期确定性切换、同天稳定。
- ✅ **2026-11-24 用户撤销 A2「句池不落盘」**（原话「每日一句要落盘并部署，推二维码验证」）：句池快照已落盘 `utils/nce-quotes.ts`，导出 `NCE_LINES` = 真实 NCE2 96 课共 **1601 条** `{ cn, en }`（同源 `en && cn` 同时非空过滤，剔除 `id=90`「What's for Supper」`lines[9]` 空 `cn` 脏行），确定性顺序（lesson.id 升序 + lines 原序）。
  `getDailyQuote()` 已接 `NCE_LINES`：`dayIndex()` 对 `NCE_LINES.length` 取模（保留本地日期语义 `new Date(y,m,d).getTime()/86400000`，不走 UTC epoch 天数）→ 复用 `pickNceLine(dayNumber, lines)` 完成过滤 / 同句配对 / 确定性取模 / 空池兜底；`FALLBACK_QUOTES` 7 条保留不删，仅作空池回落。签名 `getDailyQuote(): { cn, en }` 不变 → `index.*` **零改动**。
- 🔴 **仍不接 `services/nce.ts`**：本轮走**随包快照**（非接口方案 B）。接口方案会撞「首页未登录零业务请求」设计，且须改 `index.ts` 触发 UI 门禁，属另一次拍板。
- 版权风险留痕：`migrations/0025_nce_lessons.sql` 头注释「教材内容仅供个人学习，本表不对外分发」；用户 11-24 已授权随包落盘，**正式上架 / 商用前须另确认 NCE 教材与译文的授权范围**（风险归用户承担，研发部留痕不代拍）。
- 禁止在真实 UI 出现「来自 NCE 课文句」等误导文案（原型里是评审占位说明）。

### ③「我的」页移除未完成的学习进度
- 移除边界（原型 `114` L473 / S9 已确认）：`pages/mine/index/index.wxml` 的「课文学习进度」整行 + `index.ts` 的 `nceSummary` 字段、`goNce()` 方法、文件头对应注释。
- 保留：收藏 / 设置 / 用户协议 / 关于四行列表、登录墙、其它页面所有「学习进度」文案（含 `glossary` 的 `goNce`）、常用功能卡、NCE 详情。
- 不编造任何进度数字。

### 验收判据
V1 原型 114 已确认 · V2 4 个 UI 文件指纹可查 · V3 B 抽样 4 文件全绿 · V4 ≥1 点变异红→恢复绿 · V5 零 commit / 真实 NCE 句池已落盘（1601 条，`index.*` 零改动）/ 零其它页面改动 · V6 真机目视（待出码）。

## 2026-11-24 · 阶段③ 每日一句精选池（用户四点拍板，台账 8979）

> 方案真源：`134-阶段③AI提炼优美中英文语句产品方案-2026-11-24.md` §四选项 3「仅 AI 精选池 · 离线预生成」；`135` §四。用户拍板四点：**仅 AI 池 / 离线 / 前端无感 / 不加标识**——方向锁死，本规格只记录「怎么做」。

### 规格要点

| 维度 | 规格 |
|---|---|
| 显示池口径 | **仅精选池**：显示层 100% 用精选池（136 条从真实 NCE 句池人工筛选的优美完整句）；全量 1601 原句池 `utils/nce-quotes.ts` **保留不动**，仅作溯源底稿，退出显示层。🔴 阶段③ S4 翻转后，精选池**不再随包消费**：迁为单位于 content-hub 的服务端只读 JSON 资产，经网关 JWT GET 下发 + 本地缓存读取；`utils/daily-quotes.ts` 保留为 JSON 的唯一生成源，退出显示层随包消费（见 §2026-11-24 · S4 服务端存储） |
| 数据来源 | 唯一真源仍为 `lessons.json`（NCE2 / 96 课 / sha16 `40339154ec0a54ad`）；**每条精选句逐字取自该文件某条真实 `{en,cn}` 行，零改写、零编造**；服务端资产逐条反查 `mismatches=0` |
| 提炼时机 | **离线（后台一次性）**：精选池在会话内人工筛选、构建期导出为服务端只读 JSON 资产；运行时小程序**只读现成数据**，不调 LLM、原文不出本机；「离线（生成时机）」与「服务端（存取位置）」正交 |
| 前端无感 | 新文件中性命名，对外结构体仅 `{cn,en}`（服务端资产/测试层带 `source={book,lessonId,title,lineIndex}` 溯源锚点，不进 UI）；源码层不出现 AI/LLM/生成/prompt 等字样；`getDailyQuote(): {cn,en}` 同步契约不变 |
| UI 改动 | **零**：`index.ts` / `index.wxml` 零改动 → 不触发 UI 门禁 / passport 环境债；不加「AI 提炼 / 来源」标识 |
| 取句算法 | `dayIndex()` 本地午夜口径 `new Date(y,m,d).getTime()/86400000`（🔴 不改成 UTC）→ 对缓存池长度 N 取模 → 同天稳定 / 隔天换 / N 天轮回；缓存空 / 失效 / 全脏 → **B③ 极薄兜底**（≤10 条 NCE 逐字精选句，带 source、从 136 池挑，替换原 7 条通用句），不抛错不白屏不弹 toast |
| 版权 | 新文件头注沿用「仅供个人学习，不对外分发」+ 追加「派生语句为 NCE 原文筛选 / 提炼，供个人学习」；提炼只用本地原文 + 语义判断，不调外部 LLM，原文不出本机；服务端资产非公共 CDN、走 JWT 网关只读通道 |

### 验收判据（阶段③）

| # | 判据 | 标准 |
|---|---|---|
| S-V1 | 溯源反查 | 精选池每条按 `source` 身份键反查 `lessons.json` 命中真实原句，`mismatches=0`；无编造事实 |
| S-V2 | 中英成对 + 完整句 | `{cn,en,source}` 三者一致；输出均为完整句（非逗号 / 分号结尾叙事半句） |
| S-V3 | 确定性轮换 | 同天稳定 / 隔天换 / N 天轮回；变异「取模改回 7」应红 |
| S-V4 | 兜底 | 空池 / 全脏行 / 单元素 / 异常 dayNumber 回落兜底池，不抛错 / 不白屏 / 不 toast |
| S-V5 | 版权 / 无感 | 头注齐全；源码零 AI/LLM/prompt 痕迹；`index.*` 与 `127` 基线一致 |
| S-V8 | dayNumber 口径 | 东八锚点 `TZ=Asia/Shanghai` → `dayNumber=20780`，对 N 取模定位；与 UTC 解耦断言；🔴 不改成 UTC |
| S-V9 | 零动作边界 | 零 git 写 / commit / push / 链 B / prod / 出码 / 台账写 / 改 `index.*` / 删 `nce-quotes.ts` / 改 100–135 号稿 |

## 2026-11-24 · 阶段③ S4 服务端存储（六项拍板 8979 · 用户口径锁死）

> 方案真源：`138` §四/§五/§六/§八 + `139`（B③ 订正）+ `140`（六项拍板）。本节**覆盖**上文「随包静态快照」表述：第 3 点口径翻转为「产物存服务端、小程序联网读现成数据」。原随包方案决策链留痕不回改。

### 架构与数据流（三段）
1. **内容段（后台/构建期一次性）**：迁用 `utils/daily-quotes.ts` 的 136 条精选句（唯一可复用资产、只迁用不重筛）→ 导出 content-hub 只读 JSON 资产 `servers/content-hub/data/daily-quotes.json`（`version`/`count`/`items[{cn,en,source}]` + 版权头注）；逐条反查 `lessons.json` 零编造。
2. **拉取段（小程序启动·登录态内静默）**：`app.ts onLaunch` 在 `autoLogin()` 后调用 `services/daily-quotes.ts` → `request({url:'/api/content-admin/nce/daily-quotes', silent:true, method:'GET'})` → gateway `pathRewrite ^/api/content-admin→/api`、用户 JWT 透传 → content-hub `NceController` 新 `GET daily-quotes` 读冻结资产 `ok(pool)` → 成功 `wx.setStorageSync('daily_quotes_pool',{version,items,fetchedAt})`；失败/非 2xx/脏响应 `silent` 吞掉，保留旧缓存（stale-while-error）。
3. **显示段（同步）**：`utils/daily.ts` 读本地缓存池 → `pickNceLine(dayIndex(), pool)` → `{cn,en}` → `index.wxml`；缓存空/失效/全脏 → B③ 极薄兜底。

### 不变量（锁死）
- `getDailyQuote(): DailyQuote` 同步签名 + `{cn,en}` 形状不变 → `index.ts`/`index.wxml` **零改动**（指纹 `1a1c594091d3ae7b` / `bb59b075230dd4c5` 不变，不触发 UI 门禁）。
- `dayIndex()` 本地午夜口径 `new Date(y,m,d).getTime()/86400000`（🔴 不改成 UTC）；`pickNceLine()` 纯函数保留。
- 运行时零 LLM、零外部 API、零新 key、原文不出本机；全量 1601 池 `nce-quotes.ts`（`cb3fb95d…`）保留不动。

### B③ 极薄随包兜底（对「7 条通用句」的显式覆盖）
- 首启无缓存 + 断网无缓存时显示 **≤10 条 NCE 逐字精选句**（从 136 池挑、带 `source`、零编造、中性命名），**不再显示原 `FALLBACK_QUOTES` 7 条通用句**。
- 代价 = 极薄随包（≤10 条，非全量 1601 / 非 136 全量）；`source` 仅留痕不进 UI。

### 服务端接口契约
- `GET /api/content-admin/nce/daily-quotes`，无路径参数；可选 `?version=<整数>` 强校验、非法忽略（不 500）。
- 响应 `{code:0, data:{version:number, count:number, items:[{cn,en,source}]}, message:'ok'}`（`Wrapped` 同构，三端同源）；controller 不挂 `JwtAuthGuard`、无 service key。
- 静态段 `daily-quotes` 与 `@Get('lessons/:id(\\d+)')` 无抢匹配。

### s16 半成品处置（138 §八）
`daily-quotes.ts` 保留为 JSON 生成源；`daily-quotes.test.ts` 迁用/改写为对 JSON 资产的校验（断言不弱化）；`daily.ts`/`daily.test.ts`/本节规格在其既有未提交改动上叠加改写，禁 `restore`/`rm`；`136` 稿留痕不回改。

### 验收判据（阶段③ S4）
V1 离线零 LLM · V2 资产逐条溯源 `mismatches=0` · V3 服务端可用性（归用户/出码后） · V4 鉴权无新 key · V5 同天稳定/隔天换/N=136 轮回/缓存 · V6 断网回落 B③ ≤10 极薄兜底、silent 无 toast · V7 `index.*` 零改动 · V8 版权头注 · V9 需求② 池未动 · V10 dayNumber 本地午夜锚点 · V11 s16 零丢弃 · V12 零动作边界。B 抽样 ≥6 suites / 77 tests + ≥1 组变异红绿，禁全量。

