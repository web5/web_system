# admin 每日美句 · 双空态去重（改用 table `emptyText` 槽）· 研发方案

| 项 | 值 |
|---|---|
| 文档版本 | v1（2026-11-25） |
| 负责人 | rd-engineer |
| 关联需求 | 台账 **#8993**（P2 · 双空态）；同时须保住 167 稿 V9 / V10 / V11 / V8 / V12 判据不回退 |
| 原型 sha | `3ac228a0a62df6c8`（167 附件 HTML，`shasum -a 256` 实算，沿用；本轮不改交互） |
| 交互清单 | `docs/ui/page-specs/daily-quotes-readonly.md`（沿用，本轮无新增交互） |
| 基线 | `origin/master = 2c37a474`（含 PR #670 的 V9 修复） |
| 回滚点 | `2c37a474`（本次合入前的 dev 版本） |
| PR | **#671**（draft）· https://github.com/web5/web_system/pull/671 |
| commitId | `2da04775`（fix 主体；spec + 方案文档同 commit） |

阻塞: 0

> 上一行供门禁 R18 / R11 `report_header_blocking_zero` 机检读取（行首锚定 `^阻塞:`，故独立成行、不放表格内）。
> 本轮为纯前端模板空态段搬迁 + 渲染态断言升级，无待决阻塞项。

---

## 1. 背景与目标

### 1.1 现象（用户 2026-11-25 16:23 目视确认）

`apps/admin/src/views/Content/DailyQuotes.vue`（基线 279 行）在「筛到无命中」时，页面同时出现**两块空态**：

1. `<a-table>` 自己的占位：`dataSource` 为空 → antdv 走 `renderEmpty('Table')`，渲染内置 `No data`；
2. 表格下方另有一个自定义 `<a-empty v-if="!filtered.length && !loading" description="没有匹配的美句">`（基线第 206–208 行），内含「清空筛选与搜索」按钮。

两块上下叠着 → 观感像页面报错，且用户会先看到英文「No data」。

### 1.2 根因

**① 渲染层（能力重复实现）**：空态被实现了两次——表格内置一次、模板外自定义一次。表格内置那块不受控（走 `renderEmpty`），自定义那块只管文案与按钮，两者互不知情，`dataSource` 一空就同时出。

**② 验收层（断言不数数量）**：`daily-quotes-source-filter.spec.ts` 上一轮（s42）的渲染态用例 `pageEmptyState()` 的定位口径是「**不在 `.ant-table` 内的** `.ant-empty`」：

```ts
Array.from(container.querySelectorAll('.ant-empty')).find((n) => n.closest('.ant-table') === null)
```

这条口径**主动忽略了表格内置占位**，于是「空态有几块」这个问题从来没被断言过——双空态在 4 条用例全绿的情况下上了线。**只修模板不修断言，同类问题会再次漏过**，这是本轮必须一并补的机制缺口。

### 1.3 目标

1. 无命中时 DOM 里**空态占位数量 === 1**，且这一块在表格 body 内（列头保留），「清空筛选与搜索」按钮仍在且可点击。
2. 点击后：`filtered` 回 281 条、页码回 1、册别/课号/keyword 三条件全复位（与 V9 判据一致）。
3. 断言升级：新增「空态数量 === 1」的渲染态用例，并保留上一轮全部用例（9 条源码断言 + 4 条渲染态 T1–T4），不允许以删除换绿。
4. 变异自证 2 组（M1 恢复双空态、M2 删 `bookFilter` 复位）必须变红。

### 1.4 Non-goals（明确不做）

- ❌ **不改筛选逻辑**：`filtered` / `paged` / `onFilterChange` / `onSearch` 零改动。
- ❌ **不改分页**：`page` / `pageSize` / `onPageChange` / `pagination` 配置零改动。
- ❌ **不动工具栏「清空」**（基线第 157 行 `<a-button @click="clearFilters">清空</a-button>`），它是独立兜底入口，V10 白名单已含。
- ❌ **不动抽屉空态**（`<a-empty v-else description="未取到美句数据" />`），与表格区空态不同时出现。
- ❌ **不加新功能**：不加「空态时才显示按钮」之类的条件逻辑，不改文案、不加新按钮、不加新依赖、不改全局样式。
- ❌ 不改接口 / DB / migration / seed；不发 prod。
- ❌ 不改 `jest.config.cjs`、不装 `@vue/test-utils`。

