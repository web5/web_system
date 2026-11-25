# admin 每日美句 · V9 空态恢复按钮不渲染 · 修复方案

| 项 | 值 |
|---|---|
| 文档版本 | v1（2026-11-25） |
| 负责人 | rd-engineer |
| 关联需求 | 167 稿 §六 判据 **V9**（`167-admin来源筛选表单需求与原型-2026-11-25.md` 第 309 行）+ V10 / V11 / V8 / V12 不回退 |
| 原型 sha | `3ac228a0a62df6c8`（167 附件 HTML，`shasum -a 256` 实算，沿用 s36 已确认原型，本轮不改交互） |
| 交互清单 | `docs/ui/page-specs/daily-quotes-readonly.md`（沿用，本轮无新增交互） |
| 基线 | `origin/master = ddab1c29`（PR #669 已合入） |
| PR | **#670**（draft）· https://github.com/web5/web_system/pull/670 |
| commitId | `c162cb09`（fix 主体） |

阻塞: 0

> 上一行由门禁机检读取（R18 / R11 `report_header_blocking_zero`，行首锚定 `^阻塞:` —— 故独立成行，不放表格里）。本轮改动为纯前端模板槽位修正 + 测试断言升级，无待决阻塞。

---

## 1. 背景与目标

### 1.1 现象（源码坐实，非推测）

`apps/admin/src/views/Content/DailyQuotes.vue` 第 203–207 行：

```vue
<a-empty v-if="!filtered.length && !loading" description="没有匹配的美句">
  <template #extra>
    <a-button @click="clearFilters">清空筛选与搜索</a-button>
  </template>
</a-empty>
```

选 `NCE4` + 不可能命中的 keyword → 表格区空态出现，但**「清空筛选与搜索」按钮根本不渲染**。V9 要求「空态 + 唯一恢复入口」，实际只剩工具栏的「清空」（第 157 行）一个入口，空态区域是死区。

### 1.2 根因（两层）

**① 渲染层（组件能力误用）**：`ant-design-vue@4.2.6` 的 `Empty` 只消费 3 个槽：

| 位置（`node_modules/ant-design-vue/es/empty/index.js`） | 消费的槽 |
|---|---|
| 第 49 行 | `slots.image` |
| 第 50 行 | `slots.description` |
| 第 81–83 行 | `slots.default` → 渲染进 `<div class="ant-empty-footer">` |

**全文件不存在 `slots.extra`**（`grep -n "slots" es/empty/index.js` 仅返回 36/49/50/81/83 五行）。Vue 对未声明的具名槽静默丢弃 → `<template #extra>` 里的按钮从未进入 vnode 树。

**② 验收层（断言不触达渲染，假绿机制）**：`daily-quotes-source-filter.spec.ts` 第 76–81 行：

```ts
function hasClearButton(s) { return /<a-button[^>]*@click="clearFilters"/.test(s); }
function hasEmptyClearLabel(s) { return /清空筛选与搜索/.test(s); }
```

两条都是**对源码字符串做正则**，只证明「源码里有这段文本」。模板槽失效、按钮不渲染，源码文本一字未变 → 断言照样绿。**不修断言，改完仍是假绿**，这是本次必须一并修的机制根因。

### 1.3 目标

1. 空态区域内渲染出可点击的「清空筛选与搜索」按钮（`slots.default` 路径）。
2. 点击后：`filtered` 回 281 条、页码回 1、册别/课号/keyword 三条件全复位（V9 原文判据）。
3. 断言升级为**真实渲染态**：挂载生产 SFC，按渲染后的 DOM 找按钮、点按钮、验状态；模板槽一旦失效立即变红。
4. 变异自证：M1/M2/M3 三组注入 bug 必须让新用例变红，证明断言不是摆设。

### 1.4 Non-goals（明确不做）

- ❌ 不动工具栏第 157 行 `<a-button @click="clearFilters">清空</a-button>`（已有真实兜底，V10 白名单已含）。
- ❌ 不动第 238 行抽屉内 `<a-empty v-else description="未取到美句数据" />`（preview 为 falsy 时兜底，与表格区空态不同时出现）。
- ❌ **不合并两个空态**（前一轮「两空态叠加」结论经一手核实不成立，不按该结论改）。
- ❌ 不改筛选 / 分页 / 搜索逻辑（`filtered` / `paged` / `onFilterChange` / `onPageChange` 零改动）。
- ❌ 不改接口、DB、migration、seed；不加新功能；不改视觉风格（`#F97316` 仍不作正文色，白底不变）。
- ❌ 不自造 overlay / 不用 `#extra` 之外的替代补丁（如 `description` 拼 HTML、`v-html`）。

