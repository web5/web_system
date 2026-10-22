# 原型演示控件（demo control panel）

> 定位：`ux-prototype-designer` 每份原型的**固定附件**——评审台的操控台，不是产品 UI。
> 加载时机：出稿阶段（写 HTML 时必读）；质检阶段按 §九 验收。
> 可复制实现：`../examples/demo-panel.html`（能直接跑，改注册表即可用）。
> 机检：`node skills/ux-prototype-designer/scripts/check-demo-panel.mjs <稿.html>`（交人前必跑）。

## 一、它解决什么问题

原型是给**不做设计的人**看的。评审时反复出现三种卡顿，控件就是为它们存在的：

| 卡顿 | 评审现场的样子 | 控件怎么解 |
|---|---|---|
| **不知道能点哪** | 只敢看首页截图，然后问「这个能点吗」 | 稿头声明可点范围 + 屏清单显式列出全部屏 |
| **走不到想看的那屏** | 想确认第 5 屏，要连点 4 层菜单，还可能点错 | 屏直达下拉 + `[` `]` 上下屏 |
| **分支看不见** | 主路径走通就通过了，空态/失败/换角色没人设计，落地才发现 | 场景包一点即切（角色 × 屏 × 数据态 × 弹层） |

**一句静态说明（「本稿为交互原型，数据为 mock」）只解决了第一件事的 1/3**——它没说哪些能点、有哪些屏、有哪些分支。控件的信息密度必须高到能替评审回答这三个问题。

## 二、三条硬约束

| # | 约束 | 违反后果 | 判定手段 |
|---|---|---|---|
| 1 | **控件不是产品 UI** | 评审分不清「这是产品里的一张卡」还是「注记」，截图外传后被当真需求 | 虚线边框 + 「演示」标签 + `data-demo-ctl` 语义隔离；不复用产品卡片 class |
| 2 | **可隐没、不遮挡** | 挡住主操作/弹窗，评审只能盲点；截图不干净 | `H` 收起为胶囊；产品弹层打开时控件自动降为 40% 且不可点；`@media print` 隐藏 |
| 3 | **开关必须真生效** | **假开关比没有更糟**——它给评审「分支已覆盖」的错觉，把未设计的态放行了 | §五·B 状态矩阵 CSS 契约 + 机检「每个 `data-dc-state` 值都有对应选择器」 |

> 第 3 条是本控件存在的理由。一个点了不变的下拉框，比一句「分支未覆盖」更有害。

## 三、四区结构（信息架构）

```
┌─ 原型演示控件 ─────────────────────────┐
│ ① 稿头：稿名 / 目标端 / 版本日期 / 数据 mock 声明 / 待确认项计数        │
│ ② 场景：具名场景包（一点即到）  · 角色 · 数据态 · [下一步]              │
│ ③ 导航：屏幕清单（分组）· 当前屏高亮 · [ ] 上下屏                      │
│ ④ 辅助：标注层开关 · 复位 · 收起 · 快捷键提示                          │
└────────────────────────────────────────┘
```

| 区 | 必填内容 | 硬要求 |
|---|---|---|
| ① 稿头 | 稿名、目标端、日期、`数据全为 mock`、`待确认 N 项 · 见《设计决策记录》` | 待确认项数 **从 DOM 数出来**（`[data-anno]` 计数），不手写——手写必漂移 |
| ② 场景 | ≥3 个具名场景包；角色切换；数据态切换 | 场景名要写成「谁会遇到什么」，不是「状态 B」 |
| ③ 导航 | 全部屏可直达，按业务分组 | 与产品菜单**共用一个 `go()`**，不允许两套导航 |
| ④ 辅助 | 标注层、复位、收起 | 复位回到「默认场景」，不是回到空 |

## 四、场景包（最重要的一区）

**场景 = 有名字的一段评审剧本**，点一下同时设定 `角色 + 屏幕 + 数据态 + 弹层`。评审人不需要自己组合开关。

```js
presets: [
  { id:'p1', label:'S1 新用户首次进入 · 空态', role:'operator', screen:'sources', state:'empty',
    why:'新装系统没有任何采集源时，用户看到什么' },
  { id:'p2', label:'S2 触发失败 · 技术详情折叠', role:'operator', screen:'sources', state:'normal',
    modal:'trigger', why:'截图中吐原始 JSON 的现场' },
  { id:'p3', label:'S3 管理员的越权按钮', role:'admin', screen:'pipelines', state:'normal',
    why:'同一屏在两种角色下的可见差异' },
]
```

写法要求：

- **命名是「谁 · 什么情况」**：`S1 新用户首次进入 · 空态` ✅ / `空态测试` ❌。
- **`why` 一句话说明这个场景要评审确认什么**；不写 `why` 的场景包等于没设计。
- **首屏默认场景**必须是真实主路径（不是空态），否则评审一进来以为功能不全。
- **顺序即演示顺序**，`下一步` 按数组顺序推进；现场讲稿直接照场景名念。
- **一屏可多场景**（同一屏的空/满/失败），但同一场景内只允许一个数据态。
- 覆盖建议：主路径 × 1~2 + 每个关键异常 × 1 + 每个角色差异 × 1。低于 3 个说明分支没想清。