---

## 2. 方案设计（九子项）

### 2.1 架构与数据流

改动为**单点模板结构迁移**：把自定义空态整块搬进 `<a-table>` 的 `emptyText` 槽，删掉表格外那块。不改 script、不改数据流。

**改动前（双空态）**

```
template:
  <a-spin>
    <a-table :data-source="paged">           ← dataSource 空
      └─ 内部 slots.emptyNode 未提供
           ↓ Table.js L428-430: slots.emptyText ? … : (props.locale?.emptyText) || renderEmpty('Table')
           ↓ renderEmpty('Table')
         DOM: .ant-table-placeholder > .ant-empty（"No data"）      ← 空态①（不受控）
    </a-table>
    <a-empty v-if="!filtered.length && !loading" description="没有匹配的美句">  ← 空态②（自定义）
      <a-button @click="clearFilters">清空筛选与搜索</a-button>
    </a-empty>
  </a-spin>
  ⇒ document.querySelectorAll('.ant-empty').length === 2
```

**改动后（单空态）**

```
template:
  <a-spin>
    <a-table :data-source="paged">
      <template #emptyText>                  ← 空态唯一实现点
        <a-empty v-if="!loading" description="没有匹配的美句">
          <a-button @click="clearFilters">清空筛选与搜索</a-button>
        </a-empty>
      </template>
    </a-table>
  </a-spin>
  ⇒ Table.js L428-430: slots.emptyText 存在 → 直接返回其 vnode（不再走 renderEmpty）
  ⇒ vc-table/Body/index.js L87-98: rows 为空 → <tr class="ant-table-placeholder"> 内渲染 emptyNode
  ⇒ document.querySelectorAll('.ant-empty').length === 1（落在 .ant-table 内，列头保留）
```

**为什么用 `emptyText` 槽（源码坐实，非推测）**

| 证据 | 位置 | 内容 |
|---|---|---|
| 槽优先级最高 | `node_modules/ant-design-vue/es/table/Table.js` L428–430 | `emptyText: () => (slots.emptyText?.()) \|\| (props.locale?.emptyText) \|\| renderEmpty('Table')` |
| 落点 | `node_modules/ant-design-vue/es/vc-table/Body/index.js` L87–98 | `rows` 为空 → `ExpandedRow({ class: 'ant-table-placeholder', isEmpty: true }, { default: () => [slots.emptyNode] })` |
| 列头独立 | `vc-table` thead 与 tbody 分开渲染 | 空态只替换 tbody 的占位行，`<thead>` 保留 |

> 取舍说明：另一条路是「空态时 `v-if` 隐藏表格、只留自定义空态」，它会**丢列头**（用户失去"这是什么表"的上下文），且会让「表格是否存在」随筛选结果变化，视觉跳动更大。`emptyText` 槽同时满足「单空态 + 保留列头 + 保留按钮」三条，故采用它。**若实测该槽在 loading / 分页变化边界行为不符，改走备选方案并在本文补证据**——实测结果见 §3.2 与 §4.1。

**数据流不变**：`getDailyQuotes()` 整池一次拉回 → `filtered`（客户端 AND）→ `paged`（20 条/页切片）。全程零写请求。

### 2.2 页面清单（含菜单）

| 页面 | 路由 | 职责 | 权限门控 | 本轮改动 |
|---|---|---|---|---|
| 每日美句 | `/content/daily-quotes` | 服务端冻结池只读查看（列表 + 详情抽屉） | `content:view` | **仅**表格区空态段（`DailyQuotes.vue` 空态相关行） |

无新增页面、无菜单变更（`BasicLayout.vue` / `router/index.ts` 零改动）。

### 2.3 接口清单

**零接口改动**：

| 方法 | 路径 | 入参 | 出参 | 鉴权 | 本轮 |
|---|---|---|---|---|---|
| GET | `/content-admin/nce/daily-quotes` | 无（裸调用 `getDailyQuotes()`） | `{ version, count, items[] }` | 用户 JWT | 不变（仍 1 处调用点：`load()`） |

### 2.4 数据结构

无。表 / 字段 / 索引零增改，**无 DDL**。

### 2.5 配置清单

