# Design 评审报告 · 调参区布局单列化（A）+ maxTokens 占位统一（B1）

- 评审日期：2026-10-29
- 触发：用户实测 dev 截图指出三处（其中两处真缺陷），拍板 A + B1
- 分支：`feat/agent-tuning-layout-single-col`（基线 `origin/master` `38e71d0a`）
- 评审对象：`AgentTuningPanel.vue` / 新组件 `AgentStrategyPreview.vue` / `AgentDefDetail.vue` / 原型 + hub / 机检 / page-spec
- **形态判定：`Design: pass` —— 布局返工（栅格结构与文案口径），无新增交互/无新增控件**

---

## 一、双重栅格实测数字（根因）

team-lead 在 1280 视口实测 dev（app 侧，改前）：

```
外层 a-col span=12        → 调参面板容器 505px
  └ AgentTuningPanel 内部又 a-row 12/12 → 内层两列各 253px
        └ 输入框实际宽度 235px
右侧 a-col span=12        → .debug-slot 489px
策略预览 .b3-strategy     → 被困在左半 489px 内
```

原型（`admin-agent-def-detail.html`）设计是 `.params{flex:0 0 420px}` + 内部控件**单列**
（`.frow{display:flex}` 每个 `.frow` 只含一个 `.fitem`，实测 fitem left 全部相同）。
实现却在半宽容器里再劈两列 → **双重挤压**，与原型不符。

### 原型侧改前/改后实测（同一把尺子：`/tmp/measure-adv.mjs`，1280 视口）

| 项 | 改前 | 改后 |
|---|---|---|
| `.params` 宽 | 420 | 420（固定列，符合原型设计） |
| `.bench` 宽 | 544 | 544 |
| **`.strat`（策略预览）宽** | **403（困在参数列内）** | **980（整宽）** |
| `.strat` 高 | 245 | 170（内部改左右分栏更紧凑） |
| `#in-temp` 宽 | 217.4 | 217.4 |
| `#in-max` 宽 | 171.7 | 171.7 |
| `#in-temp` placeholder | **（空！）** | 未配置 |
| `#in-max` placeholder | 空 = 模型上限（8192） | 未配置 |
| `#in-topP` placeholder | 未配置 | 未配置 |
| `#extra-max` 文案 | 带工具留空 = 模型上限，不人为压小 | 留空 = 模型上限（8192），不人为压小 |

> 原型顺带发现并修掉一个漏网缺陷：`#in-temp` **根本没有 placeholder**（属性缺失），
> 三个数值控件两种写法变成两种缺失——已补 `placeholder="未配置"`。
>
> ⚠️ 口径说明：原型 `.params` 是 `flex:0 0 420px` 固定列（含 padding-right 16 → 内容 404px），
> 输入框实测 217px——**「输入框 ≥420px」这条在原型 harness 上不可达**（原型本来就没有
> 235px 挤压问题）。故 A-1 防回潮拆成两条实现（见 §四），分别钉「app 结构」与「原型整宽」。

### app 侧说明

改后 app 的预期宽度：外层 a-col span=12（505px）内单列，输入框 ≈470–505px。
本环境无 dev 服务可登录实测（登录依赖后端），app 侧结构性保证见 §四 25a；
dev 部署后可用 `/tmp/measure-adv.mjs` 思路复测，数字待部署后回填。

## 二、A：改了什么

### A1 `AgentTuningPanel.vue` —— 去双重栅格

删内部 `<a-row :gutter="16"><a-col :span="12">×2`，5 控件单列顺序堆叠：
Temperature → 输出上限 maxTokens → Top P → thinking → [budget 只读预览] → max_steps → [误配 alert]。
与原型 `.params` 单列一致。

### A2 抽出 `AgentStrategyPreview.vue`（新组件）

- props：`hasTools: boolean` / `thinking: ThinkingFormValue` / `maxTokens: number | null`
- `.b3-strategy` 整块（含 `buildStrategyPreview` 调用 + chain/out 样式）整体搬出
- 面板内保留一个窄化的 `preview` computed（联动③ budget 只读预览仍需要它），
  注释已写明「策略链/三值输出已抽至 AgentStrategyPreview」
- 内部布局：`grid-template-columns:repeat(auto-fit,minmax(280px,1fr))` 左链右三值，
  窄时自动堆叠——与原型新增的 `.strat-cols` **同一口径**

### A3 `AgentDefDetail.vue` 高级卡结构

```
<a-row :gutter="16">
  <a-col :span="12"> AgentTuningPanel（单列） </a-col>
  <a-col :span="12"> debug-slot（瘦身后） </a-col>
</a-row>
<AgentStrategyPreview :has-tools :thinking :max-tokens="form.maxTokens ?? null" />  ← 整宽
<TuningAuditList ... />
```

thinking / maxTokens 与面板同源（`thinkingForm` / `form.maxTokens`）。

### A4 debug-slot 瘦身

删 `.debug-slot-note`（「落地契约（page-spec v2 §2.1）：Turn / Bubble / AnswerBlocks…」
是写给开发看的文档，不该出现在产品页面——契约内容本就归 page-spec 本稿），
连同 `.debug-slot-note` / `.debug-slot-note code` 样式一起删。
保留标题「调试台」+ `a-empty` + 虚线边框（唯一占位信号）。

## 三、B1：占位统一「未配置」

