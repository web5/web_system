# 测试用例 · admin 每日美句只读查看 UI

> Test: pass
> 关联方案: `docs/development/reports/2026-11-25-admin-daily-quotes-ui-方案.md`
> 需求真源: 157 稿（§七 V1–V12 / §八 用例矩阵）；原型凭证 `Proto: ee0c6bc5d6ce8405` / `Design: pass`

## 0. 测试分层

| 层 | 载体 | 覆盖 | 结果 |
|---|---|---|---|
| 契约单测 | `apps/admin/src/api/nce.daily-quotes.spec.ts` | GET 路径精确、无伪造参数、返回 data 本体 | PASS（2/2） |
| 静态 + DOM 机检 | `apps/admin/src/views/Content/daily-quotes.readonly.spec.ts` | 生产 SFC AST → jsdom DOM + compileTemplate 产物；五列/抽屉/搜索/分页/三处接线 | PASS（10/10） |
| 包级回归 | `pnpm --filter admin exec jest --maxWorkers=2` | admin 全包（含路由守卫/拦截器回归） | PASS（13 suites / 151 tests） |
| 类型 / lint | `vue-tsc --noEmit` / `eslint` | V4 + 变更文件 | PASS（0 error） |

> 测试脚本只用 `__dirname` 推导路径，无本机绝对路径硬编码。

## 1. 功能用例（对应 157 稿 §八）

| 用例ID | 模块 | 场景 | 前置 | 步骤 | 预期 | 自动化对应 |
|---|---|---|---|---|---|---|
| TC-01 | 入口 | 主路径 | 持 `content:view` | 点侧栏「每日美句」→ 进列表 | 接口 GET 整池 200；stat 显示 count/version；分页 total=136；骨架→数据 | readonly.spec（路由/菜单/五列） |
| TC-02 | 抽屉 | 来源核对 | 列表已加载 | 点任一行「预览」 | 抽屉 width 900；cn/en + `source.book/lessonId/title/lineIndex` 四字段全名；版权注记；仅「关闭」 | readonly.spec（抽屉断言） |
| TC-03 | 搜索 | 命中/落空 | 整池在 | 输入 `Sundays` → 再输 `zzzz` | 前者命中；后者空态 + 「清空搜索」唯一恢复入口 | readonly.spec（四字段过滤 + 清空按钮白名单） |
| TC-04 | 分页 | 翻页/改每页 | 136 条在 | 翻至第 7 页 / 切 50 条每页 | `slice` 客户端切片，无重复漏行；接口无 `?page` | readonly.spec（`slice` / 无 params 断言） |
| TC-05 | 异常 | 接口失败 | 拦截返回 500/断网 | 进页 | 错误态 + 「重试」；不显示伪数据、不白屏 | readonly.spec（failed / 重试按钮） |
| TC-06 | 权限 | 无权限 | 不持 `content:view` | 看菜单 + 直达路由 | 侧栏子菜单整组不可见；直达落 `/403` | readonly.spec（meta.permission + 三处接线） |
| TC-07 | 只读 | 写按钮审计 | 页面/抽屉打开 | 扫 AST 所有按钮 + jsdom DOM + 编译产物 | 写按钮命中 0；无 `input/textarea/contenteditable/v-html`；抽屉仅「关闭」 | readonly.spec V8 组 |
| TC-08 | 一致性 | 视觉对照 | NceLessons 可访问 | 两页并排 / 原型 §4.4 | 白底、字号、表格、抽屉、四态一致；`#F97316` 仅交互色，文本用 `#EA580C` | readonly.spec（静态 token 走查） |

## 2. V1–V12 判据映射

| # | 判据 | 本轮证据 |
|---|---|---|
| V1 | 承载分支含接口 | `git show origin/master:servers/content-hub/src/content/nce.controller.ts \| grep daily-quotes` 命中 `@Get('daily-quotes')` |
| V2 | 接口 200 + 信封 | 见 160 回执（带 JWT curl 若环境不可用则如实记缺口；静态契约由 api spec 锁） |
| V3 | 136 条 + 字段齐 | 同上；前端类型由 DailyQuotesPool 锁 |
| V4 | 类型检查 | `pnpm --filter admin exec vue-tsc --noEmit` → 0 错 |
| V5 | 列表 total / 20 条每页 | readonly.spec（分页 props + `slice` + total=filtered.length） |
| V6 | 来源可追溯 | readonly.spec（四个 source 全名 + cn/en + 版权注记） |
| V7 | 搜索命中 | readonly.spec（cn/en/title/String(lessonId) 四字段） |
| V8 | 只读硬判据 | readonly.spec：AST 无原生输入控件、编译产物无 innerHTML、按钮白名单；**变异：注入「编辑」→ 红；移除 → 绿** |
| V9 | 四态 + 恢复入口 | readonly.spec（a-spin/a-empty/错误重试/路由 403） |
| V10 | 权限门控 | readonly.spec（route meta + BasicLayout 三处顺序） |
| V11 | 视觉一致 | page-spec token 对照 + readonly.spec 静态断言 |
| V12 | 原型凭证 | 156 原型 sha256 + `check-demo-panel.mjs` 机检，见 160 回执 |

## 3. TDD 与变异记录

```
RED   : 2 suites failed / 2 tests failed
        - getDailyQuotes is not a function
        - ENOENT DailyQuotes.vue
GREEN : 2 suites passed / 12 tests passed
MUTANT: 在工具栏注入 <a-button>编辑</a-button> → V8 按钮白名单用例 FAIL（MUTANT_EXIT=1）
RESTORE: 移除注入按钮 → 12/12 PASS（RESTORE_EXIT=0）
```

> 变异仅用于机检自证，最终代码不含任何写按钮。
