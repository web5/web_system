# ESLint 门禁与基线报告

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

| 工程 | 告警数 |
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

## 4 用法

```bash
pnpm lint       # 全量检查（不带 --fix，首次接入不自动改存量）
pnpm lint:ci    # CI 口径：--max-warnings 325，超基线即失败
```

需要自动修复时显式加 `--fix`：

```bash
npx eslint apps/portal --fix
```

---

## 5 后续计划（按优先级）

| 优先级 | 事项 | 说明 |
|---|---|---|
| P0 | 修 5 个 error | 尤其 `UserSelect.vue` 的重复 key（已在跑的线上代码） |
| P1 | 显式声明依赖 | 目前靠 hoisted 间接可用，需写入根 `devDependencies` 并更新 lockfile，否则 `pnpm install --frozen-lockfile` 的 CI 不可复现 |
| P1 | 接入 CI | 在 `quality-gate` 加 lint job（改动 `.github/workflows/**` 需过发布/环境动作门） |
| P2 | 收敛 `no-explicit-any` | 283 条，占比 87%；按工程分批，先收 `packages/ui` |
| P2 | 统一 app 级脚本 | `apps/admin`、`apps/portal` 的 `eslint .` 指向根配置，避免规则漂移 |
| P3 | 引入 prettier | 风格类（引号/缩进）交给格式化工具，ESLint 只管正确性 |

---

## 6 演进纪律

1. **新增告警即失败**：`lint:ci` 的 `--max-warnings` 只能**下调**，不得上调（修一批降一批）。
2. 升 error 的规则必须先在本文登记基线数字，确认存量已清零。
3. 关闭规则必须写清理由（如 `vue/multi-word-component-names` 因存量单文件组件名过多而 off）。
