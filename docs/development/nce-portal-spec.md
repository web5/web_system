# 页面规格书 · PC portal「新概念英语」（发现入口）

> 建：2026-11-05 · 总契约见 `docs/development/nce-integration-spec.md`
> 阅读体验判断真源：`20-私域资产/新概念英语学习/阅读体验设计判断.md`

## 入口

| 项 | 值 |
|---|---|
| 发现页卡片 | `apps/portal/src/config/capabilities.ts` → `{ name:'新概念英语', icon:'lang', to:'/nce', enabled:true }` |
| 路由 | `/nce`（`name: Nce`，`meta.requiresAuth: true`），`apps/portal/src/router/index.ts` |
| 顶栏 | `apps/portal/src/config/nav.ts` 追加 `topLevel:false, parent:'discover'`，高亮落回「发现」；`sideList:false, context:false`，因为页面内部自带三栏，避免外壳再插左右栏 |
| 接口 | `apps/portal/src/api/nce.ts`，`/content-admin/nce/{meta,lessons,lessons/:id}` |

## 阅读体验判据与代码落点

| # | 判据 | 落点 |
|---|---|---|
| 1 | 正文默认纯英文，三档「沉浸(默认)/点按/对照」 | `mode` + `setMode()` + `cnVisible()`；模式存 localStorage |
| 2 | 字号三档、衬线字体、68ch 行宽 | `fontStep` + `--font-step` + `.sentences`/`.en` |
| 3 | 点句出中文，不打断阅读 | `toggleReveal()` + `.sent` 点击 + `<transition>` |
| 4 | 生词就地气泡、零跳转 | `tokensOf()` 生成 token 数组（不用 v-html、不用 lookbehind）+ `.word-card` |
| 5 | 中文导入问题优先 | `leadZh() || leadEn()`，中文为大字、英文为小字副行，都空隐藏 |
| 6 | 习题读完再展开、即时判分 | `exOpen` 门 + `choose()` + `.opt.right/.wrong` + 解析 |
| 7 | 参考译文默认折叠 | `showTranslation` |
| 8 | 目录 24 课分组 + 搜索 + 已读打勾 | `groups` computed + `.toc` + `readIds` localStorage |
| 9 | PC 三栏 / 移动端顶部目录条 + ≤52vh 习题抽屉 | `.layout` grid 240px/1fr/300px；`@media(max-width:899px)` 改单栏、`.exercise.open` 抽屉、`ex-fab` 吸底 |
| 10 | 浅色白底 token | `:root` 级 CSS 变量 `#FFFFFF/#1A1A1F/#6B7280/#F97316/#0EA5A4` |

明确不做：默认并排双语、深色卡面、积分打卡、自动播放音频。

## 数据

列表默认 `pageSize=100`（全册 96 课一次取回），详情按 `?id=N` 切换并 `router.replace` 记录位置；切课重置译文揭示、习题作答、生词气泡状态。加载中 / 失败 / 空态均有兜底。

## 验收判据

| # | 判据 | 通过标准 |
|---|---|---|
| P1 | 发现入口 | 发现页出现「新概念英语」卡片，点击进入 `/nce`，顶栏高亮在「发现」 |
| P2 | 三栏 | 1440px 下目录 / 正文 / 习题三栏齐全，无重叠与大片空白 |
| P3 | 默认纯英文 | 首次打开正文区看不到中文；点某句才出现该句中文 |
| P4 | 中文问题 | Lesson 1 显示「作者为什么向坐在他身后的人抱怨？」及英文副行 |
| P5 | 生词 | 点 `private` 就地出现音标/词性/释义/例句，页面不跳转 |
| P6 | 习题 | 未点「开始练习」看不到题目；答错标红、答对标青并显示解析 |
| P7 | 窄屏 | 390px 视口工具栏单行、目录横向、习题抽屉 ≤52vh 且关掉仍看得见正文 |
| P8 | 只读 | Network 里只有 3 个 GET，无写操作 |
