# 测试用例 · admin「每日美句」来源筛选表单（s36 / 167 稿 V1–V13）

> 关联方案：`docs/development/reports/2026-11-25-admin-source-filter-方案.md`
> TDD spec：`apps/admin/src/views/Content/daily-quotes-source-filter.spec.ts`（新增）；`apps/admin/src/views/Content/daily-quotes.readonly.spec.ts`（V8 用例按 §1.6 边界更新）
> 数据基准：dev v2 冻结池 `version=2 / count=281 / NCE2:136 NCE3:80 NCE4:65`（一手 curl 复验）

## 一、验证判据 V1–V13 用例矩阵

| # | 判据 | 方法 | 预期 | 实测证据 |
|---|---|---|---|---|
| V1 | 册别下拉恰好四选项 | spec `selectOptionValues` / DOM | `ALL,NCE2,NCE3,NCE4`，无第五项 | ✅ spec 断言 `['ALL','NCE2','NCE3','NCE4']` 通过 |
| V2 | 选 NCE2 → 仅 NCE2 + 计数 136 | 复刻 filtered 跑 v2 真实池 | 全 NCE2 / 136 | ✅ `book=NCE2 → 136, allMatch=true` |
| V3 | 选 NCE3 → 80 | 同上 | 全 NCE3 / 80 | ✅ `book=NCE3 → 80, allMatch=true` |
| V4 | 选 NCE4 → 65 | 同上 | 全 NCE4 / 65 | ✅ `book=NCE4 → 65, allMatch=true` |
| V5 | 选「全部」→ 281 | 同上 | 三册混合 / 281 | ✅ `book=ALL → 281` |
| V6 | 课号可选输入、客户端 includes、无区间 | 输入 `3` / 不存在课号 | 命中 L3/L31 等；无命中空态；无 min/max | ✅ `lesson=3 → 56, allContains3=true`；`lesson=999999 → 0`；仅 1 个课号输入 |
| V7 | 筛选与 keyword 为 AND | NCE2 + `Sundays` | 只显示同时满足的行 | ✅ `AND(NCE2+Sundays) → 1, allNCE2=true` |
| V8 | 页码重置第 1 页 | spec + 变异③ | 筛选变化 page=1；变异后面码守卫红 | ✅ `onFilterChange`/`@change` 接线，spec 通过；变异③红→还原绿 |
| V9 | 叠加空态 + 唯一清空入口 + 清空回 281 | NCE4 + 不可能 keyword → 清空 | 空态；清空后 281/page=1/三条件复位 | ✅ `empty(NCE4+bogus) → 0`；`clearFilters()` 复位三条件 + 页码，spec 断言通过 |
| V10 | 只读无写按钮（§1.6 语义放行） | s28 AST 审计 + 新 spec + 变异② | 写按钮 0；表格内编辑控件 0；查询 select/课号 input 放行 | ✅ 161/161 测试通过；变异②注入编辑按钮 → 两个守卫均红 |
| V11 | 未伪造接口参数 | spec `hasFabricatedParams` / s28 AST | 零新请求；getDailyQuotes() 裸调用 | ✅ `hasBareGetDailyQuotes=true`、`hasFabricatedParams=false`；s28 断言 `getDailyQuotes()` 仅 1 次、无 `params:` |
| V12 | 视觉一致性 | token 对照 §5.4 | 白底/字号/表格/抽屉一致；品牌橙未作正文 | ✅ 沿用现页 token（`#F97316` 仅交互/边框，`#EA580C` 仅强调），工具条 flex-wrap + 分隔线，未新增裸 hex/`!important` |
| V13 | 新 Proto sha 可机检 | `shasum -a 256` + 机检脚本 | sha=`3ac228a0a…f7a45a00`，≠ `ee0c6bc5…`；机检 ✔ | ✅ sha256 `3ac228a0a62df6c8…f7a45a00`；机检脚本输出「演示控件机检通过」 |

## 二、TDD 变异红绿（真实文件，至少 3 组）

| 变异 | 手法 | 红证据 | 还原绿证据 |
|---|---|---|---|
| ① 册别 AND 漏加 | 真实文件把 `bookFilter.value==='ALL' \|\| item.source.book===bookFilter.value` 改成 `true` | `daily-quotes-source-filter.spec.ts`：`filtered 同时含…三个 AND 条件` ✕ → **1 failed / 8 passed** | 还原后 **9 passed** |
| ② 注入编辑按钮 | 表格操作列注入 `<a-button>编辑</a-button>` | 新 spec `V8 只读` ✕ + s28 `daily-quotes.readonly.spec.ts` 写按钮白名单 ✕ → **2 failed / 18 passed** | 还原后 **20 passed** |
| ③ 页码不重置 | `onFilterChange()` 去掉 `page.value = 1` | `筛选变化重置第 1 页` ✕ → **1 failed / 8 passed** | 还原后 **9 passed** |

> 三组变异均作用于**真实生产文件**（非夹具），注入→红、还原→绿；另 spec 内置三组夹具变异自证检测器有效。evidence 日志：`/tmp/s36_mut{1,2,3}_{red,green}.log`（本机临时，不入仓）。

## 三、静态质量门

| 门 | 命令 | 结果 |
|---|---|---|
| 全量单测 | `jest --rootDir apps/admin --config apps/admin/jest.config.cjs` | ✅ 14 suites / 161 tests passed |
| 类型检查 | `vue-tsc -p apps/admin/tsconfig.json --noEmit` | ✅ exit 0 |
| lint | `eslint <改动文件>` | ✅ exit 0 |
| 测试禁绝对路径硬编码 | grep `/Users/geekwen` on spec/vue | ✅ CLEAN |
| 红线门禁（commit-msg） | git commit 自动触发 | ✅ 0 error / 0 warning |

## 四、测试范围说明

改动面仅 `apps/admin/src/views/Content/*`（单视图文件，非 §test_surface 共享面），按 process-gate §5 只跑 admin 包全量单测，未跑 `pnpm -r test` 全仓；不请示全量。
