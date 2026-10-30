# Design 评审报告 · hub 模块稿 id 隔离：全局 `getElementById` 覆写 → IIFE 局部映射

- 评审日期：2026-10-29
- 评审对象：`scripts/lib/proto-registry.mjs`（抽取逻辑）、`scripts/verify-agents-hub.mjs`（机检）、`docs/ui/prototypes/admin-agents-hub.html`（生成物）
- 分支：`fix/proto-hub-shim-local`（基线 `origin/master` `830fb1fb`）
- **形态判定：`Design: pass`**
  - 本次**不改任何原型稿的视觉形态**：`dict-module.html` / `admin-media-ops.html` / `admin-agent-def-detail.html` 三份稿 **0 改动**；
  - 只改「原型稿被抽进整合稿时，id 怎么隔离」的**构建机制**，以及生成物。
  - 可视表现的唯一正向差异：两处在 hub 内**静默失效**的控件（试采状态分段 / 手动触发弹窗状态分段）恢复联动，恢复后与模块稿独立打开时一致（有对照组证据）。

---

## 一、缺陷：为什么必须改

原型稿被抽进 hub 时，为避免 id 撞车，build 会给抽取片段内的 `id="x"` 加前缀（如 `toast` → `zm-toast`）。
但 **HTML 改了、JS 里查 id 的代码没改**，历史实现用一个「运行时全局覆写」来兜：

```js
// scripts/lib/proto-registry.mjs（旧，464 行附近）
var RAW_BY_ID = document.getElementById.bind(document);
var SELF_IDS  = [...].reduce(...);
document.getElementById = function(id){ return SELF_IDS[id] ? RAW_BY_ID('zm-'+id) : RAW_BY_ID(id); };
```

它是 **IIFE 包不住的全局副作用**（`document` 是全局对象，与块级作用域无关），后果：

1. **后装的 shim 劫持同页所有代码**。build 把模块脚本放在 hub **第 1 个 `<script>` 块**，dt 稿脚本在第 3 块 → 先装后毒化。
   实测：`document.getElementById('toast')` 返回 `zm-toast`，`admin-agent-def-detail.html` 的 toast **完全不显示**（该稿 2026-10-28 已做防御性修复：`$` 改 `querySelector("#"+id)`，但**根因未除**，下一个新稿照样中招）。
2. **只覆盖 `getElementById`，覆盖不到 `querySelector('#id')`** → 两处控件在 hub 内**静默失效**（不报错，只是不联动）。

## 二、本次改动（2 个文件 + 生成物）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `scripts/lib/proto-registry.mjs` | 3a 段：prelude 由「全局覆写 3 行」换成「IIFE 局部映射 6 行」；新增 3a-2 段对抽取出的 js 做机械串替换 |
| 2 | `scripts/verify-agents-hub.mjs` | ⑩段新增 4 条防复发断言（10b4-1/2/3、10b5） |
| 3 | `docs/ui/prototypes/admin-agents-hub.html` | 由 `build-agents-hub.mjs` 重生成（**禁手改**，非人工编辑） |

### 2.1 prelude：全局覆写 → 局部函数

```js
var RAW    = document.getElementById.bind(document);
var SELF   = [/* 本源抽取区出现的 id */].reduce(function(a,i){a[i]=1;return a;},{});
var byId   = function(id){ return RAW(SELF[id] ? 'zm-'+id : id); };
var pfxSel = function(s){ return String(s).replace(/#([A-Za-z][-\w]*)/g, function(m, i, off, str){
  var before = str.slice(0, off);
  var open = before.lastIndexOf('['), close = before.lastIndexOf(']');
  if (open > close) return m;   /* 处于 [href="#x"] 属性选择器内部 → 原样返回，不改写属性值 */
  return '#' + (SELF[i] ? 'zm-'+i : i);
}); };
var qs  = function(s){ return document.querySelector(pfxSel(s)); };
var qsa = function(s){ return document.querySelectorAll(pfxSel(s)); };
```

### 2.2 机械串替换（作用域 = 该源自己的 IIFE，不外溢）

只对**本源抽取出的 js 串**做三处替换（prelude 在 `prelude + js` 时才拼接，故 prelude 里的原生 `document.*` 不受影响）：

