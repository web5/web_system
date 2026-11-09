# 交互清单 · NCE 册别切换器（admin + portal）

> 关联方案: `docs/development/reports/2026-11-09-NCE多册支持方案.md`
> 模板: Quick（复用现有阅读器布局，仅新增册别切换器，无新页面/新路由）

## 改动页面
1. **admin** `apps/admin/src/views/Content/NceLessons.vue`
2. **portal** `apps/portal/src/views/Nce.vue`

## 交互元素
| 元素 | 位置 | 形态 | 选项 | 行为 |
|---|---|---|---|---|
| 册别切换器 | 列表区顶部（标题右侧） | 分段标签 / 下拉 | NCE2 / NCE3 / NCE4 | 切换后：① 重置分页到第一页；② 重新拉 `getNceMeta(book)` + `listNceLessons({book})`；③ 列表、册标题、预览抽屉全部随新 book 刷新 |

## 状态与数据流
- 册别状态：`ref currentBook`，初值 `NCE2`。
- 切换回调：`currentBook = val; meta.value = await getNceMeta(val); list.value = await listNceLessons({ book: val, page: 1 });`
- 预览抽屉打开 `getNceLesson(id, currentBook)` 透传 book，保证查词卡取该册数据。
- 空态：某册 `downloaded=0` 时列表显示"该册暂无数据"。

## 兼容性
- 不传 book 的旧调用保持 NCE2；切换器默认选中 NCE2，视觉无突变。

## 验收（对应 TC-08/09/10）
- 切 NCE3 → 列表 60 课，`bookTitle` 更新；点词卡弹该册释义不串册。
- portal 发现页能力卡描述更新为"新概念英语二/三/四册逐句精读"。