## 五、实现契约（照抄，不要每稿自创写法）

### 5.1 属性契约

| 钩子 | 落在哪 | 作用 |
|---|---|---|
| `data-demo-ctl` | 控件根元素 | 机检锚点 + 打印/截图隐藏 |
| `data-dc-toggle` | 收起按钮 | 展开/收起 |
| `data-dc-preset="p1"` | 场景按钮 | 应用场景包 |
| `data-dc-role="admin"` | 角色按钮/选项 | 切角色 |
| `data-dc-state="empty"` | 数据态按钮 | 切数据态 |
| `data-dc-screen="sources"` | 屏直达项 | 跳屏 |
| `data-demo-role` | `<html>` | 当前角色（CSS 断言） |
| `data-demo-state` | 当前屏容器 | 当前数据态（CSS 断言） |
| `data-need-role="admin"` | 菜单项/按钮 | 角色不足时隐藏 |
| `data-anno="D5"` | 待确认元素 | 标注层徽标 + 计数 |
| `.screen` + `id="screen-<key>"` | 每个屏 | 屏注册表锚点，机检对账 |

### 5.2 状态矩阵 CSS（防假开关的核心）

每个屏内自带分支块，用 class 声明，**由容器属性驱动显示**，不要用 JS 逐个 `style.display`：

```css
/* 默认隐藏所有非正常分支 */
.only-loading, .only-empty, .only-error, .only-forbidden { display: none; }

/* 非正常态时，隐藏正常内容 */
[data-demo-state]:not([data-demo-state="normal"]) .only-normal { display: none; }

/* 当前态显示对应分支 */
[data-demo-state="loading"]   .only-loading,
[data-demo-state="empty"]     .only-empty,
[data-demo-state="error"]     .only-error,
[data-demo-state="forbidden"] .only-forbidden { display: block; }
```

```html
<div class="screen" id="screen-sources" data-demo-state="normal">
  <div class="only-normal">…真实列表…</div>
  <div class="only-empty">…空态 + 唯一恢复入口（新建采集源）…</div>
  <div class="only-error">…失败 + 重试…</div>
  <div class="only-forbidden">…无权限 + 申请入口…</div>
</div>
```

> 五态命名固定：`normal / loading / empty / error / forbidden`。多一态（如 `partial`）自行扩展时要同步加选择器，机检只校验「用到的每个值都有规则」。

**方案 B · 整屏状态层**（改造存量稿用，一次到位不逐屏重排）：

```css
.demo-states { display: none; }
[data-demo-state]:not([data-demo-state="normal"]) > *:not(.demo-states) { display: none; }
[data-demo-state]:not([data-demo-state="normal"]) .demo-states { display: block; }
.demo-states > div { display: none; }
[data-demo-state="empty"] .demo-states .only-empty { display: block; }
/* loading / error / forbidden 同理 */
```

一个状态层 DOM，`applyState()` 时挂到当前屏（`screen.appendChild(layer)`），文案按屏名注入。

| 方案 | 适用 | 代价 |
|---|---|---|
| A · 逐屏分支块 | 新稿；需要「列表空但统计卡仍在」这类**局部不同态** | 每屏都要排 4 个分支块 |
| B · 整屏状态层 | 存量稿改造（8 屏真实内容已成型，重排 32 处不划算） | 只能表达**整屏**同态，做不了局部态 |

两者共用同一套 `data-demo-state` 契约与机检，选哪个写进设计决策记录。

### 5.3 角色可见性

≤2 个角色可用纯 CSS（可被机检看到）：

```css
html[data-demo-role="operator"] [data-need-role="admin"] { display: none; }
html[data-demo-role="admin"]    [data-need-role="operator"] { display: none; }
```

> 角色切换必须同时影响**导航菜单**与**页内操作按钮**——只隐藏按钮不隐藏菜单，是最常见的半吊子实现（菜单点进去一片空白）。

### 5.4 导航单一入口（双向同步）

`go(key)` 是**唯一**入口，产品菜单与控件都调它，它负责：切屏 → 更新面包屑 → 更新菜单选中 → 更新控件当前屏高亮 → 写 `location.hash`。`hashchange` 回灌，浏览器前进后退可用。

> 反例：控件自己写一份 `switchScreen()`，产品菜单写另一份 → 用控件跳屏后菜单选中项不跟着变，评审立刻发现「这两个不一致」，信任度归零。

### 5.5 标注层

待确认项在 DOM 上打 `data-anno="D5"`（编号对应《设计决策记录》的决策号）。标注层开关给 `html` 加 `data-demo-anno="on"`：

```css
[data-demo-anno="on"] [data-anno] { outline: 1px dashed var(--brand); position: relative; }
[data-demo-anno="on"] [data-anno]::after {
  content: attr(data-anno); position: absolute; top: -10px; left: -4px;
  font-size: 10px; padding: 0 4px; background: var(--brand); color: #fff; border-radius: 4px;
}
```

- 标注层默认**关**（开着会让人以为产品长这样）。
- 稿头的「待确认 N 项」= `document.querySelectorAll('[data-anno]').length`。

