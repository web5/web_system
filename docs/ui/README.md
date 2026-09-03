# 科豆 AI · UI 规范读取地图（docs/ui 总览）

> 版本：v0.1（草稿）｜ 日期：2026-09-03
> **给 AI**：接到任何 admin 系 UI 任务，先读本文件 → 按 §2「任务 × 最小文档集」定位该读哪几份，**不要全目录翻读**。
> **给人**：docs/ui 规范族谱总览。细则分散在各文档，本文件只负责"导航 + 同步责任"，不复制细则。

## 1. 文档分档

| 档 | 文档 | 职责 | 何时读 |
|---|---|---|---|
| ★ 必读（总纲） | `design.md` | 判断层：页面类型模板 / 布局铁律 / 交互矩阵 / 视觉约束 / 生成后自检 | 任何 UI 任务 |
| 必读（生成前） | `page-spec-template.md` | 页面规格书模板（Full / Quick） | 新页面 / 大改 / 小改，写码前填 |
| 按需 | `color-reference.md` | 颜色定义点地图（8 类位置 + hover 阶梯 + 例外登记） | 改色 / 加色 / hover |
| 按需 | `css-override-rules.md` | 覆盖优先级 + 四问 + 排查五步 + 现状登记 | 覆盖 antd / 改了不生效 |
| 活跃写入 | `geist-token-评审记录.md` | 评审回流（只追加不覆盖） | 完成 UI 后追加修正记录 |
| 归档（日常不读） | `archive/geist-token-需求文档.md` | Token 改造需求 + **DR 决策表（§9）** | 改 Token 体系 / 查裁决时 |
| 归档（日常不读） | `archive/geist-token-实现文档.md` | 改造实现细节（含 §5.4 回流模板） | 溯源 / 体系改造时 |
| 决策参考 | `rag-evaluation.md` | AI 文档读取是否建 RAG 的决策记录 | 讨论文档读取架构时 |
| 参考（C 端品牌，勿套 admin） | `ui-design-spec.html` | 变变品牌视觉规范（Claymorphism） | 只做 portal/mini-app 时 |

> ⚠️ `ui-design-spec.html`（#FF8C42 暖橙）是**品牌端**规范；admin 系数值以 `packages/ui/src/tokens.ts` 为准（DR-3 #F97316）。两套并行，勿混用。

## 2. 任务 × 最小文档集

| 任务类型 | 读什么（最小集） |
|---|---|
| 新页面 / 布局级大改 | README → `design.md` + `page-spec-template.md`（Full）→ 用户确认 → 写码 |
| 小改样式 / 调色 / hover | `design.md` 相关条目 + `color-reference.md` §2/§3 |
| 覆盖 antd / 改了不生效 | `css-override-rules.md`（§2 四问 + 排查五步） |
| 暗色适配 | `design.md` §4 + `packages/ui/src/tokens.css` dark 块 |
| 加新 Token / 改数值 | `packages/ui/src/tokens.ts`（代码事实源）→ 同步 `tokens.css`；裁决查 `archive/geist-token-需求文档.md` §9 DR |
| 评审规则溯源 | `geist-token-评审记录.md`（R1/R2/R3…） |
| 完成一个 UI 任务后 | `design.md` §5 自检 + 修正记录追加到 `geist-token-评审记录.md` |

## 3. 事实源与防漂移同步责任

| 事实源 | 同步对象 | 责任规则 |
|---|---|---|
| `tokens.ts`（数值） | `tokens.css` | 数值同源，人工同步，diff 核对 key/值 |
| `design.md`（判断条目） | `.codebuddy/rules/ui-interface/RULE.mdc` | RULE 精要是 design 摘要；**改 design 必同步 RULE** |
| `color-reference.md` §4 例外表 | `css-override-rules.md` §7 现状登记 | 例外以 color-reference §4 为准；登记仅快照 |
| `geist-token-评审记录.md`（回流） | `design.md`（升格规则） | 同一问题第 2 次出现 → 升格入 design，评审记录只追加 |
| `docs/ui/`（全部） | **禁止向外复制数值/细则** | 业务代码只引 `--ws-*` / `uiTokens`；新色先入 tokens 再引用 |

## 4. 文档读取架构决策

- `rag-evaluation.md` —— **自建 RAG？结论：不需要**（2026-09-03 决策，触发条件见该文档）。本地图即"确定性入口"方案。

## 5. 生效提示

- 新增/修改本文档及规则后需**新开会话**生效（CodeBuddy 规则注入在会话开始）。
- 验证：新会话问 AI"当前应用了哪些规则"应见 `ui-interface`；AI 应能说出"先读 README 地图"。
- 手动引用：`@ui-interface`（规则），或直接对本文件说"读 docs/ui 地图"。