---

## 2. 方案设计（九子项）

### 2.1 架构与数据流

改动为单点模板槽位迁移，不引入新模块、新调用链。

**改动前（按钮丢失）**

```
script: clearFilters() ──┐
                         │  <a-button @click="clearFilters">  ← 写在 <template #extra>
template: <a-empty>      │
  └─ #extra 槽 ──────────┘
       ↓
Empty.render(): 读 slots.image / slots.description / slots.default（empty/index.js L49/50/81）
       ↓
#extra 未被读取 → 静默丢弃 → 空态 DOM 里无按钮（`.ant-empty` 下只有 image + description）
```

**改动后（按钮落进 footer）**

```
template: <a-empty description="没有匹配的美句">
  └─ 默认槽（子节点）<a-button @click="clearFilters">清空筛选与搜索</a-button>
       ↓
Empty.render(): slots.default 存在 → 渲染 <div class="ant-empty-footer">{按钮}</div>（L81–83）
       ↓
DOM: .ant-empty > .ant-empty-image / .ant-empty-description / .ant-empty-footer > button
       ↓
点击 button → clearFilters() → bookFilter='ALL' / lessonFilter='' / keyword='' / page=1
       ↓
filtered 重新包含全部 281 条（纯 computed，**不触发任何请求**）
```

数据流不变：`getDailyQuotes()` 整池一次拉回 → `filtered`（客户端 AND 过滤）→ `paged`（20 条/页客户端切片）。本次只改「空态 DOM 长什么样」。

### 2.2 页面清单（含菜单）

| 页面 | 路由 | 职责 | 权限门控 | 本轮改动 |
|---|---|---|---|---|
| 每日美句 | `/content/daily-quotes` | 服务端冻结池只读查看（列表 + 详情抽屉） | `content:view` | **仅**表格区空态段（DailyQuotes.vue 203–207） |

无新增页面、无菜单变更（`BasicLayout.vue` 与 `router/index.ts` 零改动）。

### 2.3 接口清单

**零接口改动。** 无新增、无变更、无删除：

| 方法 | 路径 | 入参 | 出参 | 鉴权 | 本轮 |
|---|---|---|---|---|---|
| GET | `/content-admin/nce/daily-quotes` | 无 | `{ version, count, items[] }` | 用户 JWT | 不变（`getDailyQuotes()` 裸调用，仍为 1 处） |

### 2.4 数据结构

无。表 / 字段 / 索引零增改，**无 DDL 发布**。

### 2.5 配置清单

无。网关路由、部署路径、环境变量、第三方凭证全部沿用。

### 2.6 依赖系统或接口

| 依赖对象 | 类型 | 强/弱 | 缺失/错误后果 | 本轮处置 |
|---|---|---|---|---|
| `ant-design-vue@4.2.6` Empty 槽能力 | 前端库 | **强** | 用未支持的槽 → **静默丢弃，无告警**（本次缺陷本体） | 改用受支持的 `slots.default`；版本不变、不升级、不加 polyfill |
| `@vue/compiler-sfc@3.5.31` | 测试期 | 弱 | 渲染态用例无法编译 SFC | 仓库既有依赖（`daily-quotes.readonly.spec.ts` 已在用），不新增 |
| 后端 `getDailyQuotes` | 内部 | 强 | 整池取不到 → 走失败态（`failed`），与空态无关 | 不变 |

> 依赖结论：**不新增任何依赖、不改 lockfile、不改 jest 配置**。

### 2.7 初始化数据 / 种子数据

无。美句池是服务端冻结数据（281 条），本轮不 seed。

### 2.8 权限模型

无变更。`content:view` 语义、授予角色、定义位置全部不动。

### 2.9 接口设计约束（V11 硬约束）

本轮零接口改动，但必须保持既有约束不回退：