### 5.6 复位与持久化

- **复位**：回到注册表里标注 `default: true` 的场景包，并关掉所有弹层/Toast。
- **折叠状态**要记住才不烦人，但 `file://` 下所有本地文件**同源**，`localStorage` 会跨稿串状态 → **key 必须带文件标识**：`dc:' + location.pathname`。更简单的选择是不持久化（每次打开为准），二选一写进稿内注释。
- **不要把演示态写进 URL 之外的产品状态**：切数据态不改业务数据、不改表单值。

### 5.7 打印与截图

```css
@media print { [data-demo-ctl] { display: none } }
```

评审给领导发截图前按 `H` 收起；控件收起态必须只剩一个窄胶囊，不占内容区。

## 六、布局与视觉

| 目标端 | 位置 | 规格 |
|---|---|---|
| 桌面 Web（宽屏壳） | 固定右下 16px | 展开 300px、收起 44px 胶囊；`z-index` 高于产品内容、**不影响产品布局**（fixed，不挤压内容区） |
| 移动 H5 / App / 小程序（竖屏壳） | **壳外画布**右下 | 宽度 ≤240px；🔴 **不得放进手机壳内部**——会遮挡真实界面，且让评审误以为那是产品里的浮层 |
| 定制落地页（双视口并置） | 两个视口之间的间隙底部 | 控件作用于「当前激活视口」，标题里写明当前视口名 |

视觉必须自带「外来者」气质：

- 容器：`1px dashed` 品牌色边 + 白底 + 轻投影；标题行带 `(i)` 图标 + 「原型演示控件」文字 + 右侧「收起」。
- 分区标签用小号灰字，不用产品按钮样式（产品按钮长得一样 → 分不清）。
- 当前生效的场景/角色/态要**有选中态**（品牌浅底 + 品牌文字色），否则评审不知道现在是哪一态。
- 品牌橙 `#F97316` 不足以做正文文本（对比度 2.9:1），文本用深一档（如 `#EA580C`）；具体值取项目 token。

## 七、键盘（评审时的加速器）

| 键 | 行为 | 备注 |
|---|---|---|
| `H` | 收起 / 展开控件 | 截图前第一件事 |
| `[` / `]` | 上一屏 / 下一屏 | 按屏注册表顺序 |
| `1`~`9` | 应用第 N 个场景包 | 现场讲稿标号 |
| `A` | 标注层开关 | 对着《设计决策记录》讲 D 编号 |
| `Esc` | 关弹层 → 再按收起控件 | 不直接退出 |
| `?` | 展开控件并高亮快捷键区 | 发现入口 |

- 🔴 所有快捷键在 `input` / `textarea` / `select` / `[contenteditable]` 内**必须让行**，否则原型里的表单没法填。
- 快捷键列表在控件底部常驻一行小字（可折叠），不靠口口相传。

## 八、两档规格

| 档 | 何时用 | 必含 |
|---|---|---|
| **L0 最小版** | 低保真线框、单屏稿 | 稿头（含 mock 声明）+ 屏清单 + 收起/隐藏 + `@media print` |
| **L1 完整版** | 多屏 / 高保真 / 交人确认的稿 | L0 + 场景包（≥3）+ 角色切换 + 五态切换 + 标注层 + 复位 + 快捷键 |

> 判断标准不是「稿子大小」，而是**这份稿要不要被不止一个人反复点**。只给一个人看 5 分钟的单屏，L0 足够。

## 九、验收

**机检**（`node skills/ux-prototype-designer/scripts/check-demo-panel.mjs <稿.html>`，交人前必跑）：

1. 存在 `data-demo-ctl`
2. 每个 `.screen` 的 id 都在控件屏注册表里（无幽灵项、无漏项）
3. 场景包数量 ≥3 且每个都有 `role/screen/state`
4. 每个出现过的 `data-dc-state` 值都有对应 `.only-*` CSS 规则（防假开关）
5. 有 `@media print` 隐藏、有收起控件、有复位

**人检**（三分钟）：

1. 点每个场景包，界面**真的**变（角色菜单变、数据态变、弹层开）
2. 用控件跳屏后，产品菜单选中项与面包屑跟着变
3. 按 `H` 收起后不遮挡主操作；发一张截图看着像纯产品界面
4. 在表单输入框里打字，快捷键不劫持输入

## 十、反模式

- 只写一句「本稿为交互原型，数据为 mock」的静态卡 —— 信息量≈0，评审仍然不知道能点哪、有哪些分支
- 点了没反应的开关（假开关）—— 比不提供开关更糟
- 控件屏清单与实际屏不同步：漏项（有一屏永远走不到）/ 幽灵项（点进去空白）
- 控件长得像产品卡片（实线、产品同款圆角与阴影）→ 评审把它当需求
- 控件挡在手机壳里 / 压在弹窗上 / 遮住主操作按钮
- 用 `!important` 硬覆盖产品样式来实现状态切换
- 演示态写进 `localStorage` 且 key 不带文件标识 → 下一份稿继承上一份的状态，查半天
- 把「待确认 N 项」写成硬编码数字，稿改了两边不一致
