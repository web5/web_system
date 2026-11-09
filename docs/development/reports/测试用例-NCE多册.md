# 测试用例 · NCE 多册支持（NCE2/3/4）

> 关联方案: `docs/development/reports/2026-11-09-NCE多册支持方案.md`
> 环境: dev + prod 都要走查（prod 仅验证发布后生效）

## 用例矩阵

| 用例ID | 模块 | 场景 | 前置条件 | 步骤 | 预期结果 | 环境 |
|---|---|---|---|---|---|---|
| TC-01 | 后端接口 | meta 默认册 | dev 已重导 NCE3/4 | `GET /api/content-admin/nce/meta`（不传 book） | `book=NCE2, total=96, downloaded=96` | dev+prod |
| TC-02 | 后端接口 | meta NCE3 | 同上 | `GET .../nce/meta?book=NCE3` | `book=NCE3, total=60` | dev+prod |
| TC-03 | 后端接口 | meta NCE4 | 同上 | `GET .../nce/meta?book=NCE4` | `book=NCE4, total=48` | dev+prod |
| TC-04 | 后端接口 | list 按册过滤 | 同上 | `GET .../nce/lessons?book=NCE3` | `total=60`，每条 `book=NCE3` | dev+prod |
| TC-05 | 后端接口 | detail 跨册取对 | 同上 | `GET .../nce/lessons/5?book=NCE3` | 返回 NCE3 Lesson5（标题/正文 ≠ NCE2 Lesson5） | dev+prod |
| TC-06 | 后端接口 | detail 默认 NCE2（向后兼容） | 同上 | `GET .../nce/lessons/5`（无 book） | 返回 NCE2 Lesson5（行为同发布前） | dev+prod |
| TC-07 | 后端接口 | 非法 book 回退 | 同上 | `GET .../nce/meta?book=XXX` | 回退 NCE2（不报错，total=96） | dev+prod |
| TC-08 | admin UI | 册别切换器 | admin 登录，进入 `/admin/content/nce-lessons` | 切到 NCE3 → 看列表 | 列表显示 60 课，`bookTitle`=NCE3 标题 | dev |
| TC-09 | admin UI | 点词不串册 | 处于 NCE3 册 | 点 NCE3 某课生词 → 看查词卡 | 弹该册释义，无 NCE2 串册 | dev |
| TC-10 | portal UI | 册别切换 + 能力描述 | 打开 `/portal/nce` | 切册 + 看发现页能力卡 | 切换生效；`capabilities` 描述改为多册 | dev |
| TC-11 | 发布验证 | prod 三端生效 | prod 已发布 | `verify_release` | `verdict=verified`，prod 接口 `book=NCE3` 返回 60 | prod |

## 设计原则覆盖（"错了会不会掩盖真因"）

- **非法 book（TC-07）**：回退默认而非 500，避免前端整页崩。
- **跨册串数据（TC-05/09）**：`detail` 与查词卡必须按 `(book, lesson_no)` 取，防止点到 NCE3 却显示 NCE2 内容。
- **向后兼容（TC-01/06）**：不传 book 的旧调用方零改造，行为不变。

## 回归范围

- NCE2 点词卡 P0 闸门（原 TC-02/05/06）：仍 PASS，不串册。
- admin/portal 现有 NCE2 浏览：列表/预览/查词交互不变。
