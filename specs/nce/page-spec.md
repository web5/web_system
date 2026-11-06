# 页面规格书 · 小程序「新概念英语」（发现入口）

> 建：2026-11-05 · 总契约见 `docs/development/nce-integration-spec.md`
> 阅读体验判断真源：`20-私域资产/新概念英语学习/阅读体验设计判断.md`

## 页面清单与注册

| 页面 | 路径 | 文件 | 说明 |
|---|---|---|---|
| 发现入口卡 | `pages/discover/index/index` | `index.wxml` / `index.ts` / `index.wxss` | 新增 `.cap` 卡「新概念英语 / NCE2 逐句精读」，`openNce()` → `wx.navigateTo` |
| 课文目录 | `pages/nce/index/index` | 四件套 | 教材名 + 已入库 N/96、24 课分组、搜索、来源标签 |
| 课文详情 | `pages/nce/detail/detail` | 四件套 | 逐句精读 + 生词 + 习题浮层 |

`app.json` 的 `pages` 追加上述两条（主包，不动 subpackages / preloadRule / tabBar）。`custom-tab-bar` 与 `setTabBarSelected(this, TAB_INDEX.discover)` 保持不变。

## 接口与字段

`services/nce.ts` 封装 `getNceMeta()` / `listNceLessons()` / `getNceLesson(id)`，请求 `/api/content-admin/nce/*`；小程序 `utils/request.ts` 不拆包，故用 `Wrapped<T>` + `res?.data ?? 兜底`。

| 字段 | 目录页 | 详情页 |
|---|---|---|
| `id` | 课号 | 标题栏 Lesson N |
| `title` / `titleCn` | 主/副标题 | 标题 / 中文标题 |
| `leadQuestionCn` / `leadQuestion` | 中文优先，无则英文 | 中文大字 + 英文小字副行，都空隐藏 |
| `textSource` | `xdf`→「权威全文」绿标 / `lrc`→「字幕拼接」橙标 | 同左 |
| `lineCount` / `wordCount` / `exerciseCount` | 统计行 | — |
| `lines` | — | 逐句渲染，中文按需揭示 |
| `words` | — | 句子内 token 化成就地可点生词 |
| `exercises` | — | 读完再展开、即时判分 |
| `translation` | — | 默认折叠 |

## 交互判据

| # | 判据 | 实现 |
|---|---|---|
| M1 | 正文默认纯英文 | `mode: 'immersion'`，`line.showCn` 全 false |
| M2 | 点句出中文 | `toggleLine()` 只翻转当前句；`bilingual` 档全句显示；`tap` 档点按同沉浸 |
| M3 | 三档 + 字号三档持久化 | `setMode` / `setFont` 写 `wx.setStorageSync('nce-mode' / 'nce-font')` |
| M4 | 生词就地查、零跳转 | `tokenize()` 把句子切成 token 数组（含 `wi` 下标），wxml 双分支 `<text>`；不用 rich-text、不用正则 lookbehind |
| M5 | 导入问题中文优先 | `leadQuestionCn || leadQuestion`，中文大字 / 英文副行 / 都空隐藏 |
| M6 | 习题读完再展开 | `exOpen` 门 + 吸底「开始练习」+ ≤52vh 半屏浮层；`choose()` 判分与解析 |
| M7 | 参考译文默认折叠 | `showTranslation` |
| M8 | 浅色白底 | `#FFFFFF / #1A1A1F / #6B7280 / #F97316 / #0EA5A4`，无深色卡面、无积分打卡 |
| M9 | 状态兜底 | 加载中 / 失败可重试 / 未入库提示 / 上一课下一课切课重置状态 |

## 验收判据

| # | 判据 | 通过标准 |
|---|---|---|
| W1 | app.json 合法且四件套齐全 | `python3 -m json.tool app.json` 通过；4 个页面文件齐全 |
| W2 | 发现页可达 | 点「新概念英语」卡跳到目录页，返回后 tabBar 高亮仍在「发现」 |
| W3 | 目录 | 显示已入库课文，中文导入问题在前，`xdf/lrc` 标签正确 |
| W4 | 详情默认态 | 首次进入看不到逐句中文；点某句才出现该句中文 |
| W5 | 中文问题 | Lesson 1 显示「作者为什么向坐在他身后的人抱怨？」及英文副行 |
| W6 | 生词 | 点 `private` 出现音标/词性/释义/例句，页面不跳转 |
| W7 | 习题 | 未点「开始练习」看不到题目；浮层 ≤52vh 且关掉仍看得见正文 |
| W8 | 只读 | 只发 3 个 GET，无写操作 |

## 工程门禁状态（2026-11-06 更新）

- ✅ **原型登记已补**：`prototype/index.html` 中新增 `p-nce` 单 sub 页，含「发现卡 / 课文目录 / 课文详情」三屏（目录 + 详情双 view，复用既有 `navigateTo` / `goBack` 状态机）。原型与规格单独提交为 Proto commit。
- ✅ **提交已按门禁拆分**：原型/规格/D3 评审报告为 Proto commit，其余落码文件为 UI commit 并带 `Proto: <sha>` + `Design: pass`。
- 原型浏览器交互实测与 D3 实现一致性评审结论见 `docs/ui/reviews/nce-d3-2026-11-06.md`。
- ⚠️ 小程序**微信开发者工具真机**目视仍待人工（台账 #8544），不因评审签字视为已完成。