| 替换前 | 替换后 |
|---|---|
| `document.getElementById(` | `byId(` |
| `document.querySelectorAll(` | `qsa(` |
| `document.querySelector(` | `qs(` |

> 顺序说明：`querySelectorAll` 先替换；且模式锚定 `document.` + 紧跟 `(`，因此元素级的
> `card.querySelector('svg')` 不受影响（那是另一个元素的作用域，本就不该改）。

### 2.3 为什么**不**改成「构建期直接把 `getElementById('x')` 改写成 `getElementById('pfx-x')`」

因为本源有 **7 处是运行时变量**，静态字面量改写覆盖不到：

- `admin-media-ops.html:1611/1613/1831` → `getElementById(SCREENS[k].el)`
- `admin-media-ops.html:1643` → `getElementById(tableId)`（`simulateLoading` 形参）
- `admin-media-ops.html:1920/2021` → `getElementById(id)`（`closeModal(id)` 形参）

→ 必须保留**运行时**映射，只是把它从「全局 `document`」搬到「IIFE 局部变量」。这也是本方案能同时覆盖
`querySelector('#'+segId+' button')` 这类**动态拼接选择器**的原因（`pfxSel` 在运行时对选择器串做一次重写）。

## 三、修复前后对比证据（puppeteer 实测，非"看起来对"）

对照组 = 模块稿 `admin-media-ops.html` **独立打开**时的正确行为；hub 必须与之对齐。

| 指标 | hub 修复前 | hub 修复后 | 独立稿对照组 | 判定 |
|---|---|---|---|---|
| 全局 `document.getElementById` 被劫持 | `true`（shim = zm） | **`false`** | — | ✅ |
| `getElementById('toast').id` | `zm-toast`（拿不到本稿 toast） | **`toast`** | `toast` | ✅ |
| `getElementById('typeList').id` | `dm-typeList`（跨模块穿透） | **`null`** | — | ✅ |
| 「手动触发采集」弹窗状态分段 | `.on` 停在首档 `unsupported` | **`.on` = `ok`** | `ok` | ✅ 与稿一致 |
| 「试采状态分段」点末档 | `.on` 停在 `idx 0`（不联动） | **`.on` = `idx 2`** | `idx 2` | ✅ 与稿一致 |
| 页面 JS 报错 | 0 | **0** | 0 | ✅ |

> 探针脚本：`/tmp/probe-hub-shim.mjs`（hub）、`/tmp/probe-draft-control.mjs`（独立稿对照组）。
> 说明：探针里 `qs_testStateSeg_btns` 恒为 0 属**预期** —— 那是探针从模块**外部**用原生
> `querySelectorAll('#testStateSeg …')` 观测；真身 id 是 `#zm-testStateSeg`。有效的联动判据是
> 「点末档后 `.on` 是否跟过去」，已在上表体现。

### 3.1 改动范围自检（防误伤）

| 自检项 | 结果 |
|---|---|
| 抽取模块脚本区内残留 `document.getElementById(` | **0**（102 处全部替换为 `byId(`） |
| 生成物里 `document.getElementById = `（全局覆写） | **0** |
| 生成物里 `RAW_BY_ID` / `SELF_IDS` 残留 | **0** |
| 非抽取区（hub 壳 / dt 稿脚本）仍用原生 `getElementById(` | **2 处保留**（在 IIFE 之外，本就该走原生，且不再被劫持） |
| 生成物净差异（同源同脚本，只差本修复） | **+135 / −119**，逐行核对**全部落在 id 查找路径**（prelude + byId/qs/qsa 替换），无夹带 |

## 四、机检证据

| 机检 | 基线（未改，原样重生成） | 本分支 | 判定 |
|---|---|---|---|
| `node scripts/build-agents-hub.mjs` | OK | OK | ✅ |
| `node scripts/verify-agents-hub.mjs` | **235/238** | **239/242** | ✅ **+4 条新断言全过，0 回归** |
| `node scripts/verify-agent-def-detail.mjs` | 136/136 | **136/136** | ✅ 保持 |
| `node scripts/verify-ui-prototype.mjs <admin-agents.html>` | 全部通过 | 全部通过 | ✅ |
| `node scripts/check-proto-adopt.mjs` | 无零散稿 | 无零散稿 | ✅ |

