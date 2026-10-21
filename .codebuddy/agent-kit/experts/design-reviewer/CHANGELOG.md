# CHANGELOG.md · design-reviewer

| 版本 | 日期 | 变更 |
|---|---|---|
| 1.0.0 | 2026-10-15 | 从 web_system（`docs/ui/design-system.md` v1.0 + `.codebuddy/skills/design-reviewer/`）抽离入驻 `experts/`。判据 76 条整体搬入不脱敏；新增 `PROFILE.md`（七维画像）与 `ADOPT.md`（接入指南）；去除 web_system 专属的 CI 路径硬编码，改为 ADOPT.md 可配置接线 |
| 1.1.0 | 2026-10-16 | **修复判据引用断链**：① 连带搬入 `references/design.md`（admin 系判断层，原 `docs/ui/design.md`，102 行）——消除判据正文 8 处断链引用；② 未搬入的外部物（`tokens.ts` / `app.wxss` / 两个 RULE.mdc / `ui-design-spec.html`）改为**角色化引用 + 原值标注**，并在 `ADOPT.md` 新增 **§2.5 引用源映射表**；③ `SKILL.md` 新增「引用缺失处理协议」（可达性检查 + 四类缺失降级规则 + 不静默跳过等三条铁律）；④ 修正 checklist / report-template 对 `docs/ui/*` 的自引用为同目录相对引用 |

---

## 何时需要重新 adopt

| 变更类型 | 下游动作 |
|---|---|
| 判据条目增删 / 语义变更 | 重新过一遍 `ADOPT.md` §4 验证；检查 `*.local.md` 覆盖是否仍成立 |
| 独立性机制 / 工作流变更 | 重跑一次评审，确认新机制生效 |
| 仅文档措辞 / 排版 | 无需动作 |
| `references/` 某文件删除 | 同步机制会自动移除下游同名文件（`*.local.md` 除外），注意你的覆盖是否引用了它 |