无。网关路由、部署路径、环境变量、第三方凭证全部沿用。

### 2.6 依赖系统或接口

| 依赖对象 | 类型 | 强/弱 | 缺失/错误后果 | 本轮处置 |
|---|---|---|---|---|
| `ant-design-vue@4.2.6` 的 Table `emptyText` 槽 | 前端库 | **强** | 槽名写错 → 静默回落到 `renderEmpty` → 双空态复现 | 槽名以 `Table.js` L428 为准（`emptyText`），由渲染态用例守住 |
| `@vue/compiler-sfc` | 测试期 | 弱 | 渲染态用例无法编译 SFC | 仓库既有依赖，不新增 |
| 后端 `getDailyQuotes` | 内部 | 强 | 整池取不到 → 走 `failed` 失败态（与空态互斥） | 不变 |

> 结论：**不新增依赖、不改 lockfile、不改 jest 配置**。

### 2.7 初始化数据 / 种子数据

无。美句池为服务端冻结数据（281 条 = NCE2 136 + NCE3 80 + NCE4 65），本轮不 seed。

### 2.8 权限模型

无变更。`content:view` 语义、授予角色、定义位置全部不动。

### 2.9 接口设计约束（V11 不回退）

本轮零接口改动，但既有约束必须保持：

- **V11-a 零新请求**：筛选 / 搜索 / 清空 / 点空态按钮全程不发请求（`getDailyQuotes()` 仅 `onMounted` 与「刷新」）。
- **V11-b 无伪造参数**：保持 `getDailyQuotes()` 裸调用，无 `?book=` / `?lessonId=` / `?keyword=`，无 `params:`。
- 由既有源码守卫 `hasBareGetDailyQuotes` / `hasFabricatedParams` 继续兜住。

---

## 3. 影响面与风险

### 3.1 改动范围矩阵

| 层 | 文件 | 改动性质 | 规模 |
|---|---|---|---|
| 前端模板 | `apps/admin/src/views/Content/DailyQuotes.vue` | 空态段从表格外搬进 `<template #emptyText>`；删掉表格外 `<a-empty>` | 约 10 行 |
| 前端测试 | `apps/admin/src/views/Content/daily-quotes-source-filter.spec.ts` | 追加 2 条渲染态用例（T5/T6）；**同步订正 `pageEmptyState()` 定位口径**（位置判据失效，改按文案定位）；旧断言全保留 | 约 +90 行 |
| 文档 | 本文件 | 新增 | — |
| 后端 / DB / migration / seed / 配置 / 权限 | — | **零改动** | 0 |

### 3.2 风险分级

总体 **低**（单模板段、无数据写入、无接口调用、回滚 = 单文件 revert）。但列出真实风险与处理：

| # | 风险 | 等级 | 处理 / 处置 |
|---|---|---|---|
| R-1 | 🔴 **`emptyText` 槽替代 `renderEmpty` 后，「无数据」与「加载中」混淆**（V9 的反例关注点：V9 曾因"空态与加载态判据混着看"出过假绿/误判） | **中** | 基线里自定义空态带 `!loading` 守卫（加载中不显示），表格内置 `No data` 却在加载中照样出。搬进槽后若整块无条件渲染，**首屏加载中会闪出「没有匹配的美句」**——文案与真实状态不符。处置：**槽内保留 `v-if="!loading"`**，加载中该槽渲染为空（`a-spin` 遮罩本已覆盖表体，用户看不到占位文字）。由此形成明确三分：`loading` → 槽空；`!loading && filtered.length===0` → 单块空态；有数据 → 正常行。用例 T5 只在 `loading === false` 的稳定态断言数量 === 1，不去断言加载瞬态（避免拿不确定时序当判据） |
| R-2 | 空态搬进 tbody 后视觉变化（列头保留，空态在表体中央；`.ant-table-placeholder` 有默认纵向内边距） | 低 | 文案、按钮、字号、白底全沿用 antd 既有类，不新增自定义样式；V12 视觉判据逐项人工对照（§7 A5） |
| R-3 | 上一轮 T1–T3 依赖「空态不在 `.ant-table` 内」的位置判据 → 修复后必然失效 | 中 | **不删用例**，只订正 `pageEmptyState()` 的定位口径为「description === '没有匹配的美句' 的 `.ant-empty`」，T1–T4 断言语义不变；订正理由在代码注释与本文写明（否则会被误读为"改断言迁就实现"） |
| R-4 | 新断言仍不触达渲染 → 假绿复发 | 中 | **M1 变异（恢复双空态）必须让 T5 变红**；红阶段必须先在未修代码上看到 `Received: 2` |
| R-5 | 空态数量口径被后续无关 `.ant-empty` 污染（如抽屉打开） | 低 | T5 在抽屉关闭态断言；抽屉空态不在本次改动面（Non-goals） |