改前三个同组数值控件两种写法（实测）：
Temperature=`未配置`、Top P=`未配置`、**maxTokens=`空 = 模型上限（8192）`**；
且占位与下方 extra 重复表达同一件事。

- **B1-1** `maxTokensPlaceholder(hasTools)` **删除**（唯一用途就是切占位）；
  组件改静态 `placeholder="未配置"`；spec 里 2 条对应用例改为 1 条防回潮断言
  （`'maxTokensPlaceholder' in mod === false`，有人加回来就红）
- **B1-2** 上限语义只留 extra，且**常量插值**：
  - 带工具：`` `留空 = 模型上限（${MODEL_MAX_TOKENS}），不人为压小` ``
  - 非工具：`留空 = 系统默认`
  - **为什么必须插值**：`MODEL_MAX_TOKENS`（`tuning-params.ts:15`，8192）是 W5 待运维核定的
    **唯一真源**，`budgetFormula` 已经在用。若模板硬编码 8192，运维把真值改掉后
    extra 文案与预算公式会**各说各话**（公式显示新值、文案还是 8192），且不会有任何报错。
    插值后改一处常量，公式与文案同步走。

## 四、机检（新增 25a–25d，141→145）

| # | 断言 | 手段 | 防什么 |
|---|---|---|---|
| 25a | `AgentTuningPanel.vue` 内 `<a-col>` 计数 = 0 | **静态读 app 源码** | 嵌套 12/12 回潮（本次根因） |
| 25b | `.strat` 宽 ≥ `#adv-body` 宽 × 90% | puppeteer 实测 | 策略预览再被困进参数列 |
| 25c | `#in-temp` / `#in-max` / `#in-topP` placeholder 均为「未配置」 | puppeteer 实测 | 占位口径回潮 |
| 25d | `AgentDefDetail.vue` 不含「落地契约」/「AnswerBlocks」/「debug-slot-note」 | **静态读 app 源码** | 技术文案泄漏回潮 |

**为什么 25a/25d 用静态读源码而不是 puppeteer**：本机检加载的是**原型 HTML**，
原型里不存在 `.b3-tuning`（那是 app 类名）；「面板不嵌套两列」「debug-slot 无技术文字」
是 **app 侧**约束，只能从源码断言。25b/25c 两个是原型本身也有的口径，用运行时实测。
机检路径从 `import.meta.url` 推导仓库根，worktree 通用、不写死绝对路径。

**为什么 A-1 拆成 25a + 25b 而不是「输入框 ≥420px」一条**：
原型 `.params` 固定 420px（内容 404），输入框实测 217px——420px 阈值在原型上永远不达标；
而「改回嵌套」的真正受害者是 app。静态 25a 直接钉死 app 结构（嵌套即红），
25b 钉死原型整宽。两条合起来才完整覆盖「不许再双重挤压」。

## 五、变异证据（4/4，各只挂目标断言）

| 变异 | 手法 | 结果 |
|---|---|---|
| A-1 把嵌套 12/12 改回去 | 面板内加回 `<a-row><a-col :span="12">` | **25a FAIL**（且只挂 25a）✅ |
| B-1 占位改回旧文案 | `$('in-max').placeholder` 改回 `'空 = 模型上限（8192）'` | **25c FAIL**（且只挂 25c）✅ |
| A-2 技术文字加回 | `AgentDefDetail.vue` 加回 `.debug-slot-note` 段 | **25d FAIL**（且只挂 25d）✅ |
| A-1b 策略预览搬回参数列 | `.strat` 塞回 `.params` 内 | **25b FAIL**（且只挂 25b）✅ |

均还原，`git status` 复查仅剩本任务预期改动文件。

## 六、原型同步（R11）

- `.strat` 从 `.params`（420px 列）内移出 → `#adv-body-wrap` 内、`.adv-body` 之后**整宽**
  （原型改前行号 1010–1015 → 改后位于 `</div>`(adv-body) 之后，约 1076–1084）
- `.strat-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}`
- `in-temp` 补 `placeholder="未配置"`；联动二 JS：占位固定「未配置」，extra 按工具态给上限语义（含 8192）
- 稿头 ⑭/联动二 注释、S2 preset `why` 文案同步
- hub 由 `build-agents-hub.mjs` 重建（未手改），两次 build **diff=0**

## 七、验证记录

| 项 | 结果 |
|---|---|
| `vue-tsc --noEmit` | **exit 0**（修掉一处 `form.maxTokens` undefined 不可赋给 `number \| null` 的类型错，`?? null` 兜底） |
| eslint（5 文件） | **exit 0** |
| 单测 | **61 passed**（−2 旧占位用例 +1 防回潮断言） |
| 机检 | **145 项全过** |
| 机检变异 | **4/4** 各只挂目标断言 |
| hub 复现 | 两次 build diff = 0 |
| 截图 | `/tmp/before-adv.png` / `/tmp/after-adv.png`（量测脚本 `/tmp/measure-adv.mjs`，可复跑） |

## 八、遗留

- app 侧实际渲染宽度（~470–505px 预期）待 dev 部署后实测回填；本环境无后端可登录，
  结构性保证为机检 25a（静态）+ 面板已无 `<a-col>` 的事实。
- 原型 `#in-temp` 缺 placeholder 是本次顺带发现并修复的独立小缺陷（改前三个控件两种写法、两种缺失）。
