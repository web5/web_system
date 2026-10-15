# 页面规格 · Agent 定义详情页（编辑改新页面 + 高级 · 模型参数调试）

- 状态：**待用户确认**（2026-10-10 二稿 → v2.1 表单/用例重排 → v2.2 调试台与 Playground 同构，未落码）
- 关联：`docs/ui/page-specs/agent-def-generation-params-v1.md`（弹窗版，**已被本稿取代**，保留作演进记录）
- 原型：`docs/ui/prototypes/admin-agent-def-detail.html`（桌面 Web / admin 亮色 1280 壳）
- 落地落点（预期）：新增 `apps/admin/src/views/Agents/AgentDefDetail.vue`（详情页）+ 改造 `AgentDefList.vue`（列表「编辑」改为路由跳转）+ `apps/admin/src/api/agent-defs.ts`（类型与调试/用例接口）
- 契约源：`docs/api/contracts.md` §7（C7-b 互斥、C7-c null 语义、C7-d 分类强制关思考、C7-e 不把 null 写成 0.7、C7-h 传了才覆盖）与 §7.4 档位
- 质检：设计评审（阻塞 7 → 已修）+ 独立交互质检（阻塞 13 → 已修）+ 无头验证全通过（`scripts/verify-agent-def-detail.mjs`，116 项）

## v2.2 修订（本次）：调试台对话与屏① Playground 同构

| # | 问题 | 处置 |
|---|---|---|
| 1 | 调试台自造了一套简化气泡（纯文本 + `<br>` 拼接），与 `admin-agents.html` 屏①「对话调试 Playground」的 blocks 渲染长得不一样 → 产品意见「对话面板略显粗糙，最好跟 playground 保持一致能够复用」 | 调试台消息结构**改为与屏① 完全同构**（见 §2.1）：同一套 DOM 与类名，落地时两侧复用同一组组件 |
| 2 | 屏① 自身存在不达标色档与越阶字号（橙底白字头像/气泡 2.8:1、`text-tertiary` 元信息 2.5:1、h4 13.5px、p.lead 14.5px） | 按 AA 与字阶**回填屏①**（详见 `admin-agents.html` 变更台账 2026-10-11），避免落地时两个入口引用两套样式 |
| 3 | 无头验证只覆盖了「有回答」，没覆盖「回答长什么样」 | 新增 ㉑ 段 11 项断言锁死同构（结构 / blocks / 过程卡片位置 / 来源标签 / 思考开关的可观察差异） |

### 2.1 消息组件契约（两处共用，落地必须复用同一组组件）

```
.turn                                  ← 一轮问答（用户轮只有 bubble-wrap.me）
├ .proc                                ← 过程卡片（可选）：工具调用/检索步骤，落在气泡**外侧**
│  ├ .ph  → 图标 + 「调用工具 · <code>工具名</code>」 + step 耗时
│  └ .pb  → 等宽 JSON 入参
└ .bubble-wrap(.me)
   ├ .avatar(.user/.ai)                ← 头像（用户轮在右、AI 轮在左）
   └ .bubble(.user/.ai)
      ├ .bubble-meta                   ← 元信息在气泡**内顶部**：.src-tag（基于工具/AI 直答）+ 助手名 + 生效参数 + 耗时
      └ .ans                           ← 回答体，一律 blocks：
         p / p.lead / h4 / ol>li>.n / strong / code（行内）
         .codeblk（深色代码块：.hd>.lang+.cp + pre，12.5px 为已登记字阶例外）
         .law（法条/引用/越界提示：左侧 3px 品牌橙 + soft 底）
         .think（思考开启时的推演说明行）
```

**复用口径**：

| 项 | 规则 |
|---|---|
| 组件划分 | `Turn`（一轮）/ `Bubble`（气泡 + meta）/ `AnswerBlocks`（blocks 渲染，解析复用 `@web-system/agent-message`）/ `ProcCard`（过程卡片） |
| 渲染口径 | 回答体**只出 blocks**，禁止 `<br>` 拼字符串；blocks 由 `parseAnswer` 解析后按块渲染 |
| 差异只允许在尺寸 | 屏① 整页 `.pg-chat`（不限高、间距 16/22）；调试台 `.pg-chat.compact`（限高内滚、间距 12/18）。结构、色档、字阶必须一致 |
| 可观察差异（调试台特有） | thinking=关闭 → 来源标签变「AI 直答」（灰档）且**不出现过程卡片**；thinking=开启 → 回答首行 `.think` 推演说明；温度 ≥0.8 → 边界回答追加 `.law` 越界提示 |
| AA 色档（两处一致） | 头像 `brand-700`/`ok-700`；用户气泡 `brand-soft` + 主文本（不用橙底白字）；元信息/过程卡正文 `text-secondary`；`src-tag` 文字 `ok-700`；`law b` 文字 `brand-700` |
| 字阶（两处一致） | h4 与 p.lead 均 14px；头像字 12px；代码块 12.5px（例外已登记） |

## v2.1 修订（表单重排 + 每定义自带真实用例）

| # | 问题 | 处置 |
|---|---|---|
| 1 | 表单「看起来好乱」：每字段 label + 控件 + hint 各占一行，hint 内容含实现细节（`ai-agent 侧 60s 轮询`、契约代号 `C7-b`） | 表单改 **label 左置栅格**（`.frow/.fitem/.flb/.fld/.fhint`）：控件左缘统一对齐、每字段压到 1~2 行；hint 统一 ≤22 字短句，实现细节与契约代号移出表单（进本规格 §3.2） |
| 2 | demo「不太好理解」：三个定义**共用同一套财报用例**；提问口吻像测试术语；对话区不知道该问什么 | ① 用例改为**每个定义自带本业务用例**（`DEFS[id].cases`）② 用例加 **`kind`**（`plain` / `long` / `boundary`）驱动差异判据 ③ 用例的「期望」改名**「验收」**并写成业务可判的句子 ④ 新增**「试试这些问题」**可点示例问题（`DEFS[id].tryQ`）⑤ 用例差异增加**差异摘要**行，不用人自己逐字比对 |

