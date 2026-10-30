# Design 评审报告 · 面包屑契约机检加固（hub 模块 crumb 越界写）

- 评审日期：2026-10-29
- 评审对象：`scripts/verify-agents-hub.mjs`（⑩段新增 10h-1 / 10h-2 两条断言）
- 分支：`fix/proto-crumb-guard`（基线 `origin/master` `08fd5698`）
- **形态判定：`Design: pass` —— 本次是【机检加固】，不是形态改动**
  - 未改任何原型稿；未改 `build-agents-hub.mjs` 的 `#crumb` 生成逻辑；未改任何构建逻辑。
  - 唯一产物：两条断言，把一条**隐式依赖**钉成**显式契约**。

---

## 一、背景：一处被误判为「冗余」的隐式依赖

`admin-media-ops.html` 的脚本会写 `#crumb`。在 hub 内，这个 id 属于 **hub 壳**的元素，
看起来是「模块越界写到了别人的 DOM」。但实测（puppeteer + MutationObserver）表明它不是冗余：

| 场景 | 最后写入方 | 实测结果 |
|---|---|---|
| 6 个主屏（菜单 content-* 项） | **hub `paint()`**（`zmSync` → hash → `showHub` → 重绘） | 模块的写被覆盖，**不可见** |
| 4 个子页（source-edit / item-detail / pipeline-edit / account-edit） | **ZM 模块** | hub 的 `CRUMBS` **没有这 4 个键**，`paint()` 会写空 → 模块的写是**唯一来源** |
| 样式 | — | `.sep` 落进 `.ad-crumb` 后 color / font-size 与壳完全一致（`rgb(82,82,82)` / `13px`），**无视觉瑕疵** |

### 根因（不是 shim，是抽取时的一处静态错配）

- 稿自己的 `#crumb` 在 `admin-media-ops.html:439`（`<header class="topbar">`），而抽取区
  `<div class="content">` 从 **447** 行起 → **该元素从不进 hub**；
- 但 `scripts/lib/proto-registry.mjs:448` 把**全部 `<script>` 段整段照搬** →
  两处写在 hub 内落到 hub 壳元素上：
  - `admin-media-ops.html:1423`（`go()`）
  - `admin-media-ops.html:1485`（`accEdit()`）
  - **均无 null 守卫**

### 因此本次【不动稿】

| | 说明 |
|---|---|
| **改了的收益** | 消除一处静态错配。但它**不具 shim 那种扩散性**：影响面固定且已穷尽（2 处写、4 个子页），不会随新稿增长 |
| **改了的代价** | 必须同步给 4 个子页补 `CRUMBS` 映射，否则**子页面包屑掉级/空白**——用户可见回归；且跨「原型稿（R11）+ 构建脚本」两类文件 |
| **不改的真实风险** | 只有一条：将来有人改 hub 壳 `#crumb` 的 id/class → `go()` / `accEdit()` 无 null 守卫 → 抛错 → **整个自媒体模块切屏失效**。概率低（`build-agents-hub.mjs:579` 是单点） |
| **结论** | 收益 < 风险，当前 0 可见缺陷 → **不动稿，改加机检兜底** |

---

## 二、本次改动：2 条断言（⑩段 10h）

| 断言 | 内容 | 基线实测 |
|---|---|---|
| `10h-1` | 面包屑非空：6 主屏 + 4 子页 | `空=[] 主屏[accounts:2 items:2 monitor:2 pipelines:2 publications:2 sources:2] 子页(层级/父屏)[source-edit:3/2 item-detail:3/2 pipeline-edit:3/2 account-edit:3/2]` |
| `10h-2` | 子页面包屑层级 **= 父主屏 + 1 级** | `越级=[] 子页(层级/父屏)[source-edit:3/2 item-detail:3/2 pipeline-edit:3/2 account-edit:3/2]` |

- 主屏集合**取自菜单** `.ad-item[data-screen^="content-"]`，与 `proto-shell.mjs` 的 `SHELL_NAV` 单源对齐，不硬编码。
- `crumbText()` 做了 null 容灾：`#crumb` 不存在时报 **FAIL**，而不是抛异常把整轮机检跑崩。

---

## 三、变异测试（证明断言真在守，不是摆设）

变异只注入**生成物** `admin-agents-hub.html`（构建产物，可 `git checkout` 完全还原），
**不碰** `admin-media-ops.html` 与 `build-agents-hub.mjs`。

