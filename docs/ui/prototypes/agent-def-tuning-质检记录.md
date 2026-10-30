# 交互质检记录 · B3 调参 UI 五控件（Agent 定义详情 · 高级 · 参数面板）

> 原型：`docs/ui/prototypes/admin-agent-def-detail.html`（v2.4，2026-10-28）
> 统一容器：`docs/ui/prototypes/admin-agents-hub.html`（build 生成物，禁手改）
> 规格：`docs/ui/page-specs/`（page-spec v2 形态）+ `B3-原型说明.md`（五控件/三联动/六场景真源）+ `docs/api/contracts.md` §7（C7-b/c/d/e、§7.4 预设档位）
> 清单：`.codebuddy/skills/ux-prototype-designer/references/ux-review-checklist.md`
> 范围：B3 调参 UI 返工——① 深色 → 亮色 `--ws-*` 口径；② 五控件并入高级卡；③ 并入 admin 统一原型（hub）
> **结论：通过（A–J 全绿）**。遗留 2 项非阻塞（见文末「遗留与待确认」），不影响交用户确认。
> 本次为**原型返工**：设计真源以 `B3-原型说明.md` + page-spec v2 为准；旧稿 `B3-调参UI原型.html`（暗色）已废止留档。

---

## 0. 机检摘要（2026-10-28）

| 机检 | 结果 |
|---|---|
| `check-demo-panel`（skill 脚本） | ✔ 演示控件机检通过 |
| `check-proto-adopt` | ✔ 没有零散原型稿（11 份全部已登记 / 特例引用 / 范围外 / 存档）；三份源稿 FAIL 0 |
| `verify-agent-def-detail` | ✔ 全部通过（118 项 puppeteer 断言） |
| `verify-proto-shell` | ✔ 39/39 |
| `verify-playground-parity` | ✔ 31/31 |
| `audit-proto-registry` | ✔ 0 项问题 |
| `build-agents-hub` | ✔ 已生成 `admin-agents-hub.html`（5982 行） |
| `verify-agents-hub` | ⚠ 222/223 —— 唯一 FAIL `9r 菜单图标数`（actual=10 / expect=17） |

**9r 说明（非本稿问题）**：断言「`admin-agents-hub` 菜单图标数 = `BasicLayout.vue` 侧栏 `a-menu` 的 `#icon` 槽位数」。实测 hub 侧 10 个（`proto-shell.mjs` 生成的 `.ad-ic`），`BasicLayout.vue` HEAD 亦为 17 处 `<template #icon>`。已核实 `proto-shell.mjs` 与 `admin-agent-def-detail.html` 本次改动均未触碰菜单图标生成逻辑，属并行实现侧（BasicLayout / proto-shell）漂移，**不在本原型返工范围**，已同步 team-lead 转实现侧处理。

---

## A. 信息架构

- [x] **页面清单完整**：屏① 列表 `#screen-list` + 屏② 详情 `#screen-detail`（含高级卡 + 调试台 + 审计卡），无缺页。B3 五控件全部落在屏② 高级卡参数面板，与 page-spec v2「新页面高级卡工作台、不要弹窗」一致。
- [x] **入口可达、有返回路径**：列表「编辑」→ 详情；面包屑 / 「返回列表」→ 屏①；hub 内 hash 路由 `openDef` / `goList` 三处机械改写后仍闭环。
- [x] **导航无跳转环**：列表 ↔ 详情两屏单向往返；调试台 Tab（对话试跑 / 用例表）屏内切换不参与导航。

## B. 任务流闭环

- [x] **主路径闭环**：选定义 → 展开高级卡 → 调五控件 → 看策略预览 → 保存 → 审计追加，全程可点通（S1/S2/S6 场景包直达）。
- [x] **异常分支覆盖**：S3 误配 disabled（联动一红字警示，可点不锁死）、S4 temp+topP 同填保存被拒、保存失败 toast、loading/empty/error/forbidden 四态均有 `only-*` 分支 + 唯一恢复入口；不吞错。
- [x] **跨屏衔接**：列表行状态 chip（含「全部沿用默认」）与详情表单值一致；保存后返回列表可见新值。