## 1. 信息架构变更（与 v1 弹窗版的差异）

| # | v1（弹窗版，已废弃） | v2（本稿） | 为什么改 |
|---|---|---|---|
| 1 | 列表点「编辑」开 `a-modal` | **列表点「编辑」进入独立详情页**，面包屑可回列表 | 产品意见：参数变多后弹窗放不下，且调试需要持续上下文 |
| 2 | 生成参数区直接铺在表单里 | 表单拆两张卡：**基础配置**（默认展开）/ **高级**（默认折叠） | 多数用户只改基础项，调参属低频高危操作，收进「高级」 |
| 3 | 只有参数表单 | 高级内是**模型参数调试**工作台：左参数面板 + 右调试台 | 改完能立刻验证，不用「保存→去 Playground→回来改」 |
| 4 | 无 | 调试台 Tab① **对话试跑**（含示例问题，直接提问看结果）/ Tab② **调参测试用例表**（多例批量验证） | 产品意见：要能直接对话、例子可以有多个 |
| 5 | 无对比 | **三级参数对比**（见 §4） | 产品意见：参数多，改了要给对比提示 |

> 全程**不使用弹窗**：保存确认、丢弃确认、还原确认、返回拦截一律用**内联展开的确认条**（`.cfm`），与产品「不用弹窗」意见一致。

## 2. 详情页结构

```
面包屑：Agents / 定义管理 / <id>        [返回列表] 标题+状态+版本  [放弃更改] [保存]
├ 未保存变更条（sticky）：N 项参数未保存 · [查看对比] [全部还原]   ← 内联展开 diff 表
├ 卡片一 · 基础配置（默认展开，label 左置栅格）
│    用途说明 / 路由关键词 + 模型 / 系统提示词
└ 卡片二 · 高级（默认折叠）
   └ 模型参数调试（可切换「并排 / 上下」排布）
      ├ 左：生成参数面板（采样方式、Temperature、Top P、输出上限、思考、思考预算、按场景套用预设）
      └ 右：调试台
         ├ Tab① 对话试跑：生效参数条 → 「试试这些问题」→ 对话区 → 输入框 [运行] [用线上参数对比运行]
         └ Tab② 调参测试用例表：[运行选中] [全选] [新增用例] → 判据说明 → 用例卡（输入 / 验收 / 基线 vs 当前 / 差异摘要）
```

## 3. 字段级改动（参数面板）

| # | 控件 | 口径 |
|---|---|---|
| 1 | 采样方式 | `a-radio-group` 二选一 Temperature / Top P；未选中侧 `disabled`（C7-b） |
| 2 | Temperature | 0–2；留空 = `null` = 沿用服务侧默认（C7-c） |
| 3 | Top P | 0–1；留空 = `null`；与 Temperature 互斥，切换即**清空另一侧** |
| 4 | 输出上限 maxTokens | 整数 1–32768；hint「回答长度上限，与思考预算共用额度」 |
| 5 | 思考 thinking | 三态：沿用默认 / 关闭（`{type:'disabled'}`）/ 开启并限预算（`{type:'enabled', budget_tokens}`）；选「开启」才出现**思考预算**行 |
| 6 | 按场景套用预设 | 六档（§7.4）：分类 / 抽取 / 代码 / 对话 / 创意 / **工具调用**；**先复位采样方式再写值**（避免写进禁用控件）；契约给区间或「按 X 自定」的一律**留空**，区间原文在提示中回显 |
| 7 | 分类档锁定 | 套用「分类」后 thinking 段 `locked`（`pointer-events:none` + handler 兜底），hint 说明「分类场景强制关闭思考（C7-d）」；换其它档即解锁 |

### 3.1 预设档位（出处 `contracts.md §7.4`，无据的不填）

| 场景 | temperature | maxTokens | thinking | 原型取值说明 |
|---|---|---|---|---|
| 分类 / 意图路由 | `0` | `256` | `disabled`（**锁死**） | 契约确定值，照填 |
| 结构化抽取 | `0.1` | 留空 | `disabled` | 上限「按字段量」→ 留空 |
| 代码生成 | `0.2` | `3000` | 沿用 | 契约「≥3000」取下限 |
| 通用对话 | `0.7` | 留空 | 沿用 | 上限 800~2000 为区间 → 留空 |
| 创意文案 | `0.9` | 留空 | 沿用 | 上限「放宽」→ 留空 |
| Agent 工具调用 | `0.3` | 留空 | 沿用 | 上限「按工具返回量」→ 留空 |

> 与 v1 的差异（评审抓出）：抽取档 thinking 由「沿用」更正为 **`disabled`**；补齐**工具调用**档。

### 3.2 表单排版规则（v2.1 新增，落地须遵守）