### 3.3 兼容性

向前 / 向后兼容：无接口、无数据结构、无配置变更；Vue 运行时时序不变（仅 vnode 子节点位置与槽归属变化）。antdv 版本不动。

### 3.4 灰度

不灰度。dev 验证后按常规流程；本轮**不发 prod**。

---

## 4. 测试方案

### 4.1 单元测试

沿用上一轮已建立的渲染路线（`@vue/compiler-sfc` 编译**生产 SFC** + 原生 `createApp` 挂 jsdom），**不引入新依赖、不改 `jest.config.cjs`**。

| 用例 | 断言（全部打渲染后 DOM） | 修复前 | 修复后 |
|---|---|---|---|
| T1–T4（上一轮，保留） | 空态存在 / 按钮可点 / 点击回 281 + 页 1 + 三条件复位 / 页码复位可观测性 | 绿 | **绿**（定位口径订正后语义不变） |
| **T5 空态唯一性** | `querySelectorAll('.ant-empty').length === 1`；该唯一空态落在 `.ant-table` 内（`closest('.ant-table') !== null`）；`description === '没有匹配的美句'`；**内含可点击按钮「清空筛选与搜索」** | **红（2 块）** | 绿 |
| **T6 唯一空态内按钮可点即恢复** | 取「唯一」那块空态里的按钮 → 点击 → 空态数 0、20 行数据、`共 281 条`、页码 1、册别回「全部」、课号空、keyword 空 | 红 | 绿 |
| M1 / M2 变异自证 | M1 恢复「表格外独立 `a-empty`」→ T5 必红；M2 删 `clearFilters` 里 `bookFilter.value = 'ALL'` → 复位断言必红 | — | 红→还原→绿 逐组贴证据 |

> T5/T6 与 T1–T3 的重叠是有意的：T1–T3 验「按钮能用」，T5 验「只有一块」，T6 验「点的是那一块」。上一轮的漏洞正是"只有可用性、没有唯一性"。

### 4.2 接口 / 集成测试

不涉及（零接口改动）。V11 由既有源码守卫兜。

### 4.3 功能测试用例矩阵（人工走查依据）

| 用例ID | 模块 | 场景 | 前置条件 | 步骤 | 预期结果 | 环境 |
|---|---|---|---|---|---|---|
| TC-ES-01 | 每日美句 | 叠加筛选无命中 → **只有一块**空态 | 已登录且具 `content:view`；整池 281 条已加载 | ① 册别选 `NCE4` ② keyword 输 `zzzzz-no-hit` | 页面 `a-empty` 仅 1 块，文案「没有匹配的美句」；**无** `No data`；列头（#/英文/中文/来源/操作）仍在 | dev |
| TC-ES-02 | 每日美句 | 空态恢复入口可用 | 承接 01 | 观察并点空态内「清空筛选与搜索」 | 按钮存在且可点 → 空态消失、`共 281 条`、页码 1、册别「全部」、课号空、keyword 空 | dev |
| TC-ES-03 | 每日美句 | 加载中不出现"没有匹配"文案 | 首屏 / 点「刷新」瞬间（限速网络） | 观察表格区 | 只有 spinner，无「没有匹配的美句」闪现（R-1 处置生效） | dev |
| TC-ES-04 | 每日美句 | 分页边界：空态时翻页 | 承接 01（filtered 为空、页码被纠偏为 1） | 观察分页区 | 页码 1、`共 0 条`，空态仍为 1 块、不重复 | dev |
| TC-ES-05 | 每日美句 | 单册正常态未受影响 | 承接 02 | 册别选 `NCE3` | 80 条、20 行/页、列头与行高与修复前一致 | dev |
| TC-ES-06 | 每日美句 | 只读不回退（V8/V10/V11） | 承接 05，开 DevTools Network | 筛选 / 搜索 / 清空 / 点空态按钮 | 写按钮 0；daily-quotes **零新请求**；无 `?book=`/`?lessonId=`/`?keyword=` | dev |
| TC-ES-07 | 每日美句 | 抽屉空态不受影响 | 承接 05 | 打开 / 关闭预览抽屉 | 抽屉正常；「未取到美句数据」兜底未被本次改动波及 | dev |

