# 交互质检报告 · agent-widgets（SSE 流式 Markdown 内嵌可交互组件）

> 评审对象：
> - 前端 demo：`/Users/geekwen/workspace/web_system-agent-widgets/ai-agent-widgets-demo/`（Vue3 + Vite；`public/mf-widgets/{chart,form,poll}.system.js`；mock/real 两态 SSE；`src/lib/widget-protocol.ts` 解析 ```widget fence）
> - 后端工具：`servers/ai-agent/src/agent/tools/present-widget.tool.ts`（白名单/原型污染清洗/{app,props} 载荷）。已合入 origin/master（blob `5a8ae84e`，与 feat/present-widget-tool-master 完全一致）；本地 web_system worktree HEAD `765690c3` 落后于 origin/master `fb9085a6`，故本地 `src/` 目录暂不可见、仅存 dist 产物 —— 本报告以 `git show origin/master:<path>` 只读取得源码评审。
> 判据源：`~/.workbuddy/skills/ux-prototype-designer/`（真源 `/Users/geekwen/workspace/ai-agent-kit/skills/ux-prototype-designer/`）`SKILL.md` + `references/ux-review-checklist.md`（A–I，含 J 段演示控件）；仓库红线门 R11（`specs/design-reviewer/design.md` §3.7，报告头部 `阻塞: N` 行首锚定机检）
> 评审方式：独立自检（先读判据源，再看被审物；全程只读，未改任何仓库文件、未做 git 写操作），2026-11-27
> 需求侧参考（只读）：`04-真实业务场景验证-SSE-widget实现路径.md`、`2026-11-13-SSE流式Markdown微前端-方案定稿与交接/00-总览与决策.md`
> 报告格式样例：`web_system/docs/ui/reviews/console-cleanup-scan-20261009.md`

阻塞: 0
重要: 2（见 §重要）
遗留（不影响本次过门）: 4（见 §遗留）

## 评审定位说明（先定性，再逐项）

本次被审物是**一条技术验证 demo 的实现链**（A′ 自包含形态），不是面向最终用户的产品原型稿。需求侧已明确：本轮是「实现路径验证」，非产品立项；真实业务库接线受 #8810 未拍板约束，AI 问数排三期。故本报告的 A–I 逐项按「交互链本身是否闭环、状态是否诚实、边界是否守住」来判，不按「产品页面齐不齐」来判；J 段「演示控件」在 demo 中以 LoadTrace + mock/real 两态 + 会话控制按钮实现等价自解释，按 demo 形态判定。

## 通过项（A–I）

- **A 信息架构**：单页对话面板（消息流 + LoadTrace 右栏），无跨页跳转需求，故无缺页/死链/跳转环问题；三个 widget 作为消息流内嵌 block 出现，层级清晰（`AgentPanel.vue` / `MessageList.vue`）。**通过（形态适配）**。
- **B 任务流闭环**：主路径完整可走通——「开始对话 → SSE 逐字吐正文 → 正文中间挂 ```widget fence → 白名单 + 净化 → System.import → Shadow DOM mount → 点击/输入 → aguiBus 回写 system 消息」（`demo-backend.mjs` / `widget-loader.ts` / `AgentPanel.vue:111-128`）。异常分支均有着落：半截 JSON → pending 占位（`widget-protocol.ts:75-92`）、非白名单 → 占位不 import、4010 信封 → 清缓存重登重试一次（`demo-backend.mjs:354-373`）、上游 error/permission → run_error 并在 UI 报错、子应用加载失败 → WidgetSlot error 态、数据源拉取失败 → 回退初始 props 不白屏（`PollWidget.vue:71-74`）。**通过**。
- **C 状态矩阵**：加载中（骨架占位 `⏳` / `mf-slot--pending` / prefix 渲染中提示 `StreamingMarkdown.vue:68-74`）、widget 三态 loading/ready/error（`WidgetSlot.vue:14`）、会话状态 thinking/executing/waiting/done/error 六态（`AgentPanel.vue:178-188`）、voting/submitting 进行中锁（`PollWidget.vue:104`、`FormWidget.vue:57`）、完成反馈（busEcho + system 消息 + 服务端 echo）均有表现。**通过**。
- **D 操作与确认**：主操作唯一（未连接时仅「开始对话」为 primary，停止/清空为次级，`AgentPanel.vue:229-235`）；重复提交被锁（voting/submitting 期间 disable，`widgets.css:219`/`FormWidget.vue:102`）；卸载竞态有 disposed 护栏（`WidgetSlot.vue:17,32,38`、`PollWidget.vue:55`）；数据流 `widget_action → aguiBus → system 消息` 的 `on()` 返回 off，卸载精确解绑（`AgentPanel.vue:206-210`、各 widget `onUnmounted`）。**通过**（「清空会话」缺二次确认记为遗留项，见下）。
- **E 视觉与 Token 一致性**：颜色在 `:root` / `:host` 集中定义变量，Shadow DOM 内用 `:host` 重声明（`widgets.css:5-19`），与主站 token 同语义命名（`--brand #f97316` / `--accent #0ea5a4`）；无跨端元素混入；间距基本取 4/8 网格。**通过（demo 口径）**；状态文案用了 emoji 字符（⏳/👆/✅/🔌/⚠/⚙）、少量裸 hex 散落规则中，均记为遗留项（见下），并入产品原型时按 SKILL「不用 emoji 图标 / token 化」归一。
- **F 可访问性基线**：可点击区均为原生 `<button>` / `<input>`，无裸 div 点击（`PollWidget.vue:148`、`ChartWidget.vue:131`、`FormWidget.vue:101-102`、`AgentPanel.vue:229-234`）；chart 柱带 `aria-label`（`ChartWidget.vue:137`）；渲染中占位带 `aria-live="polite"`（`StreamingMarkdown.vue:68`）；焦点态有 `:focus` 描边（`widgets.css:171-174`）。对比度细节见 §重要。**通过（基线）**。
- **G 内容与真实性**：全部为真实中文业务/技术文案，无 lorem / TBD 占位堆砌；数据取自 `widgets.json`（poll question/options/votes、chart labels/names/series、form placeholder），真实展示字段齐全。**通过**。
- **H 目标端一致性**：目标端为桌面 Web（本地 5181，两栏 grid，900px 以下收单列 `global.css:553-562`）；无小程序胶囊/TabBar/原生导航混入；不涉及分享/授权/支付等平台原生能力，无需占位标注。**通过（单端）**。
- **I 未定义项显式标注**：需求侧文档已把未拍板项显式登记为待确认——Q1–Q8、跨轮状态语义（R11）、交互闭环单向需新开 POST（R14）、V7–V9 未验、台账 #8852/#8853/#8861–8863 未闭环、层 B 网关转译（#8853）为外部执行依赖、CSP `unsafe-eval`（R5）、`VITE_MCP_KEY` 生产禁用（V17）。代码内无静默发明越权降级：form/poll 写操作止于 demo `widgets.json` 回显，未自动写业务库。**通过**。
- **J 演示控件与自解释性（demo 形态适配）**：原型稿的「场景包 / 屏直达 / H 收起 / @media print」在 demo 中由等价机制实现——mock（8799）/ real（8798）两态 server 覆盖「半截 JSON / 非法 JSON / 正常三 widget / 4010」多场景；LoadTrace 7 步状态灯外化每段加载阶段；「开始/停止/清空会话」即演示控制入口。控件与产品 UI 通过徽标「微前端子应用」+ 虚线框区分（`global.css:303-310`）。**通过（demo 形态）**。