| 规则 | 内容 |
|---|---|
| 栅格 | `.frow`（一行一字段或两字段）内 `.fitem` = `.flb`（label，固定 84px）+ `.fld`（控件 + hint）；控件**左缘对齐** |
| 行距 | 字段间 `padding:12px 0` + `border-top:1px solid --ws-border-subtle` 分隔；末行去底距 |
| hint | 12px / `--ws-text-secondary`，**一行短句 ≤22 字**，写在控件下方 6px |
| hint 禁止项 | 实现细节（轮询周期、表名、环境变量名）、契约代号（C7-x）、内部字段名；这些只出现在本规格与代码注释 |
| diff badge | 出现在该字段 **hint 行右侧**（`.fhint.hintrow` + `.sp` 撑开），不在 label 后（label 仅 84px 放不下） |
| label 命名 | 用业务词不用字段名：`系统提示词`（非 `System Prompt`）、`输出上限`（非 `maxTokens`）、`思考`（非 `thinking`） |

## 4. 参数对比（三级，口径必须一致）

| 级别 | 形态 | 口径 |
|---|---|---|
| 字段级 | 改动字段 hint 行右侧 badge：`原值 → 新值` | 只统计**真正下发给模型**的参数（temp / topP / maxTokens / thinking / budget）；采样方式属 UI 态，**不计入** |
| 面板级 | sticky 未保存变更条 + 内联 diff 表（字段 / 线上值 / 草稿值） | 计数 = 上述字段变化数；点「查看对比」就地展开，不用弹窗 |
| 结果级 | 调试台「用线上参数对比运行」双列卡片；用例表「基线（线上参数） vs 当前（草稿参数）」双列 + **差异摘要行** | 差异行高亮；保存成功后**基线同步为当前输出** |

- 「与基线不同」与「运行失败」是**两种状态**：前者用 `--ws-danger-soft` + 文案「与基线不同」，后者加字重与「运行失败」文案，不做 pass/fail 二分（避免暗示用例本身不达标）。
- 调试台顶部 runbar 只表达「生效参数」，差异计数由变更条**唯一**表达（避免同屏两处橙框互相打架）。

### 4.1 调参用例集（v2.1 重做）

**用例归属**：每个定义自带一组用例（`DEFS[id].cases`），切定义即换用例；**不再三个定义共用一套**（这是「demo 不好懂」的根因）。真实实现是否落库见 §7-⑨。

**用例字段**

| 字段 | 含义 |
|---|---|
| `name` | 业务可读名（如「拒绝预测」「缺失字段不推断」），不用「意图命中 · 简短提问」这类测试术语 |
| `input` | **真实业务提问**（真实公司 / 真实条款场景 / 真实代码片段），不是占位符 |
| `exp` | **验收要点**：写成业务方能否判的句子（如「不预测未来数据；只给已披露数据与口径说明」） |
| `base` | 基线输出（线上参数的结果） |
| `cur` | 当前输出（草稿参数的结果），未运行为空 |
| `kind` | `plain` 普通 / `long` 长输出（截断敏感）/ `boundary` 边界（抗漂移） |
| `checked` | 是否默认勾选（末条边界用例默认不勾，避免每次全跑） |

**约定用例构成**（每个定义 4 条）：2 条 `plain`（业务主路径）+ 1 条 `long`（长输出，暴露 maxTokens 过小）+ 1 条 `boundary`（越界/拒答，暴露 temperature 过高）。

**差异判据（原型为演示数据，落地须接真实评测）**

| kind | 触发条件 | 差异摘要文案 |
|---|---|---|
| `long` | `maxTokens < 512` | 「输出被截断，末尾的口径说明缺失」 |
| `boundary` | `temperature ≥ 0.8` | 「未守住边界：基线拒绝/守界，草稿顺着答了」 |

三个定义自带的用例（演示数据，全部标注为演示，不构成投资/法务结论）：

| 定义 | plain | long | boundary |
|---|---|---|---|
| 财报解读助手 | 单指标速查（茅台营收+出处口径） | 跨期计算（复合增速+算式） | 拒绝预测 / 越界翻译 |
| 合同条款抽取 | 三项条款抽取（付款/账期/违约金+条款号） | 金额与税口径（含税标注） | 缺失字段不推断 / 逐字引用原文 |
| 代码评审助手 | 错误处理缺失（fetch 未 try/catch） | 类型逃逸（any 的具体风险+替代写法） | 跨语言改写（只评审不代做） |

**对话试跑**：同样按定义分派——「试试这些问题」给的是该定义的真实问题（如财报定义给「预测一下茅台 2025 年营收」，会随温度升高而失守），回答模板也按定义走，**思考开关**会额外产生一行推演说明（`.think`）。

## 5. 状态矩阵（落地须全部实现）

| 对象 | 状态 |
|---|---|
| 参数 | 未改动 / 已改动（badge + 变更条）/ 禁用（互斥侧、锁定态）/ 保存中（按钮 disabled）/ 保存成功 / 保存失败（错误文案含原因 + 怎么办，来自后端） |
| 对话试跑 | 空闲 / 运行中（打字指示）/ 成功（含生效参数与耗时）/ 失败（红边气泡 + 重试入口） |
| 用例 | 未运行 / 运行中（按钮锁定防连点）/ 通过 / 与基线不同（含差异摘要）/ 运行失败 / **无基线**（`base` 为空时不判通过，提示先填基线）/ 新增空态 |
| 页面 | 只读态（系统内置定义 `__intent__`，**待确认是否可编辑**）/ 未保存离开拦截 |

## 6. Token（禁裸值）

`--ws-brand-700`（AA 深档：链接、主按钮底、badge 文字）、`--ws-ok-700`（成功文字）、`--ws-danger-soft`（差异与失败底）、
`--ws-bg-active` + `inset 1px --ws-border`（分段控件选中态，不用白字压品牌橙——仅 2.8:1 不过 AA）、
`--ws-text-secondary`（说明文字；`--ws-text-tertiary` 压白仅 2.5:1，不承载说明）、`--ws-bg-subtle`、`--ws-border-subtle`、`--ws-radius-sm/md/lg`、`--ws-control-sm/md`。