### 4.4 回归范围

| 项 | 命令 | 通过标准 |
|---|---|---|
| 类型检查 | `pnpm --filter admin exec vue-tsc --noEmit` | 0 error |
| 单元测试全量 | `pnpm --filter admin exec jest --rootDir . --config jest.config.cjs` | ≥14 suites / **≥166 tests** 全绿（基线 14/165 + 新增 2） |
| Lint | `pnpm --filter admin exec eslint .` | 0 error |
| V9 4 条渲染态 | 同 spec T1–T4 | 全绿，不得删改语义 |
| V10 按钮白名单 | `daily-quotes.readonly.spec.ts` | 含「清空筛选与搜索」，无写按钮 |
| V11 零新请求 / 无伪造参数 | 同 spec | `getDailyQuotes()` 1 处裸调用，无 `params:` |
| V8 只读 | 同 spec | 无写按钮、无编辑控件 |
| V12 视觉 | 人工（TC-ES-01/05） | 文案 / 按钮样式 / 列头 / 行高不变，白底不变 |
| 变异自证 | 本 spec M1/M2 | 注入后**必红**，还原后全绿 |

---

## 5. 发布任务清单

> 发布唯一入口 = skill `web-system-deploy`（内部走 deploy-console MCP 流水线）。本轮**只发 dev admin**，不发 prod。

### 阶段 0 · pre-flight

- [ ] `plan` 预演 dev admin：看 blockers / 风险分 / currentVersion
- [ ] DDL / migration / seed 比对：**不涉及**（零后端、零数据改动）
- [ ] 网关路由比对：`/content/daily-quotes` 为前端路由 → **不涉及**
- [ ] 初始化数据确认：冻结池数据，本轮不 seed → **不涉及**
- [ ] 跨服务常量比对：无新增权限/枚举 → **不涉及**
- [ ] 路由冲突自查：无新增后端静态子路径 → **不涉及**

### 阶段 1 · 后端

**无。** 零后端改动。

### 阶段 2 · 表结构 + 初始化数据 + 权限同步

**无。** 无 DDL、无 seed、无权限常量新增 → 无需同步、无需重启。

### 阶段 3 · 前端 + 指针

- [ ] 取合入后 master commit
- [ ] 发 dev `admin` 模块，指针指向新 commit
- [ ] 校验产物 HTTP 可达：`GET <静态根>/admin/<env>/<commit>/index.js` → 200

### 阶段 4 · 验证

- [ ] `verify_release` 的 `verdict` 通过（🔴 `status=succeeded` ≠ 生效）
- [ ] 产物 grep：新版本 `assets/*.js` 内含「没有匹配的美句」且**空态实现点唯一**
- [ ] 按 §4.3 逐条走查（TC-ES-01…07），重点 01/02/03
- [ ] 免缓存硬刷（`Cmd+Shift+R`）复验

---

## 6. 回滚预案

| 层 | 回滚方式 | 可回滚？ |
|---|---|---|
| 前端 admin（dev） | 发布上一版 `admin` → **`2c37a474`**（本次合入前 dev 版本，即 PR #670 合入版） | ✅ |
| 后端 | **不涉及**（零后端改动） | — |
| DB / migration / seed | **不涉及**，无数据变更 | — |
| 代码 | `git revert <fix commit>`（单 vue + 单 spec + 文档，无依赖冲突） | ✅ |

> 数据不可回滚：不适用（本轮零数据写入）。

---

## 7. 验收标准

