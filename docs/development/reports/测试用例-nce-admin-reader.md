# 测试用例 · admin 预览页 NCE 交互式查词

> 任务：给 `apps/admin/src/views/Content/NceLessons.vue` 补齐点词查词交互（与 portal 对齐）
> 关联方案：`docs/development/nce-admin-reader-interactive.md`
> 交互清单：`docs/ui/page-specs/nce-admin-reader.md`
> 环境：dev（依赖 NCE 数据已入库，三册共 204 课）

## 功能用例矩阵

| 用例ID | 模块 | 场景 | 前置条件 | 步骤 | 预期结果 | 环境 |
|---|---|---|---|---|---|---|
| TC-01 | 查词交互 | 点生词弹释义 | 打开某课预览抽屉 | 在「逐句对照」点任意带虚线生词 | 底部查词卡显示该词音标/词性/释义/例句，页面不跳转 | dev |
| TC-02 | 对齐修复回归 | 点 beggar 不弹 pocket | 打开 NCE2 L6「Percy Buttons」 | 点正文 beggar | 查词卡显示 beggar（乞丐）释义，非 pocket（2026-11-06 网页原型错位 bug 回归验证） | dev |
| TC-03 | 查词卡关闭 | 关闭卡 | TC-01 后 | 点关闭按钮 | 查词卡消失，正文可继续点其他词 | dev |
| TC-04 | 无生词课文 | 不崩 | 打开无生词课文（如有） | 查看逐句对照 | 英文纯文本，无可点 token，无报错 | dev |
| TC-05 | 现有功能不回退 | 逐句中文/生词列表/习题正常 | 打开预览 | 查看中文逐句、生词平铺列表、习题答案 | 与改动前一致，两种视图共存 | dev |
| TC-06 | 交互一致性 | 与 portal 同源 | 对比 portal /nce | 同课文点同一生词 | 弹出释义一致（对象绑定同源） | dev |

## 验证方式（人工走查依据）

- 本地起 admin：`pnpm --filter admin dev` → 访问 `/content/nce-lessons` → 点「预览」→ 切到「逐句对照」点词。
- 类型检查（防 token 渲染 TS 报错）：`npx vue-tsc --noEmit -p apps/admin/tsconfig.json`（或 admin 包内 `pnpm typecheck`）。
- 错位专项（TC-02）：用 L6 真实 `words` 跑 `tokensOf` 复现，断言每个高亮词 `token.word === map.get(token.text).word`（浏览器内人工点验 + 本用例矩阵记录）。

## 验收判据

TC-01 ~ TC-06 全部通过 = 验收通过。其中 TC-02 为 2026-11-06 错位 bug 的回归闸门，必须显式点验 beggar 不弹 pocket。
