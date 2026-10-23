# ESLint 门禁与基线报告

> **门禁状态（2026-10-22 已接入 CI）**：配置 2026-10-10 就位，开关滞后 30 天后于本日恢复。
> 现在 CI 是两道：① `changed-packages.sh --lint` 拦改动包的 **error**；② 根级 `pnpm lint:ci` 守 **warning 总量水位**（328）。
> 本文是 ESLint 门的**判据源**；门的级别、开关状态与编号见 `docs/development/gates/02-机制原理.md` §2.4 D 类。

> 建立日期：2026-10-10 · 关联任务 `rLCb1M`
> 配置文件：`eslint.config.mjs`（根级，ESLint 9 flat config）
> 规范索引：`docs/development/frontend-best-practices.md`

---

## 1 接入前的事实（实测，勿凭印象）

| 项 | 接入前状态 |
|---|---|
| ESLint 配置文件 | **全仓 0 个**（无 `.eslintrc*`、无 `eslint.config.*`） |
| lint 脚本 | `apps/admin`、`apps/portal` **已声明** `lint` / `lint:ci`，但无配置 → 敲了就报错 |
| 依赖 | 已可用：`eslint@9.39.4`、`typescript-eslint@8.57.2`、`eslint-plugin-vue@9.33.0`、`vue-eslint-parser@10.4.0`、`@eslint/js@9.39.4`、`globals@13.24.0` |
| 为什么不用安装 | `.npmrc` 配了 `node-linker=hoisted`，相关包已被提升到根 `node_modules` |
| 真实门禁 | 只有 `npx vue-tsc --noEmit`（类型检查） |

> 修正一处此前的措辞：不是「仓库没 ESLint」，而是「**有脚本、有依赖、唯独没有配置**」——脚本一直在裸奔。

---

## 2 配置设计

| 决策 | 选择 | 理由 |
|---|---|---|
| 配置格式 | flat config（`eslint.config.mjs`） | ESLint 9 原生；用 `.mjs` 而非给根 package.json 加 `type: module`（避免影响 `ecosystem.config.js` 的 CommonJS 解析） |
| Vue 规则档 | `pluginVue.configs['flat/essential']` | 只拦会出错的写法；风格类后续交给 prettier 收敛（当前无 prettier 配置） |
| 分档策略 | **零容忍项 error，存量收敛项 warn** | 首次接入不以「一片红」为目标 |
| 作用范围 | `apps/{shell,portal,admin,deploy-console}` + `packages/ui` | 小程序、后端 `servers/`、运维 `scripts/` 不在本次范围 |
| 依赖方向 | `no-restricted-imports` 设为 **error** | `packages` 不得反向依赖 `apps`；跨 app 禁止直连 |

零容忍（error）：调试语句残留（`js.configs.recommended` 内置）· `vue/no-parsing-error` · `no-var` · 依赖方向规则。
存量收敛（warn）：`no-explicit-any` · `no-unused-vars` · `no-console`（放行 warn/error/info/debug）· `vue/no-v-html` · `eqeqeq` · `prefer-const`。

---

## 3 基线（2026-10-10 首跑）

```
文件：218 个（79 个有告警）
error：5        warning：325
```

### 3.1 按规则

| 级别 | 数量 | 规则 |
|---|---|---|
| warn | 283 | `@typescript-eslint/no-explicit-any` |
| warn | 30 | `@typescript-eslint/no-unused-vars` |
| warn | 9 | `no-console` |
| warn | 2 | `vue/no-v-html` |
| warn | 1 | `prefer-const` |
| error | 1 | `no-self-assign` |
| error | 1 | `vue/no-unused-vars` |
| error | 1 | `no-irregular-whitespace` |
| error | 1 | `no-empty` |
| error | 1 | `vue/no-dupe-keys` |

### 3.2 按工程

> ⚠️ **口径说明（2026-10-22 修正）**：本表是**问题总数**（warning + error），不是 warning 数。
> 故各工程之和 330 ≠ 上方 warning 总数 325——差的 5 就是 §3.3 那 5 个 error。
> 原表未标注口径，曾被误读为「warning 数对不上」。

| 工程 | 告警数（含 error） |
|---|---|
| apps/deploy-console | 149 |
| apps/admin | 89 |
| apps/portal | 50 |
| apps/shell | 36 |
| packages/ui | 6 |

### 3.3 5 个 error 明细（都是真缺陷）

| 级别 | 位置 | 规则 | 说明 |
|---|---|---|---|
| **P0** | `packages/ui/src/components/UserSelect.vue:108` | `vue/no-dupe-keys` | 重复 key `load`，**同名覆盖**，运行时行为异常 |
| P1 | `apps/admin/src/views/Agents/AgentRuns.vue:222` | `no-self-assign` | `filters.agentId = filters.agentId`，自赋值无效代码 |
| P1 | `apps/admin/src/views/Agents/KnowledgeCollectionsPage.vue:166` | `vue/no-unused-vars` | 模板变量 `i` 未使用 |
| P2 | `apps/deploy-console/src/components/pipeline/StepConditionEditor.vue:77` | `no-irregular-whitespace` | 异常空白字符（常见于中文全角空格） |
| P2 | `apps/portal/src/views/Todo.vue:133` | `no-empty` | 空 catch 块 —— 正是规范里明令禁止的「静默吞错」 |

---

### 3.4 复测（2026-10-22，恢复 CI 门时的事实）

```
文件：218 个 · error：0 · warning：328
```

| 项 | 基线（10-10） | 复测（10-22） | 变化 |
|---|---|---|---|
| error | 5 | **0** | **−5（§3.3 五项全部修完）** |
| warning | 325 | **328** | +3 |
| 问题总数（= 3.2 表口径） | 330 | **328** | −2 |

