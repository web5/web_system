# 页面规格书 · 小程序「新概念英语」（发现入口）

> 建：2026-11-05 · 总契约见 `docs/development/nce-integration-spec.md`
> 阅读体验判断真源：`20-私域资产/新概念英语学习/阅读体验设计判断.md`

## 页面清单与注册

| 页面 | 路径 | 文件 | 说明 |
|---|---|---|---|
| 发现入口卡 | `pages/discover/index/index` | `index.wxml` / `index.ts` / `index.wxss` | 新增 `.cap` 卡「新概念英语 / NCE 逐句精读」，`openNce()` → `wx.navigateTo` |
| 课文目录 | `pages/nce/index/index` | 四件套 | 教材名 + 册别切换（NCE2/3/4）+ 已入库 N/total、24 课动态分组、搜索、来源标签 |
| 课文详情 | `pages/nce/detail/detail` | 四件套 | 逐句精读 + 生词 + 习题浮层 |

`app.json` 的 `pages` 追加上述两条（主包，不动 subpackages / preloadRule / tabBar）。`custom-tab-bar` 与 `setTabBarSelected(this, TAB_INDEX.discover)` 保持不变。

## 接口与字段

`services/nce.ts` 封装 `getNceMeta(book?)` / `listNceLessons(page, pageSize, keyword, book?)` / `getNceLesson(id, book?)`，请求 `/api/content-admin/nce/*`；小程序 `utils/request.ts` 不拆包，故用 `Wrapped<T>` + `res?.data ?? 兜底`。

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

## 整篇朗读 + 拖动位置继续（#7 · 2026-11-10 增补）

> 方案真源：`30-任务产物/2026-11-10-小程序人工测试问题梳理与派发/02-课文整体朗读方案.md`
> 复用 `services/tts.ts` 既有 mp3 链路，无后端改动。朗读走 `POST /api/ai/tts/speak`（用户触发，非页面只读加载的一部分）。

### 交互判据

| # | 判据 | 实现 |
|---|---|---|
| R1 | 句级队列连播 | `tts.speakLines(lines,{startIndex})`：逐句独立 mp3 合成 + 顺序连播 + 预取下一句（窗口=1，禁整课并发 N 请求），复用 `ensureAudioFile`/`playFileAndWait`/`runSeq`/`speakState`，播完即 destroy 防实例泄漏 |
| R2 | 句高亮跟随 | `onLineProgress({index})` → `setData({readingLineIdx})` → `.sent.reading`（浅蓝底 `#EFF6FF` + 左蓝竖条 `#3B82F6`，与中文揭示左青 `#0EA5A4` 不同通道，可共存） |
| R3 | 自动滚动 | `wx.pageScrollTo({selector:'#line-'+i})`；低版本基础库不支持时降级为只高亮 |
| R4 | 点句 / 刻度条续读 | 朗读中/暂停点句或点句级刻度条 → `seekLine(i)` → 从第 i 句续读；朗读中点句不弹中文 |
| R5 | 暂停 / 继续 / 停止 | `pauseSpeak`/`resumeSpeak`/`stopSpeak`；状态机 `idle|loading|playing|paused`；停止后高亮复位 |
| R6 | 断点记忆 | `nce-read-<book>-<lessonId>` 存 lineIdx；onLoad 读，>0 显示「继续朗读 · 第 N 句」且**不自动播**；自然播完整课清断点 |
| R7 | 朗读与习题互斥 | 朗读态隐藏「开始练习」浮层，底部朗读控制条（暂停/继续 + 句级刻度条 + 第 i/N 句 + 停止）吸底占位 |
| R8 | 生词不打断 | 朗读中点生词弹查词卡 + 该句译文，播放不中断 |

### 验收判据

| # | 判据 | 通过标准 |
|---|---|---|
| R-V1 | 整篇连播 | 点「整体朗读」从第 1 句连续读到末句，无中途停掉、句间空档 <0.5s |
| R-V2 | 句高亮 + 自动滚动 | 每句开播该句获 `.reading` 高亮，上一句高亮消失，当前句可见 |
| R-V3 | 点句 / 刻度条续读 | 朗读中/暂停点第 i 句或第 i 格，从第 i 句续读、高亮跳至第 i 句 |
| R-V4 | 播放控制 | 暂停→继续→停止三态正确；停止后高亮复位、按钮回「整体朗读」 |
| R-V5 | 断点记忆 | 读到第 5 句退出再进，显示「继续朗读 · 第 5 句」，点后从第 5 句续读且不自动播 |
| R-V6 | 播完清断点 | 自然播完整课复位 idle，再进不显示「继续朗读」 |
| R-V7 | 鉴权 / 失败兜底 | 未登录点朗读 toast「请先登录」无合成请求；某句合成失败 toast「朗读已中断」停止并保留断点 |