## §重要（2 项）

1. **真实数据权限校验仍为「方案契约」，未落码（对应需求 §6 / V7–V9 / #8810）**。需求侧 §3.1–3.3 要求「问数 DSL 携带 dataScope + 服务端二次校验」「写操作经人工确认闸门 + E12 审计」「poll 批量动作只对自己负责的对象」，但本轮 demo 的 `/api/widgets/*` 仍是 demo 语义 JSON 文件（`demo-backend.mjs:482-513`），`present-widget.tool.ts` 明确「props 语义由 LLM 负责，服务端不猜业务字段」。这不是缺陷 —— 需求侧已把接线受 #8810 未拍板约束、`只给契约不落码` 写死；列为重要项是为防止「把 demo 当已具备数据权限」的误读。**处置**：产品化前必须补 dataScope 服务端二次校验 + 人工确认闸门 + E12 审计，不得凭本评审放行真实业务库接线。
2. **`system-loader.resolve()` 保留任意 URL 分支（R2 P0 残留）**。`system-loader.ts:72` `if (/^https?:\/\//.test(id)) return id;` 仍可解析外部 URL，`installSystemGlobal()` 又把 System 挂到 window（:148-151）。当前 markdown 通道传不进来（白名单 app → 逻辑名 → 固定同源 URL，`parseWidgetSpec` 拒任意 URL），故 demo 链路安全；但需求侧 §6 已标注此为 R2 P0 残留、未来调用方不得传用户可控串。**处置**：接入外部子应用/CDN 前须收窄 `resolve()` 为白名单逻辑名 + 显式 base 拼接，禁止用户可控串直达。

## §遗留（4 项，不影响本次过门）

1. **交互闭环单向（R14）**：widget 点击经 aguiBus 只追加 system 消息，点击→服务端回吐需新开一轮 POST；需求侧已定性为待确认，非 bug。
2. **「清空会话」无二次确认**：`clearConversation()`（`AgentPanel.vue:170-176`）一点即清空全部消息并卸载所有 widget；demo 数据可重跑，不涉及真实数据，但产品化前应补确认。
3. **跨轮 widget 状态语义未定（R11）**：本轮靠保留历史消息让 widget 状态跨轮保留，需求侧已标注语义待定。
4. **Token / 图标细节（demo 口径）**：`global.css`/`widgets.css` 规则中有少量裸 hex（如 `#b91c1c`/`#0b7f7e`），品牌橙 `#f97316` 作小面积文本色对比度偏低；状态文案用了 emoji 字符（⏳/👆/✅/🔌/⚠/⚙）。作为技术验证 demo 可接受，并入产品原型时按 SKILL「不用 emoji 图标 / token 化」与 design-system 归一。

## 真实性自检声明

- 本次为独立自检，先完整读 SKILL.md 与 ux-review-checklist.md（A–J）及 R11 判据源，再逐文件读被审源码，顺序未反。
- 全程只读：未修改 `/Users/geekwen/workspace/web_system*` 下任何文件；未执行任何 git 写操作（add/commit/stash/push/checkout/branch/worktree 等）；评审报告仅写入本任务目录。
- 未把「历史 V1–V6 全 PASS」冒充本轮独立盲测；未把 demo 的 echo / 投票计数冒充业务库写入；未把 mock 常态冒充真实后台已验。
- 结论基于代码静态审查（未跑浏览器像素级验收 #8852、未跑真网关 C14 #8853），这两项仍为外部未闭环台账，如实保留。

## 结论

阻塞项 0，重要项 2（均为产品化前置契约，非 demo 缺陷）、遗留 4。本轮 demo 作为「SSE 流式 markdown 内嵌可交互组件」的技术验证：任务流闭环、状态矩阵、三道安全边界（白名单 / props 净化 / 同源 fence）、流式不销毁、卸载无泄漏均落实，允许作为 spec 凭证进入后续流程；真实业务库接线与 R2 P0 残留须在对应台账闭环后另行评审。
