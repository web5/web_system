# 成文预览 · 公众号版面重排（#436）设计与验收记录

- 日期：2026-10-23
- 原型：`specs/content-preview-typography/prototype.html`
- 实现：`apps/admin/src/views/Content/ContentPublications.vue`（`.preview-paper` / `.preview-html` 样式块 + 抽屉结构）
- 关联：#428（建草稿 400）、#431（重建成文）、#433（渲染层链接化）—— 三次修的都是「内容对不对」，本次修的是「看得下去」

## 1. 问题

用户反馈「可以了，就是整体样式不太好看」。改前预览区只有一条规则：

```css
.preview-html { font-size: 14px; line-height: 1.8; color: var(--text-body); }
.preview-html :deep(h1), :deep(h2), :deep(h3) { color: var(--text-primary); }
.preview-html :deep(a) { color: #ff8c42; }
.preview-html :deep(img) { max-width: 100%; }
```

即：**标题只是换了个颜色**。日报成文的实际结构是「`# 标题` + N 个 `## N. 条目` + 每条一段摘要 + `原文：<url>`」，渲出来是一大坨等大小文字，层级全靠读者自己猜。

## 2. 设计判断

| 决定 | 理由 |
|---|---|
| 680 版心 + 纸张卡片，抽屉 720→820 | 公众号正文宽度约 677px。预览对齐真实阅读宽度，才能回答「发出去长什么样」；纸张浮在 `bg-page` 上，靠 1px 边框 + 卡片阴影分层，不用重投影 |
| 正文 16px / 行高 1.8 / 字距 0.2px | 原 14px 是后台控件字号，不是阅读字号。16px 是公众号移动端实际渲染尺寸 |
| 首个 `h1/h2` 当文章主标题：24px + 底部分割线 | 渲染器 `markdownToHtml` 把 `#` 降级成 `h2`（公众号标题本身是 h1），所以首个标题元素 = 文章标题，需要和「章节 h2」分开排 |
| 章节 h2：3×16px 橙色竖条 | 16px 正文旁边的字号差几乎看不出层级，需要一个**非文字**的形状锚点。竖条 `top:6px` 是按 `line-height 1.55` 行盒算的，多行标题也不错位 |
| 小节 h3：6px 橙色圆点 | 第三级再上竖条就吵了，用点 |
| 列表去 `disc`，改 5px 圆点 + 条目间 10px | 浏览器默认 disc 又小又黑，跟橙色标题体系割裂；日报主体就是条目，这层最影响观感 |
| 链接：品牌橙 + 1px 半透明下划线 + `word-break: break-all` | #433 之后正文会出现大量裸 URL，只靠颜色区分不足；长 URL 不断行会撑破版心 |
| `em` 用 14% 橙色色块 | 先试过 `linear-gradient` 下划线高亮，截图看像链接，改为色块 |
| 引用/代码/表头底色用 `--ws-bg-hover` 而非 `--ws-bg-subtle` | **暗色下 `bg-subtle`(#111) 比纸面(#1A1A1A) 还深**，引用块和表头像挖了个洞 |
| 暗底链接单独提亮到 `--ws-brand-400` | `--ws-brand-600`(#EA580C) 在 #1A1A1A 上对比不足 |
| 元信息条 sticky、告警/工具栏与版心同宽 | 长文滚动时仍能看到状态与「重建成文」入口，且左右边缘对齐 |
| 正文为空给 `a-empty` | 2026-10-22 前未留存 payload 的记录点开是一片空白，看不出是「没内容」还是「没加载」 |

颜色全部引用 `@web-system/ui` 的 `--ws-*` 语义 token，浅色/暗色自动跟随，不新增硬编码色值（`rgba(249,115,22,…)` 仅用于透明叠加层）。

## 3. 边界

- 只改**显示**：发到公众号的仍是 `payload.html`；存量脏数据要靠「重建成文」+ 重新发布。
- 列表页表格样式不在本次范围。
- `--text-*` 别名是在 `:root` 处求值的（见 `packages/ui/src/tokens.css` 注释），组件内一律用 `--ws-*` 原值，避免「切了主题没变化」。

## 4. 验收

| # | 验证项 | 方式 | 结果 |
|---|---|---|---|
| 1 | 类型检查 | `vue-tsc --noEmit` | 0 error |
| 2 | 单测 | `pnpm test`（admin） | 20/20 通过 |
| 3 | 产物选择器 | 构建后 grep CSS | `>h2:first-child` 编译为 `.preview-html[data-v-x]>h2:first-child`；暗色为 `[data-theme=dark] .preview-html[data-v-x] a` |
| 4 | 真实产物渲染 | 用构建出的 CSS 直接渲染样例成文 | 版心 680、正文 16px/28.8px、标题 24px、暗底正文 #D4D4D8、暗底链接 #FB923C、表头 #2A2A2A |
| 5 | 双主题截图 | 原型 + 构建产物各一轮 | 无错位/溢出/过曝 |
| 6 | 页面错误 | puppeteer `pageerror` / `console.error` | 0 |