## 沉浸模式禁点句（#11 · 2026-11-10 增补）

| # | 判据 | 实现 |
|---|---|---|
| I1 | 沉浸 idle 禁点句揭示中文 | `toggleLine()` 区分 `immersion`/`tap`：`immersion` 点句不翻转 `showCn`，仅保留底部「查看参考译文」（`detail.translation`） |
| I2 | tap / 对照不受影响 | `tap` 点句揭示中文、`bilingual` 全显、生词查词照常 |
| I3 | 沉浸 idle 点生词只查词 | `onWord()` 沉浸 idle 只弹查词卡，不连带揭示该句译文；`tap` 及朗读中仍揭示该句译文 |

## 多册支持（NCE2/3/4 · #8 · 2026-11-10 增补）

> 唯一索引 `(book, lesson_no)`：三册 lesson_no 都从 1 起，详情跳转必须带 `book`，否则点 NCE3 第 1 课会打开 NCE2 Lesson 1。
> 课数：NCE2=96 / NCE3=60 / NCE4=48。书册常量与分组区间集中在 `pages/nce/books.ts`。

### 交互判据

| # | 判据 | 实现 |
|---|---|---|
| B1 | 目录页册别切换 | `pages/nce/books.ts` 导出 `NCE_BOOKS`（NCE2/3/4）+ `DEFAULT_NCE_BOOK`；目录页 `.books` 分段控件 `switchBook()`，默认 NCE2 |
| B2 | 切册重置搜索词 | `switchBook()` `setData({ book, keyword: '' })` 后重拉，避免跨册搜索结果串味 |
| B3 | 列表/元信息带册 | `load()` 调 `getNceMeta(book)` + `listNceLessons(1, 100, '', book)` |
| B4 | 目录动态分组 | `buildNceGroupRanges(total)`：每 24 课一组、末组按 `meta.total` 截断（NCE3 末组 49–60、NCE4 末组 25–48） |
| B5 | 详情跳转带册 | `openDetail()` `navigateTo` URL 追加 `&book=<book>`；`detail.onLoad` 读 `options.book`（缺省 NCE2），`getNceLesson(id, book)` |
| B6 | 上一/下一课边界按册 | `goLesson()` 用 `nceBookTotal(book)` 替换硬编码 96 |
| B7 | 断点按册隔离 | 断点 key `nce-read-<book>-<lessonId>`，避免三册同课号串读 |

### 验收判据

| # | 判据 | 通过标准 |
|---|---|---|
| B-V1 | 切 NCE3/NCE4 列表正确 | 目录显示该册课数（60/48），`bookTitle` 随册变化，点第 1 课详情为该册 Lesson 1（不串 NCE2） |
| B-V2 | 切册重置搜索 | 在 NCE2 搜索后切 NCE3，搜索框清空、列表为该册全量 |
| B-V3 | 分组与边界 | NCE3 末组 49–60、NCE4 末组 25–48；最后一课「下一课」、第一课「上一课」越界 toast 且不串册 |
| B-V4 | 断点隔离 | NCE2 Lesson 1 读到第 5 句退出，进 NCE3 Lesson 1 不显示「继续朗读」 |
| B-V5 | 默认册 | 发现页进入不带 book，目录默认 NCE2（96 课，行为不变） |

## 工程门禁状态（2026-11-06 更新）

- ✅ **原型登记已补**：`prototype/index.html` 中新增 `p-nce` 单 sub 页，含「发现卡 / 课文目录 / 课文详情」三屏（目录 + 详情双 view，复用既有 `navigateTo` / `goBack` 状态机）。原型与规格单独提交为 Proto commit。
- ✅ **提交已按门禁拆分**：原型/规格/D3 评审报告为 Proto commit，其余落码文件为 UI commit 并带 `Proto: <sha>` + `Design: pass`。
- 原型浏览器交互实测与 D3 实现一致性评审结论见 `docs/ui/reviews/nce-d3-2026-11-06.md`。
- ⚠️ 小程序**微信开发者工具真机**目视仍待人工（台账 #8544），不因评审签字视为已完成。