**待入 `packages/ui/src/tokens.ts` + `tokens.css`（落地前必须补齐，否则会出现裸值）**：
`--ws-brand-700`、`--ws-ok-700`、`--ws-danger-soft`、`--ws-shadow-shell`、`--ws-accent-soft-2`
（沿用自 `admin-agents.html` 的遗留项：`--ws-overlay`、`--ws-shadow-float`）。

## 7. 待拍板（未定义项，不得静默脑补）

1. 「高级」默认折叠还是展开（稿内默认折叠）。
2. 调试台默认并排还是上下（稿内默认并排，右上角可切）。
3. 用例结果是否支持「设为新基线」（稿内保存**不**自动同步基线）。
4. 保存前是否强制跑一遍用例。
5. 系统内置定义 `__intent__` 是否可编辑（稿内按只读标注）。
6. 新增用例的行内编辑与删除（原型未实现，已 toast 显式标注）。
7. 「验收要点」用什么判据自动比对（原型为人工看双列 + 差异摘要，未做自动断言）。
8. 运行中是否冻结参数面板（稿内可边跑边改，结果归属可能含糊）。
9. **用例的来源与归属**：稿内按「每个定义自带一组本业务用例」展示（未落库）。真实实现是用例存 DB 跟定义绑定，还是先共用平台用例池？
10. **思考预算默认值**：契约 §7.4 未给「开启思考」时的预算默认值，稿内不预填（留空由服务端兜底）。

## 8. 回归命令

```bash
node scripts/verify-agent-def-detail.mjs     # 交互断言 118 项：无弹窗 / 按 id 载入 / 基础字段入 diff / 互斥与锁定 /
                                           # 失败态与重试 / 用例表判据与无基线态 / 保存校验与二次确认 / 可达性 /
                                           # 表单栅格与 hint 规则 / 每定义自带用例 / 示例问题短标签 /
                                           # ㉑ 与屏① Playground 同构（bubble-wrap/meta/ans blocks/proc 位置/src-tag）
node scripts/build-agents-hub.mjs            # 生成菜单级整合稿 docs/ui/prototypes/admin-agents-hub.html（见 §10）
node scripts/sync-prototype-shell.mjs        # 把单源壳（sider 菜单/顶栏/折叠 + 壳 CSS/JS）注入两份定稿（见 §10.3）
node scripts/verify-agents-hub.mjs           # 整合稿断言 147 项：17 项菜单逐项可达（仅本屏可见 + crumb 含菜单名 +
                                           # active 唯一 + URL 同步）/ 无 .nolink 死项 / 屏数=菜单+1 / 15 个占位屏
                                           # 范围说明 / 组件地图四件套 / 稿内编辑闭环 / 调试台可跑 /
                                           # ⑧ 菜单与 BasicLayout.vue 逐项对账 + 路由末段在 router/index.ts 存在 /
                                           # ⑨ 壳结构（antd Sider+SubMenu、折叠 80/220、选中渐变+竖条）
node scripts/verify-proto-shell.mjs          # 壳单源三稿对拍 39 项：三份稿（两定稿+整合稿）菜单文案序列 / logo /
                                           # sider 宽 / 折叠交互 / 选中项 class 与 computed 样式逐项一致
node scripts/verify-playground-parity.mjs    # 结构 parity 31 项：A–D 消息结构 + E/F 同源 + G 稿内对拍 +
                                           # H 对话面板外围（含运行按钮 computed）+ T1 :root token 对账（见 §9）
                                           # E/F 整合稿与两份定稿同源（禁手改漂移）；G 整合稿内 Playground ⇄ 调试台
```

> ⚠️ 脚本内㉑段前置依赖：⑫ 段保存过「分类」预设后 `DEFS` 已被写回（原型**正确模拟落库**），
> 重开定义时载入的是已保存参数（thinking=关闭），需先点「沿用默认」才能看到工具调用链路——
> 这是测试对持久化的适配，不是原型缺陷。

## 9. 与屏① Playground 的同构口径（2026-10-11 v2.3 补齐）

产品问「对话界面是不是跟 Playground 一致、能不能复用」——肉眼截图回答不了，`scripts/verify-playground-parity.mjs`
把两边**实际渲染出的消息 DOM** 抽成结构树逐层 diff，给机器结论。共用结构：

```
.turn = 一问一答组（.turn 语义两边一致，落地复用同一个 Turn 组件）
  |-- .bubble-wrap.me   > .bubble.user + .avatar.user        用户提问
  |-- .proc             > .ph(工具名+step) + .pb(入参 JSON)   过程卡片（落 AI 气泡外侧、之前）
  +-- .bubble-wrap      > .avatar.ai + .bubble.ai
                          |-- .bubble-meta > .src-tag(基于工具/AI 直答) + 助手名 + 生效参数 + 耗时
                          +-- .ans > blocks（p / p.lead / h4 / ol>li>.n / .codeblk / .law / .think）
```

| 段 | 比什么 | 判定 |
|---|---|---|
| A | 整轮骨架（.ans 视为叶子：回答内容因问题而异） | 必须零差异 |
| B | 各 block 内部结构（proc / codeblk / law / ol / h4 / pre / bubble-meta / lead / think） | 必须零差异；仅一侧有的块须登记理由 |
| C | CSS 规则块（只对账消息结构选择器；声明先归一化去空白） | 差异须**逐条登记**（尺寸修饰 / 组织方式 / 运行态特有） |
| D | 结构类并集差 | 差异须登记 |