| # | 功能点 | 通过标准 | 负责人 |
|---|---|---|---|
| A1 | 单空态（#8993 主体） | 无命中时 DOM `.ant-empty` 数量 === 1，且该块在表格 tbody 占位行内、列头保留 | rd-engineer / tester |
| A2 | 恢复入口仍在 | 唯一空态内「清空筛选与搜索」可点击 → 281 条 / 页码 1 / 三条件复位 | rd-engineer / tester |
| A3 | 加载态不混淆（R-1） | 加载中不出现「没有匹配的美句」；加载完成且无命中才出现 | rd-engineer / tester |
| A4 | 断言升级防再漏 | T5 在未修代码上红（`Received: 2`）；M1/M2 变异全红；还原后全绿 | rd-engineer / reviewer |
| A5 | 回归不回退 | vue-tsc 0 error；jest ≥14/≥166 全绿；eslint 0 error；V8/V9/V10/V11/V12 判据不变 | rd-engineer |
| A6 | dev 生效 | `verify_release` verdict 通过 + 人工 TC-ES-01/02/03 通过 | rd-releaser |

---

## 8. 附录：追溯矩阵

| 需求 | 设计项 | 改动项 | 测试用例 | 发布项 | 验收 |
|---|---|---|---|---|---|
| **#8993 双空态** | §2.1（自定义空态 → `emptyText` 槽；证据 Table.js L428–430 / Body L87–98） | `DailyQuotes.vue` 空态段：删除表格外 `<a-empty>`，改为 `<template #emptyText>` 内 `v-if="!loading"` 的 `<a-empty>` | T5（唯一性）/ T6（点击恢复）+ 人工 TC-ES-01/02 | 阶段 3 发 dev `admin` | A1 → TC-ES-01；A2 → TC-ES-02 |
| **#8993 同源缺口：断言不数数量** | §1.2② / §4.1 | spec：新增 T5/T6；订正 `pageEmptyState()` 定位口径（旧断言全保留） | T5 在未修代码上红；M1 变异红 | — | A4 |
| 167-V9（空态 + 唯一恢复入口 + 清空回 281） | §1.3 / §4.1 | 不改按钮绑定与 `clearFilters` | T1–T4 保留 + T6 | 阶段 4 | A2 / A5 |
| 167-V11（零新请求 / 无伪造参数） | §2.9 | 不触碰 `load()` / `getDailyQuotes()` | 既有 `hasBareGetDailyQuotes` / `hasFabricatedParams` + TC-ES-06 | 阶段 4 产物 grep | A5 |
| 167-V10 / V8（只读无写按钮） | §1.4 Non-goals | 不触碰工具栏 / 抽屉 / 按钮文案 | `daily-quotes.readonly.spec.ts` 白名单 | — | A5 |
| 167-V12（视觉不变） | §3.2 R-2 | 不新增自定义样式 | 人工并排对照 TC-ES-01/05 | 阶段 4 | A5 |
| R-1 加载态 / 无数据混淆 | §3.2 R-1 | 槽内保留 `v-if="!loading"` | TC-ES-03（人工）；T5 只在稳定态断言 | 阶段 4 | A3 |

---

## 附：回填约定

- `PR` / `commitId`：draft PR 与 commit 落地后回填。
- 实施回执：`~/AiWorkspace/30-任务产物/2026-11-17-大橙子小程序NCE交互与登录态整改/175-双空态修复实施回执-2026-11-25.md`。
- 测试用例：本文件 §4.3 矩阵即本轮用例集（改动面仅 1 个空态段，与上一轮 V9 同口径，不另立文档）。

### 凭证口径（供审计）

| trailer | 值 | 依据 |
|---|---|---|
| `Plan` | 本文件 | R18：报告在 commit tree 内 + 头部 `阻塞: 0` |
| `Design` | `pass` | R11 在 `ui_commit` 分支只认字面 `pass`（`gate.ts` L1290 起：path 形式仅 `spec_commit` 分支生效）。**依据是上游已定的设计结论**：本轮「正解」由 lead 在 `ant-design-vue@4.2.6` 源码层坐实（`es/table/Table.js` L428–430 `emptyText` 槽优先级最高、`vc-table/Body/index.js` L87–98 落点），本文件 §2.1 完整复述该证据链，§3.2 补 loading 混淆风险处置。非自签结论，可按 §2.1 逐行复核 |
| `Proto` | `ebcb4420` | R10 要求祖先提交：`ebcb4420`（s36）是 167 稿原型/规格落库的祖先提交，原型 sha `3ac228a0a62df6c8` 与交互（空态 + 唯一恢复入口）自 s36 起未变，本轮不改交互 |