## C. 状态矩阵

- [x] **加载中**：`only-loading` 骨架分支（S2 存量加载路径可演示）。
- [x] **空态 / 错误态 / 无权限**：`only-empty` / `only-error`（带重试）/ `only-forbidden`（角色越权文案）；另有 `only-misconfig` 演示态（S3）。
- [x] **完成态反馈**：保存成功底部 toast + diff 表收起 + 审计条目 push（S6）；校验失败字段级红字 + 行内文案。

## D. 操作与确认

- [x] **主操作一屏 ≤ 1**：屏② 唯一 primary = 「保存」；高级卡内预设/重置均为次级。
- [x] **破坏性操作二次确认**：「恢复默认」二次确认；离开未保存有变更条拦截（面板级未保存变更条 + diff 表）。
- [x] **禁用 / 进行中**：保存中按钮 loading + 防重复提交锁；thinking 锁定态（P1 带工具强制 enabled）时 seg 置灰并出 `C7-d` 说明；Top P / Temperature 互斥 seg（C7-b）。
- [x] **表单校验字段级**：maxTokens 1–32768、max_steps 1–50 均有字段级错误态；文案走后端中文口径（`backendValidate` 模拟后端返回，不在前端自造判据语义）。

## E. 视觉与 Token 一致性

- [x] **Token 化**：全稿 `--ws-*` 亮色语义 token（`roles.light` 对齐 `packages/ui/src/tokens.ts`）；业务区无裸 hex/rgba（`:root` 定义处除外）；语义色经 `--ws-danger/--ws-ok` 等表达。品牌橙 `--ws-brand-500/600` 只用于按钮/强调，**不作正文文本色**。
- [x] **主色与目标端匹配**：admin 亮色体系（`--ws-bg-page:#FAFAFA` 壳 + 白卡片），与 hub 内其他 admin 稿同口径；深色 token 零残留（旧稿暗色 `#0A0A0D` 体系已随废止移出）。
- [x] **无 emoji 图标**：图标全部内联 SVG（警示三角、折叠箭头等）；间距 8 的倍数。
- [x] **字号三级**：标题 / 正文 / hint 三级字阶，f-tag 徽标独立样式，不靠加粗堆叠。

## F. 可访问性基线

- [x] **可读性**：亮色下正文 `--ws-text-primary` 对比度达标；禁用态用 `--ws-text-disabled` 仅限真正不可用控件（残留值展示已改可读配色 + 互斥切换可见语义）。
- [x] **键盘 / 焦点**：`:focus-visible` 全局 focus ring（`--ws-focus-ring`）；演示控件快捷键在 input/textarea/select/contenteditable 内让行。
- [x] **语义**：可点击区用 `<button>`（演示控件 16 个按钮、卡头折叠、预设 select 等），无裸 div onclick。

## G. 内容与真实性

- [x] **文案真实**：五控件 label/hint 与 `AgentTuningPanel.vue` 口径对齐（`?? 0.7 修正`、`C7-b 互斥` 仅出现在 tagline 不进 fhint，避免与 18d 机检互斥）；策略预览 P1–P5 命中档文案取自 D1 §6.3；审计 diff 行（字段 90px / 改前划线 / 改后加粗 / runtime 行）与 `TuningAuditList.vue` 同构。三个定义（DEFS）自带本业务真实示例内容，非 lorem。
- [x] **信息完整**：五控件值 + 三联动反馈 + 策略预览三值输出（thinking / budget_tokens / max_tokens）+ 审计（字段/改前/改后/操作者/时间）无缺漏；budget 只读预览显示公式 `min(模型上限 8192, maxTokens/2)`。

## H. 目标端一致性

- [x] **目标端已确认**：桌面 Web（admin 管理后台，1280 亮色壳），稿头已回显。
- [x] **壳与宿主匹配**：沿用 admin 壳（顶栏 + 侧栏 + 面包屑 + 内容区）；无移动端胶囊/TabBar 混入。
- [x] **平台原生能力**：无（纯 Web 表单工作台），无伪装实现项。
- [x] **非 Web 端**：不适用。

## I. 未定义项显式标注