- **V11-a 零新请求**：筛选/搜索/清空全程不发请求（`getDailyQuotes()` 仅 `onMounted` 与「刷新」调用）。
- **V11-b 无伪造参数**：`getDailyQuotes()` 保持裸调用，**无** `?book=` / `?lessonId=` / `?keyword=`，无 `params:`。
- 本轮改动不触碰 `load()` / `getDailyQuotes()`，上述两条由既有源码守卫继续兜住。

---

## 3. 影响面与风险

### 3.1 改动范围矩阵

| 层 | 文件 | 改动性质 | 行数规模 |
|---|---|---|---|
| 前端模板 | `apps/admin/src/views/Content/DailyQuotes.vue` | 空态段槽位迁移（`#extra` → 默认槽） | 203–207，约 5 行 |
| 前端测试 | `apps/admin/src/views/Content/daily-quotes-source-filter.spec.ts` | **新增** `describe` 渲染态用例组（旧源码断言**保留不动**） | 追加约 150 行 |
| 文档 | 本文件 | 新增 | — |
| 后端 / DB / migration / seed / 配置 / 权限 | — | **零改动** | 0 |

### 3.2 风险分级

**低**。纯前端渲染槽位修正：

- 无数据写入、无接口调用、无权限变更 → 无数据风险；
- 改动面限 1 个空态分支，正常有数据路径零关联；
- 回滚成本 = 单文件 `git revert`。

| 风险 | 等级 | 缓解 |
|---|---|---|
| 按钮移入默认槽后视觉位置变化（`.ant-empty-footer` 有默认上间距） | 低 | V12 要求白底 / 字号 / 布局不变；`.ant-empty-footer` 是 antd 空态既有布局位，不新增自定义样式 |
| 新渲染态用例引入 SFC 运行时编译，可能拖慢 jest | 低 | 单文件 4 个用例；对比现有 14 suites 约 49s 基线可接受 |
| 新增用例若仍不触达渲染 → 假绿复发 | 中 | **变异 3 组（M1/M2/M3）必须全红**，红阶段必须先在未修代码上失败 |

### 3.3 兼容性

向前 / 向后均兼容：无接口、无数据结构、无配置变更；老浏览器行为不变（Vue 运行时行为不变，仅 vnode 子节点位置调整）。

### 3.4 灰度

不灰度。dev 环境验证后按常规发布流程推进；本轮**不发 prod**。

---

## 4. 测试方案

### 4.1 单元测试

**旧断言为何失效（必须先说清）**：`daily-quotes-source-filter.spec.ts` 现有守卫全部吃「源码字符串」——

```ts
hasClearButton(s)      → /<a-button[^>]*@click="clearFilters"/.test(s)
hasEmptyClearLabel(s)  → /清空筛选与搜索/.test(s)
```

`<template #extra>` 里的按钮文本与 `@click` 属**源码存在但渲染不存在**，正则无法区分。故 V9 在此断言下永远绿。

**新增用例（渲染态）**：在 `daily-quotes-source-filter.spec.ts` 追加独立 `describe` 块，走**真实组件挂载**：

| 用例 | 断言（全部针对渲染后 DOM，不读源码字符串） |
|---|---|
| T1 空态渲染 | 构造 `bookFilter=NCE4` + 不可能 keyword → `.ant-empty` 存在，`.ant-empty-description` 文案 = 「没有匹配的美句」 |
| T2 恢复入口存在 | `.ant-empty` **区域内**存在可点击按钮，文案 = 「清空筛选与搜索」（`emptyEl.querySelector` 范围限定，不是全页搜） |
| T3 点击恢复 | 点击该按钮 → 空态消失、`共 281 条`、当前页 = 1、册别回「全部」、课号空、keyword 空 |

**挂载方式说明（如实交代）**：仓库未装 `@vue/test-utils`，且 `apps/admin/jest.config.cjs` 把 `\.vue$` 映射为空模块桩。为避免改jest 配置 / 加依赖（触碰共享测试基建面），采用**仓库既有模式**（`daily-quotes.readonly.spec.ts` 已用 `@vue/compiler-sfc`）：测试内 `parse + compileScript + compileTemplate` 编译生产 SFC，用 Vue 原生 `createApp` + `app.use(Antd)` 挂到 jsdom 容器，断言打在真实渲染 DOM 上。**测的是同一个生产文件，不是副本**；M1 变异（改回 `#extra`）即可验证该 harness 确实触达渲染。

### 4.2 接口 / 集成测试