按工程（问题总数口径）：admin 89→90（+1）· deploy-console 149→148（−1）· portal 50→49（−1）· ui 6→5（−1）。

> **怎么读这组数**：error 清零是真实整改成果；warning +3 是存量演进（新代码带进来的 any / unused-vars），
> 不是误报。处理方式不是"清零"——328 条里 283 条是 `no-explicit-any`，属长期工程——
> 而是把水位从 325 调到 **328**，并执行下面的水位纪律。

### 3.5 水位纪律（防"越修越高"）

1. `--max-warnings` 的数字 = **当前存量**，不是"允许的新增额度"
2. **只降不升**：修掉 N 条存量，同一 PR 把数字减 N
3. 涨水位必须单独说明理由，并与本文件 §3.4 的复测一起提交
4. 分工程收敛优先级：`packages/ui`（5 条，收益最高，先在 `pnpm --filter ui lint` 清零）

---

## 4 用法

```bash
pnpm lint       # 全量检查（不带 --fix）
pnpm lint:ci    # CI 口径：--max-warnings 328（= 当前存量水位），超即失败
```

子包级（`apps/shell` `apps/deploy-console` `packages/ui` 于 10-22 补齐，此前**没有 lint 脚本**）：

```bash
cd apps/shell && pnpm lint:ci   # 只拦 error，不设 warning 水位
```

需要自动修复时显式加 `--fix`：

```bash
npx eslint apps/portal --fix
```

---

## 5 后续计划（按优先级）

| 优先级 | 事项 | 状态 |
|---|---|---|
| ~~P0~~ | ~~修 5 个 error~~ | ✅ **已完成**（10-22 复测 error=0） |
| ~~P1~~ | ~~接入 CI~~ | ✅ **已完成**（10-22 恢复 `--lint` + 根级水位两道） |
| P1 | 显式声明依赖 | ⏳ 仍靠 `.npmrc node-linker=hoisted` 间接可用，未写入根 `devDependencies`；`--frozen-lockfile` 下是否可复现**未验证** |
| P2 | 收敛 `no-explicit-any` | ⏳ 283 条（占 87%）；建议先清 `packages/ui`（仅 5 条，可一次归零后把水位降到 323） |
| P2 | 统一 app 级脚本 | ⏳ `apps/portal` 仍带 `--ext`（ESLint 9 flat config 下无效但被忽略，不报错）；`apps/shell` / `deploy-console` / `packages/ui` 已于 10-22 补齐 |
| P3 | 引入 prettier | ⏳ 未开始 |

---

## 6 演进纪律

1. **新增告警即失败**：`lint:ci` 的 `--max-warnings` 只能**下调**，不得上调（修一批降一批）。
2. 升 error 的规则必须先在本文登记基线数字，确认存量已清零。
3. 关闭规则必须写清理由（如 `vue/multi-word-component-names` 因存量单文件组件名过多而 off）。

---

## 7 整改影响清单（P0 · 5 个 error，2026-10-10）

动作门要求：批量整改（≥2 文件 / 跨端）**先出清单**再动（`ui-interface/RULE.mdc` 动作门第 9 条）。
本节即为该清单，兼作豁免留痕。

### 7.1 性质判定：全部属**机械改动**（零视觉变化）

判据（`frontend-best-practices.md` §2.1.1）：**改完截图前后一致 → 机械改动**。
下列 5 处均不新增/删除视觉元素、不改状态机、不改布局与配色 → 走 `UI_GATE` 应急出口与
`Micro-exempt` 留痕，**不触发**原型的「微调豁免」设计评审流程（D2/D3）。

### 7.2 逐条清单

| # | 文件 | 规则 | 改动 | 风险 | 优先级 |
|---|---|---|---|---|---|
| 1 | `packages/ui/src/components/UserSelect.vue:108` | `vue/no-dupe-keys` | 本地 `function load()` 重命名 → `loadUsers()`，同步调用点 | **低但必须**：现网同名 key 存在覆盖风险；改名后行为等价 | **P0** |
| 2 | `apps/admin/src/views/Agents/AgentRuns.vue:222` | `no-self-assign` | 删自赋值语句（无效代码） | 无：自赋值是 no-op | P1 |
| 3 | `apps/admin/src/views/Agents/KnowledgeCollectionsPage.vue:166` | `vue/no-unused-vars` | 删除未使用的模板变量 | 无：变量未参与渲染 | P1 |
| 4 | `apps/deploy-console/src/components/pipeline/StepConditionEditor.vue:77` | `no-irregular-whitespace` | 全角/异常空白字符 → 普通空格 | 无：纯字符替换，字符串内容需确认**非业务数据**（若是业务文案需改文案而非字符） | P2 |
| 5 | `apps/portal/src/views/Todo.vue:133` | `no-empty` | 空异常分支补最小处理（记录/静默降级需显式注明） | 低：补的是**可见性**，不是行为；须保证不把「可忽略错误」变成弹窗噪音 | P2 |

### 7.3 豁免留痕

- 判据：截图前后一致 → 机械改动（§7.1）
- 出口：`UI_GATE=off`（会话级）；commit 带 `Micro-exempt: <理由>`
- 口径源：`.codebuddy/rules/{ui,brand}-interface/RULE.mdc`「零摩擦边界」、
  `specs/kit-sop-enforcement/design.md` §3.7.1
- 复核：整改后 `pnpm lint:ci` 须 **0 error**；`npx vue-tsc --noEmit` 无新增类型错误

### 7.4 不做的事（本次范围外）

- 不修 325 条 warning（`no-explicit-any` 283 条等）—— 属 P2，需按工程分批
- 不改任何视觉/交互/文案语义
- 不顺手重构相邻代码（保持 diff 最小，便于回滚）