已登记差异（有意为之，不是漂移）：

| 差异 | 理由 |
|---|---|
| `.pg-chat` / `.turn` / `.ans` 间距（20/22/16px vs 16/18/12px） | 同一组件、尺寸修饰不同：Playground 整页，调试台并排限高（`.pg-chat.compact`） |
| `.cursor` 仅 Playground 有 | Playground 演示流式光标；调试台运行完即完整呈现 |
| `.think` / `.typing` / `.bubble.err` 仅调试台有 | 调参场景特有：思考开关状态提示、运行中等待态、失败态（Playground 是静态演示） |
| transition 合并写法不同 | Playground 把 `.proc .ph/.hd .cp` 与侧栏项合并成一条，调试台拆开 —— 等效 |

### 9.1 v2.4：对话面板扩为「三段复用单元」（2026-10-11）

产品反馈：「Playground 对话区域和参数调测的对话那里不一样，**只有聊天记录勉强一样，运行按钮不一致**」。
根因：v2.3 的 parity 只比了**聊天轮子树**——对话区外围（工具栏、输入区、运行按钮）从没进过对拍，
所以「聊天记录勉强一样、别的不一样」。

**结构统一为 `.chatpanel` 三段**（两稿 DOM 逐节点一致）：

```
.chatpanel
  |-- .pg-toolbar  > .pg-agent(图标+名称+caret) + .pg-spacer + .pg-run(运行状态) + .pg-dbg(Debugger)
  |-- .pg-chat[.compact]   消息区（Turn / Bubble / AnswerBlocks / ProcCard）
  +-- .composer    > .ctrl > textarea + .btn.run(运行) [+ 可选槽：用线上参数对比运行]
```