- [x] **待确认已标注**：审计卡 `data-anno="D4"` 等标注挂 `[data-anno]`，演示控件标注层可开；D1–D5 决策记录（`B3-原型说明.md`）承载「本稿假设」清单。
- [x] **无静默发明**：budget 不做 agent 级配置（D 决策）→ 只读预览而非隐藏或自造输入框；thinking null 语义按 C7-c 原样呈现（「未配置」而非「沿用模型默认」混叫）；max_steps 值域 1–50 取自实现侧契约，未自造。

## J. 演示控件与自解释性

- [x] **控件分区完整（L1）**：稿头说明 + 屏清单（S1/S2 直达）+ 场景包 6 个 + 角色切换（superadmin/admin）+ 六数据态（normal/loading/empty/error/forbidden/misconfig）+ 标注层 + 复位 + 收起胶囊；机检 `check-demo-panel` ✔。
- [x] **场景包 ≥3 且命名「谁 · 什么情况」**：S1 超管 · 带工具默认强制开思考 / S2 存量简单 agent · 全部未配置 / S3 误配 disabled · 红字警示 / S4 temp+topP 同填 · 保存被拒 / S5 普通管理员 · 调参不可见 / S6 保存成功 · 审计改前改后。覆盖主路径 + 关键异常 + 角色差异；默认 S1 为真实主路径。
- [x] **屏清单一一对应**：屏① 屏② 均可点进、可返回，无幽灵项。
- [x] **开关真生效**：`setRole` 真切 `[data-need-role]` 显隐（纯 CSS）；`setState` 真切 `only-*` 分支；`applyPreset` 真写表单值并触发联动/警示/审计（S6 模拟保存 push 审计）。无假开关。
- [x] **跳屏后菜单/面包屑跟随**：单一 `go()` 入口；hub 侧走 hash 路由改写后行为一致。
- [x] **可隐没**：`H` 收起（`.mini` 胶囊）；`@media print` 隐藏 `[data-demo-ctl]`；收起后截图与纯产品界面无异。
- [x] **视觉区隔**：虚线白底 + 「原型演示控件」标签 + fixed 右下 300px，与产品卡片（实线阴影）明确不同。
- [x] **快捷键让行**：input/textarea/select/contenteditable 内不劫持 H/[]/1-6/A/?/Esc。
- [x] **「待确认」计数从 DOM 数出**：`[data-anno]` 节点（D4 等）与设计决策记录编号对齐。
- [x] **抽进 hub 不带入**：演示控件脚本在第三段 `DEMO-PANEL-START/END` 内；build 的 `between('<script>','</script>')` 只取第一段主脚本，天然不进 hub（照 `admin-media-ops` `jsDrop` 先例）。hub 内 9r 以外的 222 项含 hub 集成后的行为断言全绿，反证剥离正确。

---

## 遗留与待确认（非阻塞）

| # | 项 | 性质 | 默认建议 |
|---|---|---|---|
| L1 | `--ws-overlay` / `--ws-shadow-float` 尚未进 `packages/ui/src/tokens.ts + tokens.css`（与 admin-agents.html 同一遗留） | 落地前补 token | 实现侧统一补，原型已用同值占位 |
| L2 | `verify-agents-hub 9r` 菜单图标数漂移（BasicLayout 17 vs proto-shell 10） | 并行实现侧问题 | 转 rd-engineer 对齐 BasicLayout ↔ proto-shell，不在本稿修 |
| D4 | 审计留存条数 / 保留期未定义 | 产品待拍板 | 默认「展示最近 50 条，不做归档」 |

---

## 与旧稿的关系

| 稿 | 状态 |
|---|---|
| `…/2026-10-26-AI-Agent能力实施/B3-调参UI原型.html`（Claymorphism 暗色） | **已废止**（文件头已注记）——深色口径作废，仅历史留档 |
| `…/B3-原型说明.md` | **仍有效**——五控件/三联动/六场景/D1–D5 设计真源 |
| `docs/ui/prototypes/admin-agent-def-detail.html` v2.4 | **现行稿**——亮色 `--ws-*`，五控件已并入，已整合进 `admin-agents-hub.html` |