不涉及。零接口改动；V11 由既有源码守卫（`hasBareGetDailyQuotes` / `hasFabricatedParams`）继续兜。

### 4.3 功能测试用例矩阵

| 用例ID | 模块 | 场景 | 前置条件 | 步骤 | 预期结果 | 环境 |
|---|---|---|---|---|---|---|
| TC-V9-01 | 每日美句 | 叠加筛选无命中 → 空态出现 | 已登录取 `content:view`；整池 281 条已加载 | ① 册别选 `NCE4` ② keyword 输 `zzzzz-no-hit` | 表格区 `a-empty` 出现，文案「没有匹配的美句」 | dev |
| TC-V9-02 | 每日美句 | 空态区**唯一恢复入口**渲染 | 承接 01 | 观察空态区域 | 空态区出现可点击按钮「清空筛选与搜索」（**非** `#extra` 丢弃态） | dev |
| TC-V9-03 | 每日美句 | 点按钮恢复 | 承接 02；先把页码翻到第 2 页再触发无命中 | 点「清空筛选与搜索」 | 空态消失；计数 `共 281 条`；页码回 1；册别回「全部」、课号空、keyword 空 | dev |
| TC-V9-04 | 每日美句 | 零新请求（V11） | 承接 03，开 DevTools Network | 观察筛选/清空全程 | daily-quotes **零新请求**；无 `?book=`/`?lessonId=`/`?keyword=` | dev |
| TC-V9-05 | 每日美句 | 只读不回退（V8/V10） | 承接 03 | DOM 审计按钮文案 | 仅 预览/关闭/刷新/重试/清空/清空筛选与搜索；写按钮 0 | dev |
| TC-V9-06 | 每日美句 | 抽屉空态不受影响 | 承接 03 | 打开/关闭抽屉 | 抽屉空态「未取到美句数据」仍在，未被本次改动影响 | dev |

### 4.4 回归范围

| 项 | 命令 | 通过标准 |
|---|---|---|
| 类型检查 | `pnpm --filter admin exec vue-tsc --noEmit` | 0 error |
| 单元测试全量 | `pnpm --filter admin exec jest --rootDir . --config jest.config.cjs` | ≥14 suites / ≥162 tests 全绿（基线 14/161 + 新增） |
| Lint | `pnpm --filter admin exec eslint .` | 0 error |
| V10 按钮白名单 | `daily-quotes.readonly.spec.ts` | 含「清空筛选与搜索」，无写按钮 |
| V11 零新请求 / 无伪造参数 | 同 spec | `getDailyQuotes()` 1 处裸调用，无 `params:` |
| V8 只读 | 同 spec | 无写按钮、表格内无编辑控件 |
| V12 视觉 | 人工 | 白底、字号、表格、抽屉、四态不变；`#F97316` 未作正文色 |
| 变异自证 | 本 spec 新增 describe | M1/M2/M3 三组注入后**必红** |

---

## 5. 发布任务清单

> 发布唯一入口 = skill `web-system-deploy`（内部走 deploy-console MCP 流水线）。本轮**只发 dev admin**，不发 prod。

### 阶段 0 · pre-flight

- [ ] `plan` 预演 dev admin：看 blockers / 风险分 / currentVersion（预期 currentVersion = `c9684908`）
- [ ] 确认无可变基础设施差异（**无** DDL / 无 migration / 无 seed → 表结构比对**不涉及**）
- [ ] 网关路由比对：`/content/daily-quotes` 为前端路由，网关零改动 → **不涉及**
- [ ] 初始化数据确认：美句池为服务端冻结数据，本轮不 seed → **不涉及**
- [ ] 跨服务常量比对：无新增权限/枚举 → **不涉及**
- [ ] 路由冲突自查：无新增后端静态子路径 → **不涉及**

### 阶段 1 · 后端

**无。** 零后端改动（接口、控制器、服务均不动）。

### 阶段 2 · 表结构 + 初始化数据 + 权限同步

**无。** 无 DDL、无 seed、无权限常量新增 → 无需同步、无需重启。

### 阶段 3 · 前端 + 指针

- [ ] 合入后取 master commit（本 PR 合入 commit）
- [ ] 发 dev `admin` 模块，指针指向新 commit
- [ ] 确认部署产物目录出现新版本目录

### 阶段 4 · 验证