| 段 | 比什么 | 判定 |
|---|---|---|
| H | 对话面板外围（toolbar + composer 结构树、运行按钮类名/文案/**computed 样式**） | 必须一致；仅槽位差异可登记 |
| T | 两稿 `:root` token 集合与值 | 必须一致（防 `var()` 静默回退） |

已登记差异（H 段）：

| 差异 | 理由 |
|---|---|
| 调试台 Agent 胶囊的 caret 带 `.hidden` | 调试台不可切换 Agent（对象即当前定义），caret 由 props 关闭：DOM 保留、仅隐藏 |
| 调试台多「用线上参数对比运行」 | 调参场景专属槽位（Playground 本身跑线上参数，无需对比） |

**踩到的真差异（H3b 抓到）**：Playground 的运行按钮文字色被采成 `--ws-text-primary`——
因为 PG 的 `:root` **缺 `--ws-brand-700` 等 7 个 token**，`.btn.run` 的 `color:var(--ws-brand-700)`
静默回退到 `.btn` 的默认色。声明文本一模一样、CSS 对账全绿，只有 computed 能抓到。
已补齐两稿 token（各 58 个、值零差异），并新增 T1 段守这类「声明一致但变量缺失」。

> 落地拆分：**Turn / Bubble / AnswerBlocks / ProcCard 四个组件** + **ConversationPanel（chatpanel 三段壳）**；
> 差异只通过 props（尺寸档 compact / 可切换 Agent / 运行状态）与 slots（loading / err / 对比运行槽）表达，
> 不复制第二套结构。

## 10. 菜单级整合稿 `admin-agents-hub.html`（2026-10-11 v2）

产品意见：「原型稿菜单里的页面还没整合进来；帮我设计复用，实现时也好复用；确认复用的组件模块是否一样」。

**生成物，不是手抄件**：`node scripts/build-agents-hub.mjs` 从两份定稿**同源抽取**拼接——

| 来源 | 抽进整合稿的内容 |
|---|---|
| `admin-agents.html` 屏① | 对话调试 Playground（pg-toolbar + pg-chat 两个示例轮，DOM 原样） |
| `admin-agent-def-detail.html` 屏① / 屏② | 定义管理列表 / 定义详情 · 高级 · 模型参数调试台（DOM 与 script 原样） |

对新稿 script 仅三处机械改写（文件内两 section 显隐 → hub 多屏）：`openDef()` / `goList()` 调
`showHub(name, id)`；`crumb-main` 绑定删除（crumb 由 showHub 统一渲染，返回入口用详情屏内「返回列表」）。

整合稿构成：

- **菜单全量可达**：v2 起 Agents 组 6 项可切，v4 起**全菜单对齐真实 admin 并去掉死项**（见 §10.2）；
  定义详情无菜单项，经列表「编辑」进入（与定稿一致）。
- **占位屏**：每屏带「范围说明 + 骨架 + 复用件标注」——消息渲染一律标注复用 Turn / Bubble /
  AnswerBlocks / ProcCard，不各造一套；非 Agents 模块**不伪造业务数据**（只登记位置 / 路由 / 复用口径，见 §10.2）。
- **组件复用地图**（页面底部）：四件套各自的使用点（Playground 静态示例 / 调试台动态渲染）+ 表单侧复用件
  （frow 栅格 / diff badge / 变更条 / chip 摘要 / seg / 用例双列）+ 复用门禁命令。

机检口径（`verify-playground-parity.mjs` 新增段）：

| 段 | 比什么 | 判定 |
|---|---|---|
| E1/E2 | 整合稿 Playground 屏 vs `admin-agents.html` 定稿（两轮） | **零差异**（同源抽取，禁手改漂移） |
| F1 | 整合稿详情屏初始渲染（欢迎语轮）vs 定稿 | 零差异 |
| G1 | 整合稿内 Playground 屏 ⇄ 整合稿调试台（动态渲染） | 零差异（稿内复用的直接证据） |

### 10.1 v2 修订（2026-10-11）：框架页面化 + 样式修复

产品意见：「不是这种导航入口，而是 admin 的框架页面，点击后已进入到对应模块页面的那种；目前的样式完全是乱的」。

**样式乱的根因（两条，均为构建脚本缺陷，已修 + 加生成自检）**：

1. **token 全丢**：`between()` 切片含 `<style>` 开标签，字面 `<style>` 混进 CSS 流后被解析器
   连到 `:root` 选择器上，**整条 token 规则被丢弃** → `--ws-*` 全空、全站 `var()` 失效
   （主按钮背景透明、控件高度失控）。已剥离开标签；build 末尾加自检：
   `<style>` 开标签必须恰 1 个、token 定义 ≥ 50、div 配平、`.pg-agent svg` 尺寸规则必须在。
2. **Playground 专属 CSS 整个没合入**：v1 只抽了新稿 CSS，admin-agents.html 的 `.pg-toolbar /
   .pg-agent / .pg-run / .pg-dbg` 等 20 个专属块缺失 → 无尺寸约束的 SVG 撑成 1026px 方块、
   整屏布局顶翻。v2 按**规则块粒度**合并：同名选择器以新稿（AA 修正版）为准（46 个同名块
   dt 优先），仅合入新稿没有的 20 个 pg 专属块；`:root` 变量取并集（补 3 个 pg 独有 token）。

**框架页面化（hash 路由）**：点击菜单 = 进入对应模块页面，不再是页内 tab——

- 路由表：`#/overview` / `#/playground` / `#/observe` / `#/records` / `#/agents` / `#/skills` /
  `#/agents/<id>`（定义详情）；菜单点击写 `location.hash`，`hashchange` 驱动 `showHub`，
  浏览器前进后退可用；初始读 URL（默认 `#/agents`）。
- 每屏页头 `.page-head`（标题 + 一句描述 + 右侧操作）：占位屏 4 屏与 Playground 屏由 hub 渲染
  （放在 screen 容器**外/前**，不动定稿 DOM → E/F 同源判定不受影响）；定义管理屏的 toolbar、
  定义详情屏的 dt-head 本身即页头，不重复加。
- 切屏带 0.18s 淡入；crumb 与菜单 active 由路由统一驱动。
- script 改写从「调 showHub」升级为「写 location.hash」（openDef → `#/agents/<id>`，goList → `#/agents`）。

纪律：**整合稿是生成物，禁止手改**；要改内容改两份定稿后重跑 `build-agents-hub.mjs` 再跑三条验证
（118 + 120 + 31）。本地体验入口见 `docs/api/contracts.md` §11（`pnpm proto` → 127.0.0.1:5180）。

### 10.2 v4 修订（2026-10-11）：菜单全量对齐真实 admin

产品意见：「红框标注的菜单，还没合入」。

问题：v2/v3 的左侧菜单是**手写的 11 项**——工作台 / 用户管理 / 系统设置 / MCP 管理 是 `.nolink` 死项（点不动），
且缺 变变管理 / 角色权限 / 字典管理 / 数据浏览；Agents 子菜单命名也与落地不一致（概览 / 观测 / 对话记录 / Playground）。

修法：**菜单不再手写，从真实 admin 派生 + 机检对账**。

| 项 | 口径 |
|---|---|
| 菜单源 | `apps/admin/src/layouts/BasicLayout.vue`（文案 / 顺序逐项对齐） |
| 路由 | 与 `apps/admin/src/router/index.ts` 的真实 path 同构（`#/settings/roles`、`#/agents/definitions`、`#/agents/runs`…） |
| 无死项 | 去掉全部 `.nolink`；**17 项菜单 ↔ 18 个屏**（detail 无菜单项） |
| 非 Agents 模块页 | **骨架式占位**：只登记「归属批次（`specs/admin-prototype-coverage/tasks.md` P1~P5）+ 复用口径」，**不伪造业务数据**；系统设置指向已有定稿 `admin-settings.html` |
| Agents 组内占位页 | 保留示意数据（KPI / `.tbl`），口径与 Agents 模块一致 |
| 已知增量 1 项 | 「Agent 概览」—— router 的 `/agents` index 页（`AgentOverview.vue`），BasicLayout 未挂菜单项，本稿作为模块首页入口保留（对账段显式登记理由） |

菜单（17 项，与真实 admin 逐项对齐）：

```
工作台 · 变变管理 · 用户管理 · 系统设置 · 角色权限 · 字典管理 · MCP 管理 · 数据浏览
Agents：Agent 概览* / Agent 观测 / 运行记录 / 能力资产 / 知识集合 / 检索调试 / 定义管理 / 技能库 / 对话调试
（* = 已知增量：router /agents index 页，BasicLayout 未挂菜单项）
```

机检（`verify-agents-hub.mjs` 51 → **120 项**）：

| 段 | 比什么 | 判定 |
|---|---|---|
| ② | 17 项菜单**逐项**点击 → 仅本屏可见（computed 真实可见性）+ crumb 含菜单名 + active 唯一 + URL 同步 | 全过 |
| ③ | 无 `.nolink` 死项、屏数 = 菜单数 + 1、路由唯一 | 全过 |
| ⑤ | 15 个占位屏都必须带「范围说明」 | 全过（不许无出处的空屏） |
| ⑧ | **菜单文案与顺序 = BasicLayout.vue**（读 .vue 源）+ 路由末段在 router/index.ts 存在 + 无漏项 | 零差异 |

⑧ 段经**变异测试**验证有效：把「运行记录」改成「运行日志」→ 8b / 8c / 8e 立刻 FAIL；恢复后 120/120。
另：`verify-playground-parity.mjs` 因 hub 起始屏从 list 改为 overview（`#/agents`）需先切屏再点「编辑」，已适配，31/31 仍绿。

> 教训（写进纪律）：**原型菜单不能手写**——必须从真实 admin 派生并机检对账，
> 否则「菜单还没合入」这类问题会反复发生（手写菜单 = 第二真相源）。

### 10.3 壳单源化（2026-10-11 v5：菜单结构对齐真实 admin）

产品意见「菜单的**结构**最好跟 admin 的样式保持一致」——不只是文案对齐，结构也要是真实 admin 的
antd 布局（Sider + SubMenu + 顶栏 + 页脚），而不是「分组小标题 + 平铺项」。且三份稿此前各写一套壳，
必漂移 → 收口单一真相源：

| 层 | 内容 |
|---|---|
| 单源 | `scripts/lib/proto-shell.mjs`：SHELL_TOP（8 个一级项，图标+文案）/ SHELL_SUB（Agents 子菜单 9 项）/ shellSider / shellHeaderLeft·Right / shellFooter / shellCss / shellJs。对齐对象逐项来自 `BasicLayout.vue`（sider 220 / 收起 80 / 头部 56 / 菜单项高 40 / 图标 16 / 选中=橙渐变+右侧 3px 竖条 / 子菜单选中父标题高亮 / hover=橙 6%），色值全走 token |
| 整合稿 | `build-agents-hub.mjs` 内联（interactive=true，菜单带 data-route 由 hash 路由驱动） |
| 两份定稿 | `sync-prototype-shell.mjs` 注入（interactive=false 静态菜单；**保留定稿原面包屑** `#crumb-main/#crumb-sub`，定稿 JS 依赖）；壳 CSS 作为**第二个 `<style>`** 注入（`build` 的 `between('<style>','</style>')` 仍只取主块 → 整合稿不会双份壳 CSS） |
| 机检 | `verify-proto-shell.mjs` **39 项**：三稿 sider 宽 / logo=科豆 AI / 菜单 17 项文案序列 / Agents 子菜单 / 折叠 80⇄220 / 子菜单收起展开 / **选中项 class 与 computed 样式（渐变底+3px 竖条+父标题高亮）** / 三稿跨稿一致 |

坑与教训：

- **`active` 拼成裸属性**：`menuItem` 曾把选中态写成 `<div … data-screen="pg" active>`（裸属性
  不是 class）——整合稿靠 `showHub()` 运行时补 class 看不出来，两份定稿没有这段 JS 就**全部丢选中态**。
  机检补「选中项必须落在 class 且 computed 样式生效」后立刻抓到。教训同 §9「声明一致≠生效」：
  静态稿没有运行时兜底，注入的 DOM 必须自带完整 class。
- 折叠态 CSS 顺序敏感：`.ad-sider.collapsed .ad-sub .ad-sub-bd{display:none}` 必须排在
  `.ad-sub.open .ad-sub-bd{display:block}` **之后**（同特异性靠后序胜出），否则折叠后子项漏出。
- 画布高度（`.ad-desktop{height}`）不进壳：壳只管 sider/顶栏/页脚，各稿画布自定（定稿 900/800、整合稿 960）。
- 四线全绿：壳对拍 39 + 整合稿 147 + 定稿 118 + parity 31；壳对拍经变异测试（改菜单文案 / 删 active
  class 均立刻 FAIL）。

### 10.4 每屏内容单源（2026-10-12 v6：出稿即合入，不再手工整合）

产品意见：「把菜单占位的原型稿也整合进来吧，后续就不用整合了，迭代也会更精准」。

问题：v5 只收口了「壳」（`proto-shell.mjs`），**每屏内容仍散落在 build 脚本里手写的 `SCREEN_META`**——
某模块出了新稿就得改 build 脚本 + 手抄 DOM/CSS/JS，「整合」变成一个要重复做的手工动作。

修法：**每屏内容也收口成一份注册表**。

| 层 | 文件 | 职责 |
|---|---|---|
| 抽取原语 | `scripts/lib/html-utils.mjs` | `between` / `stripWrapper` / `stripCssComments` / `cssBlocks` / `selOf` / `scopeCssBlocks` / `takeTopLevelElements` |
| **单源** | `scripts/lib/proto-registry.mjs` | 每屏一行：`{ screen, label, batch, source:{file, from, to, wrapper, trail, cssDrop/cssKeep, scope, ns, exports, iife, trace} }`，或占位屏的 `note/kpi/tbl/skel/reuse`。导出 `REGISTRY / BY_SCREEN / BATCHES / loadSource()` |
| 生成 | `scripts/build-agents-hub.mjs` | 删掉手写 `SCREEN_META`；消费注册表 → `SOURCE_CSS` / `SOURCE_JS` / `REAL_BODY`；`SOURCE_SCREENS` 里的屏**不再叠 `.page-head`**（源稿自带页头） |

源稿合入的三件事（注册表字段表达，无需改代码）：

1. **DOM 剥壳**：`from/to` 取内容区，`wrapper` 脱一层外壳，`trail` 再取源稿挂在壳上的**尾挂弹层**
   （字典抽屉的 mask + drawer 在 `</div></div>` 之后 → 用 `takeTopLevelElements` 摘顶层元素，防截断）。
2. **CSS 隔离**：`cssDrop`（丢掉源稿的 body/sidebar/topbar 等壳样式）或 `cssKeep`（只留 `.st-` 前缀块）；
   裸通用类名的稿（dict）加 `scope: '.screen[data-screen="dicts"]'` → `scopeCssBlocks` 给每条规则加前缀。
   ⚠️ **`:root` 不能 drop**：dict 的 `--primary/--card/--radius` 全在 `:root`，丢掉按钮会静默回退成默认色
   （同 §9「声明一致≠生效」）→ `scopeCssBlocks` 把 `:root` 改写成作用域选择器，私有变量留在自己屏内。
3. **JS 不泄漏**：源稿 script 包 IIFE，DOM 上的 inline handler（`onclick="asTab('basic')"`）需要顶层函数
   → 按 `exports` 挂到 `window[ns]`（`AS` / `DM`）并改写调用点为 `ns.fn(...)`。

本次真实合入两屏（原为占位）：

| 屏 | 源稿 | 命名空间 | 交互（机检实跑） |
|---|---|---|---|
| 系统设置 | `admin-settings.html` | `AS`（类名自带 `.st-` 前缀 → 直接合入） | 4 个 tab 切换（含「安全」） |
| 字典管理 | `dict-module.html` | `DM`（裸通用类名 → 作用域隔离，id 加 `dm-` 前缀） | 字典项 ≥3；`DM.openItemDrawer` 开抽屉（`.show` + computed transform 非 none）；点 `.x` / 遮罩关闭 |

机检（`verify-agents-hub.mjs` 147 → **165 项**），新增 ⑩ 段：

| 段 | 比什么 | 判定 |
|---|---|---|
| 10a | 注册表屏集合 == 菜单屏集合（无孤儿 / 无遗漏） | 全等 |
| 10b | 每条 `source.trace` 片段必在生成稿内 + 有稿屏**不含** `.ph-note/.ph-skel`（登记=合入） | 全过 |
| 10c | 源稿 CSS 切片逐条带作用域前缀；`--primary` 落在作用域而非全局 `:root`；运行时 `dicts` 屏 `.btn` padding ≠ `pg` 屏（**computed** 证明隔离不泄漏） | 全过 |
| 10d | 切到 dicts / settings 屏实跑交互（抽屉开合 / tab 切换）+ 无 JS 报错 | 全过 |
| 10e | 占位屏批次与 `specs/admin-prototype-coverage/tasks.md` 逐项一致 | 全过 |
| 10f | 页头写明整合机制（注册表 + 重跑 build） | 全过 |

⑩ 段经三次**变异测试**验证有效：改 `trace` → 10b FAIL；删 dict 的 `scope` → 10c FAIL；删注册表
`dashboard` 行 → 10a FAIL（且 build 直接抛错）。

> 纪律（写进 §4 维护约定）：**以后某模块出稿 / 改稿 = 改注册表一行 + 重跑 build**，
> 不要再往 hub HTML 里贴内容（它是生成物，下次 build 会被覆盖），也不要再改 build 脚本。
> 四线全绿：壳对拍 39 + 整合稿 165 + 定稿 118 + parity 31。

---

## 11. T11 技术架构决策清单（Agent 开发 · 承重 / 可换 / 易变分层）

> 来源：从「业务视角 LLM 四透镜」与「Agent 技术决策分层」归纳。架构师核心判断 = 把**承重层做稳、可换层做松、易变层做便宜**；模型层动得越快越要分层。每个节点的 价值 / 技术原理 / 技术实现方案 逐节点拆解见 `docs/architecture/agent-dev-t11-mindmap.md`。

### 11.1 承重层（改一次伤筋动骨 · 优先锁死）

| 决策 | 要点 | 你项目信号 / 现状 |
|---|---|---|
| 架构范式 | 单 Agent 闭环 vs 多 Agent 编排；自主循环(ReAct) vs 确定性图 | agent-core 已为契约面；多 Agent 编排未铺开 |
| 控制流所有权 | 模型驱动 vs 代码驱动（定了引擎形态就定） | `agent-engine.ts` 驱动、`RunInput.model` 单次覆盖 |
| 状态与记忆边界 | context 压缩/摘要、long-term 存哪、checkpoint | `agent_definitions.memory` 字段在，策略未体系化 |
| 安全边界 | 爆炸半径（能碰什么）+ 认知安全（grounding/抗幻觉） | `InternalGuard`/权限码在；Agent 自主调用权限收敛待明确 |
| **质量与评测（成功标准设计 + grounding 护栏）** ⭐新增 | 定义"完成/准确"即定义优化目标；grounding 是认知安全边界 | `agent_runs` 仅 `cost`，缺 `outcome`；eval 集未建（落地方案见 mindmap §1.5 / §2.4） |

### 11.2 可换层（设计为可插拔）

模型解耦层（三级回落：DB 字典 → env → 代码；ai-agent 已做 / ai-service 硬编码待改）· 工具契约（schema 版本化，模型直接消费）· KB 与检索（RAG，质量短期主因）· 评测体系（离线 golden + 线上完成率监控）。

### 11.3 易变层（低成本快速迭代 · 必须配置化）

提示词 / 模型选型 / 调参（temperature / maxTokens / topP / thinking）—— 放进配置而非写死代码（现状：`agent_definitions` 仅暴露 `model/temperature/maxSteps/streaming/memory`，另三个旋钮透传断在 `agent-engine.ts`）。

### 11.4 业务透镜（翻译为业务决策）

成本（定价/毛利）· 风险（敢承诺什么）· 杠杆（议价权/抗断供）· 度量（有没有变好）。详见 `docs/architecture/agent-dev-t11-mindmap.md`。
