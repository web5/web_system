# Design 评审报告 · B3 调参 UI 原型（亮色返工 + 按钮审计修复）

- 评审日期：2026-10-28
- 评审对象：`docs/ui/prototypes/admin-agent-def-detail.html`（B3 屏② 编辑/详情页）、`docs/ui/prototypes/admin-agents-hub.html`（admin 统一整合稿，生成物）
- 对应实现：PR #471（`d63a96d5` 形态修正 + `6f0f124e` 按钮审计），已合入 master `d38226ac`
- **形态判定：`Design: pass`（纯形态改动，不涉及实现代码）**

---

## 一、本次原型变更（6 项）

| # | 变更 | 依据 | 状态 |
|---|---|---|---|
| 1 | **暗色 → 亮色**：旧稿 Claymorphism 暗色违背「#107 起整稿亮色」口径，改引 `--ws-*` 语义 token（对齐 `packages/ui/src/tokens.ts` roles.light） | `docs/ui/prototypes/README.md` #107 口径 | ✅ |
| 2 | **并入统一原型页**：不新建整合 HTML，内容并入唯一容器 `admin-agents-hub.html`，由 `build-agents-hub.mjs` 从注册表生成 | README 裁决（hub 禁手改） | ✅ |
| 3 | **形态改回 page-spec v2**：调参不是弹窗，是列表「编辑」→ 独立详情页（基础卡默认展开 / 高级卡默认折叠，内含模型参数调试工作台） | `docs/ui/page-specs/agent-def-detail-v2.md`（v1 弹窗版已废弃） | ✅ |
| 4 | **hub 整合稿 CSS 丢失修复**：v2.4 B3 CSS 误挂壳 style 块尾部，build 只取内容块 → `.only-*` 状态互斥矩阵与 `.warn-tool svg` 尺寸整段静默丢失（表现为状态文案堆叠 + 巨大黑三角）。修：CSS 搬回主块 + `contentCssOf()` 收集全部非壳 style 块 + 生成自检锚点 | 用户 2026-10-28 截图反馈 | ✅ |
| 5 | **状态 CTA 死按钮修复**：`error-cta` / `empty-cta` / `forbidden-cta` 三按钮零绑定（假开关）。修：绑定落主脚本段（hub 内演示控件脚本被 jsDrop 丢弃，绑定放错段 = hub 内死按钮），并补 C7-b 真实互斥拒收 | 用户 2026-10-28 反馈「返回修改点不了」 | ✅ |
| 6 | **屏② 全量点击审计（35/35）+ hub toast 劫持修复**：无头逐个点击全部可点元素，无死按钮；发现 hub 内 toast 被 media-ops/dict 的 `getElementById` 全局覆写劫持（toast→zm-toast），主脚本段 `$` 改 `querySelector("#"+id)` 绕开污染 | 用户指令「编辑页面类似的按钮都需要 check 下」 | ✅ |

## 二、评审结论

| 维度 | 结论 |
|---|---|
| 亮色口径 | ✅ 全稿 `--ws-*` token，品牌橙不作正文文本色（2.9:1 不过 AA，改用 brand-700 / #EA580C） |
| 形态一致性 | ✅ 与 page-spec v2 一致：详情页两卡 + 面包屑回列表，非弹窗 |
| 可点性 | ✅ 屏② 35/35 点击实测全过；hub 抽查 13/13；死按钮枚举式机检（㉓ 段）已防复发 |
| 整合自洽 | ✅ build 重生成，hub 内调参屏可点达；生成自检 ④b/④c（关键 CSS 锚点缺失即炸） |
| 演示控件 L1 | ✅ 场景包 / 屏直达 / 真开关 / H 隐没，机检 `check-demo-panel` 通过 |

## 三、机检证据

| 机检 | 结果 |
|---|---|
| `verify-agent-def-detail.mjs` | ✅ **136/136**（含 ㉒ CTA 15 条 + ㉓ 死按钮枚举 3 条，变异测试有效） |
| `verify-agents-hub.mjs` | ✅ **242/243**（唯一 FAIL = 9r 菜单图标数 10 vs 17，系 BasicLayout/proto-shell 并行漂移，**非本轮原型范围**，已转 rd-engineer） |
| `check-demo-panel` | ✅ 通过 |
| 单稿点击审计 | ✅ 35/35 |

## 四、边界声明（不在本次范围）

1. 高级卡内调试台的对话试跑 / 用例表 / 三级参数对比 → 二期（原型内已标注 §2.1 消息组件契约占位）
2. 9r 菜单图标数漂移 → 属并行会话的 BasicLayout/proto-shell 对齐问题，不在本原型稿整改
3. `getElementById` 全局覆写的**根因**（media-ops/dict 模块）→ 本稿已做防御（querySelector），根因局部化改造单独立项
4. 列表页「新建」按钮不可点 → 用户 2026-10-28 提出，本次**未处理**（按用户指示先忽略），留缺口待办

---

**判定：形态改动合规，`Design: pass`。**