**关于 verify-agents-hub 的 3 条 FAIL**：`8b` / `8e` / `9r` 在**基线**（未改动的 `origin/master` 原样重生成）
上**同样存在且完全相同**，属 master 既有的「菜单 vs `BasicLayout.vue`」漂移（缺「封面素材」、图标槽位 10 vs 17），
**与本次改动无关**，不纳入本次范围，已转 team-lead 分派。

新增断言：

- `10b4-1` 生成稿无全局 `getElementById` 覆写（静态）
- `10b4-2` 运行时 `document.getElementById` 仍是原生（未被任何 shim 劫持）
- `10b4-3` 运行时 `getElementById("toast")` 命中的是本稿 toast（不是 `zm-` / `dm-` 前缀件）
- `10b5` 模块 `querySelector("#id")` 前缀生效：点试采状态末档，`.on` 跟到末档（旧 shim 下恒停在首档）

## 五、残留风险与边界声明

| # | 项 | 说明 |
|---|---|---|
| 1 | ⚠️ **生成物含 292 行「源稿未合入」内容，重生成后消失** | 见下方「生成物漂移」专节，**合并时序需 team-lead 裁决** |
| 2 | `crumb` 越界写**未修**（非本缺陷范围） | `admin-media-ops.html` 的 `go()` 会写 `#crumb`；该 id 属于稿自己的壳、抽取时被剥掉，故 hub 内命中 **hub 壳**的面包屑。此行为**与 shim 无关**（`crumb` 从不在 `SELF_IDS` 里），去掉 shim 不改变它。实测视觉无差异（模块 crumb 与 hub `CRUMBS` 文案基本一致，子页还多一级更有信息量）。要根治需改原型稿（`#crumb` 改 `zm-crumb` 或加 hub 内跳过守卫）→ **走 R11，另起一轮** |
| 3 | `contentGroupChildren` 空引用隐患 | `admin-media-ops.html:1637` 的 `toggleGroup()` 取 `#contentGroupChildren`，该元素在稿自带侧栏内、抽取时被剥掉 → hub 内为 `null`，一旦可达会抛错。当前**不可达**（入口在未被抽取的侧栏），属隐患非缺陷。**未修，建议单列** |
| 4 | `pfxSel` 对属性选择器的处理 | 已加守卫：`[href="#x"]` 这类**方括号内**的 `#` 不参与改写（当前 0 处，属防御） |
| 5 | 第 3 份及以后的 `idPrefix` 源稿 | 自动生效，无需额外改动 |
| 6 | `admin-agent-def-detail.html:1324` 的防御性 `$` | **保留不回退**。它现在是「本稿不被别人污染」的自我保护层；删掉会让该稿重新暴露在任何一个未来的全局覆写下 |

### 生成物漂移专节（合并时序需裁决）

- 现象：`origin/master` 上**已提交的** `admin-agents-hub.html` 含「管线编辑封面模式」相关
  DOM（`#zm-coverModeSeg` / `#zm-screen-pipeline-edit`）+ CSS（`.zm-scope .cover-stage` 等）+ JS（`setCoverMode`），
  共约 **292 行**；但 **`admin-media-ops.html` 在 master 上完全没有这些内容**（`cover-stage` = 0 处，
  `grep -S` 全仓所有 ref 查无此改动），`setCoverMode` 在整个仓库的已提交文件里也不存在。
- 结论：master 上的 hub 生成物是**某次未提交工作区状态下 build 出来的产物**，违反了「生成物必须可由已提交源稿复现」的口径。
- 影响：本 PR 重生成 hub → **这 292 行会消失**（它们在任何已提交源稿里都不存在，无法被重新生成）。
- 建议时序（**由 team-lead 裁决**）：
  - 方案 A（推荐）：先把「管线编辑封面」的源稿改动（当前在 `fix/content-hub-env-injection` 工作区，未提交）
    落库合入 master，再 rebase 本 PR 并重跑 build → 漂移自动消失，功能不丢；
  - 方案 B：直接合本 PR，接受生成物回到「可由源稿复现」的正确状态，封面模式待源稿合入后重跑 build 恢复。