- [ ] `verify_release` 的 `verdict` 通过（🔴 `status=succeeded` ≠ 生效，唯一判据是 verdict）
- [ ] dev 打开 `/content/daily-quotes` → 路由 200，页面可渲染
- [ ] 部署产物 grep：新版本 `assets/*.js` 内含「清空筛选与搜索」
- [ ] **V9 人工点击**：NCE4 + 不可能 keyword → 空态出现 → 按钮在 → 点击 → 281 / 页码 1 / 三条件复位
- [ ] 免缓存硬刷（`Cmd+Shift+R`）后复验，排除 manifest 缓存误判

---

## 6. 回滚预案

| 层 | 回滚方式 | 可回滚？ |
|---|---|---|
| 前端 admin（dev） | 发布上一版 `admin` → **`c9684908`**（11-25 10:32:54，170 稿订正后的真实上一版） | ✅ 可回滚 |
| 后端 | **不涉及**（零后端改动） | — |
| DB / migration / seed | **不涉及**，无数据变更 | — |
| 代码 | `git revert <fix commit>`（单文件 + spec，无依赖冲突） | ✅ |

> 🔴 订正提醒（170 稿）：admin 上一版是 **`c9684908`**。**不要写 `b6ec9950`** —— 那是 11-09 的无关旧版（portal 当前版本），真回滚会退到错版本。
>
> 数据不可回滚：不适用（本轮无任何数据写入）。

---

## 7. 验收标准

| # | 功能点 | 通过标准 | 负责人 |
|---|---|---|---|
| A1 | V9 空态出现 | NCE4 + 不可能 keyword → 表格区空态 + 文案「没有匹配的美句」 | rd-engineer（自测）/ tester（验收） |
| A2 | V9 唯一恢复入口渲染 | 空态区域内存在可点击「清空筛选与搜索」按钮（DOM 级存在，非源码级） | rd-engineer / tester |
| A3 | V9 点击恢复 | 点击后 281 条、页码 1、册别/课号/keyword 三条件复位 | rd-engineer / tester |
| A4 | 断言升级（防假绿） | 新增渲染态用例可捕捉模板槽失效：M1/M2/M3 三组变异**全红**，还原后全绿 | rd-engineer / reviewer |
| A5 | 回归不回退 | vue-tsc 0 error；jest ≥14 suites/≥162 tests 全绿；eslint 0 error；V8/V10/V11/V12 判据不变 | rd-engineer |
| A6 | dev 生效 | `verify_release` verdict 通过 + 人工点击通过 | rd-releaser |

---

## 8. 附录：追溯矩阵

| 需求 | 设计 | 改动 | 用例 | 发布 | 验收 |
|---|---|---|---|---|---|
| 167-V9（空态 + 唯一恢复入口 + 清空回 281） | §2.1 Empty 槽渲染链（`slots.default` → `.ant-empty-footer`） | `DailyQuotes.vue` 203–207：`<template #extra>` → 默认槽子节点 | 新增渲染态 T1/T2/T3（`daily-quotes-source-filter.spec.ts`）；人工 TC-V9-01/02/03 | 阶段 3 发 dev admin | A1 / A2 / A3 → TC-V9-01/02/03 |
| 167-V11（零新请求 / 无伪造参数） | §2.9 | 不触碰 `load()` / `getDailyQuotes()` | 既有 `hasBareGetDailyQuotes` / `hasFabricatedParams` | 阶段 4 产物 grep | A5 → TC-V9-04 |
| 167-V10 / V8（只读无写按钮） | §1.4 Non-goals | 不触碰工具栏 / 抽屉；不改按钮文案 | `daily-quotes.readonly.spec.ts` 白名单 | — | A5 → TC-V9-05 |
| 167-V12（白底视觉不变） | §3.2 | 不新增自定义样式，用 antd 既有 `.ant-empty-footer` | 人工并排对照 | 阶段 4 | A5 → TC-V9-06 |
| 断言假绿机制（验收层根因） | §4.1 | spec 追加渲染态 describe（旧源码断言保留） | M1/M2/M3 变异自证 | — | A4 |

---

## 附：待填项回填约定

- `PR` 字段：draft PR 创建后回填 PR 号 + 链接。
- `commitId` 字段：commit 后回填。
- 回执：`~/AiWorkspace/30-任务产物/2026-11-17-大橙子小程序NCE交互与登录态整改/173-V9空态修复实施回执-2026-11-25.md`