### 变异 B：屏蔽模块的 crumb 写（模拟「有人把它隔离掉」）→ ✅ 被 10h-2 抓住

```
已注入变异 B：屏蔽模块的 crumb 写 × 2
 FAIL 10h-2 子页面包屑层级 = 父主屏 + 1 级（少一级说明模块的 crumb 写没生效）
      actual="越级=[source-edit:2≤2,item-detail:2≤2,pipeline-edit:2≤2,account-edit:2≤2]
              子页(层级/父屏)[source-edit:2/2 item-detail:2/2 pipeline-edit:2/2 account-edit:2/2]"
合计 240/244 通过
```

### ⚠️ 变异测试暴露了我第一版断言的缺陷（已修正）

初版 `10h-2` 写的是「子页层级 **≥** 父屏层级」。变异 B 跑下来 **仍然通过** —— 说明它是摆设。

原因（实测发现，与"隔离后会变空"的直觉不同）：
> 屏蔽模块的写之后，子页面包屑**不会变空**，而是**停留在父屏那两级**
> （进主屏时 `paint()` 写的，进子页时没人覆盖）→ 从 `3/2` 变成 `2/2`。
> 用 `≥` 的话 `2 ≥ 2` 依然成立，断言形同虚设。

→ 已改为 **严格大于**（`lv <= pLv` 判 FAIL），即「子页 = 父屏 + 1 级」，并把这个坑写进代码注释。

### 变异 A：改 hub 壳 `#crumb` 的 id（模拟 documented risk）→ 整轮机检崩在既有的 `9o`

```
Error: failed to find element matching selector "#crumb"
    at .../scripts/verify-agents-hub.mjs:88:20
```

- 崩在**既有的** `9o`（`顶栏 56 高 + Home 图标 + 面包屑`，第 88 行 `vis('#crumb')`），
  它比 10h 段更早执行 → 我的断言还没跑到。
- 结论：**无论如何都是红的**；但严格说 `10h-1` 的失败路径未被 A 真正走到（被 9o 抢先崩掉），
  其 null 容灾属**按构造保证**（代码层已加 `.catch(() => null)`）。未修改 `9o`——它不在本轮范围。

### 变异测试诚实结论

| 断言 | 强度 | 说明 |
|---|---|---|
| `10h-2`（层级 = 父屏+1） | **强** | 变异测试实证有效，精确报出 `2≤2` 及哪个子页掉的级 |
| `10h-1`（非空） | **弱** | 两种现实变异下都仍为绿；真正价值在「元素整体消失」的兜底，而该场景会被既有 `9o` 更早拦下。**保留但不应被视为主要防线** |

---

## 四、机检证据

| 机检 | 结果 |
|---|---|
| `node scripts/verify-agents-hub.mjs` | **241/244**（基线 239/242 → +2 条新断言全过；3 条 FAIL = 既有 8b/8e/9r，未新增） |
| `node scripts/build-agents-hub.mjs` | OK，且**生成物与已提交版本完全一致**（`git diff` 为空 → 未受机检改动连带影响） |
| `node scripts/verify-agent-def-detail.mjs` | **136/136** 保持 |
| 变异测试 | 变异 B → `10h-2` FAIL（有效）；变异 A → 整轮崩在既有 `9o`（红）；**均已还原**，`git status` 只剩机检文件被改 |

## 五、残留风险与建议（不在本轮范围）

| # | 项 | 建议 |
|---|---|---|
| 1 | `go()` / `accEdit()` 无 null 守卫（`admin-media-ops.html:1423` / `:1485`） | 与下条一起，等封面模式源稿落库时打包 |
| 2 | `toggleGroup()` 无 null 守卫（`admin-media-ops.html:1446`；`#contentGroupChildren` 在 `:419` 稿自带侧栏、抽取区外 → hub 内**不可达**） | 同上，**不单开一轮 R11** |
| 3 | 既有 `9o` 在 `#crumb` 缺失时会崩掉整轮机检（而非报 FAIL） | 低优先级；建议随 ①② 一起让它容 null |
| 4 | 🔴 `admin-media-ops.html` 当前悬空（master 无封面模式、主工作区 dirty 版有、team-lead 已留档） | **现在不要改**。等封面模式落库后，把 crumb 守卫 + `contentGroupChildren` 守卫**打包成一次 R11**，避免同一文件走两次评审、也避免三方冲突 |
