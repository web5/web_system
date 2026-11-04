# admin 原型稿补齐（admin-prototype-coverage）

> 状态：**待开始**（2026-09-22 立项）｜承载人：新会话（本文件即入口，把路径丢给新对话即可）
> 关联：UI 动作门（`.codebuddy` 规则）｜设计系统 `docs/ui/design-system.md`｜原型索引 `docs/ui/prototypes/README.md`
> 同源工作：`docs/ui/anchor-backlog.md`（B1b 批 = `apps/admin` 26 个 `.vue` 的设计锚点回填）—— 两件事都碰 admin，**原型补齐先行**，锚点回填可复用原型侧 `data-dr`

## 1. 问题（为什么要做）

`apps/admin` 有 **26 个界面文件**，但原型侧只有**一份**：`docs/ui/prototypes/admin-settings.html`
（2026-09-22 做 A6「移除存储配置 tab」时补的）。其余模块**没有任何原型稿**，后果：

1. **UI 动作门走不动**：门要求「先改原型 → 质检 → 人审 → 才落码」，而这些模块没有原型可改 —— 实际执行时只能跳过原型步骤或现补，前者违规、后者每次重复劳动。
2. **交互/视觉对齐没有参照源**：改这些页面只能读 `.vue` 猜设计意图（`docs/ui/prototypes/README.md` 明确「原型是当前对照源，落地真相以代码与 specs 为准」）。
3. **设计锚点回填缺原型侧对照**：`anchor-backlog.md` 的口径是「原型侧与实现侧同名同语义」，admin 侧目前只有 1/26 有原型。

## 2. 目标

为 admin 其余模块补齐**可点击交互 HTML 原型**，使每个模块都满足 UI 门的「有原型可改」前提，并作为后续交互/视觉对齐与锚点回填的参照源。

**不是**给每个文件都出一份稿：按**模块**出（一个模块一份稿覆盖其页面与状态），26 个文件归并后约 **9~11 份**。

## 3. 范围清单（按路由/模块，实测 2026-09-22）

| # | 模块 | 路由 | 界面文件 | 原型现状 | 建议批次 |
|---|---|---|---|---|---|
| 1 | 工作台 | `/dashboard` | `views/Dashboard.vue` | 无 | P5 |
| 2 | **用户管理**（列表 + 详情） | `/users`、`/users/:id` | `UserList.vue`、`UserDetail.vue` | 无 | **P1** |
| 3 | **角色权限** | `/settings/roles` | `Settings/RoleManagement.vue` | 无 | **P2** |
| 4 | **字典管理 + 编辑** | `/settings/dicts`、`/settings/dicts/:code` | `Settings/DictManagePage.vue`、`DictEditPage.vue` | 无 | **P2** |
| 5 | 变变管理 | `/bianbian` | `BianbianManage.vue` | 无 | P3 |
| 6 | 数据浏览 | `/database` | `Database/DataBrowser.vue` | 无 | P3 |
| 7 | MCP 管理 | `/mcp` | `McpAdminPanel.vue` | 无 | P4 |
| 8 | Agents（12 页） | `/agents/**`（概览/观测/能力资产/知识集合/检索调试/对话记录/Run 详情/定义管理/技能库/对话调试） | `Agents/*.vue`（12 个） | 无 | P4 |
| 9 | 系统设置 | `/settings` | `Settings.vue` | **已有** `admin-settings.html` | 已完成 |
| 10 | 登录 / 403 / 404 | `/login`、`/403`、`/` 兜底 | `Login.vue`、`Forbidden.vue`、`NotFound.vue` | 无 | P5 |
| — | 壳 / 布局 | — | `App.vue`、`layouts/BasicLayout.vue` | 已在 `admin-settings.html` 里还原 | 复用 |

## 4. 方法与约定（照做即可，不用重新决策）

1. **角色与流程**：用 `ux-prototype-designer` skill 的流程 —— 确认目标端（**桌面 Web**）→ 梳理信息架构 →
   产出单文件 HTML → 过 `references/ux-review-checklist.md` → 交人确认 → 回填 page-spec（`docs/ui/page-spec-template.md`）。
2. **壳与 token 复用**：以 `docs/ui/prototypes/admin-settings.html` 为**壳样板**（侧栏 210px + 顶栏 56px + 内容区）：
   - token 引 `packages/ui/src/tokens.ts` 的 **`roles.light`**（`--ws-*`）；品牌橙用 `--ws-brand-500` / 文本态 `--ws-brand-600`（design-system G4）；
     admin 侧栏选中/logo 用 `--ws-accent`（`#FF8C42`，与 `BasicLayout.vue` 一致）
   - 单文件零依赖、浏览器双击可开；**不引**外部 CSS/JS/CDN；不写裸 hex（除 `:root` 定义）；不用 emoji（图标用内联 SVG）
3. **内容真实性**：字段、按钮、空/错/无权限文案**对照落地 `.vue` 与接口**写，不使用 lorem/占位堆砌；
   每个模块稿需覆盖**状态矩阵**：加载中 / 空态 / 错误可重试 / 无权限（`403`）/ 主操作 loading 防重复提交；
   破坏性操作要有二次确认文案。
4. **文件与登记**（照 `docs/ui/prototypes/README.md` §四 维护约定）：
   - 原型文件：`docs/ui/prototypes/admin-<module>.html`（如 `admin-users.html`）
   - 质检记录：`docs/ui/prototypes/admin-<module>-质检记录.md`（设计决策 + A~I 逐条结论 + 浏览器实跑证据）
   - 在 `docs/ui/prototypes/README.md`「一、当前有效」表登记，质检记录登记到「三、质检记录」
   - 若某模块同时要改落地代码：原型/规格**单独 commit**，落地 commit message 带 `Proto: <原型 commit sha>`
5. **验证**：每份稿至少做一次浏览器实跑（`playwright-cli` + 本地静态服务；注意 `file:` 协议被禁，用 `python3 -m http.server`），
   把关键断言（导航可达 / 主路径闭环 / 各状态可见 / 无死链）写进质检记录。
6. **不做**：不改任何落地代码（`apps/**`）；不动 deploy-console / portal / 小程序的原型；不做 `data-dr` 锚点回填（走 `anchor-backlog.md` 自己的批次）。

## 5. 交付物与验收判据（DoD）

- [ ] 每个模块一份可点击 HTML（P1~P5 全部完成；也可按批次分批交付，每批单独 commit）
- [ ] 每份配套质检记录（A~I 逐条 + 浏览器实跑证据），**无未处理阻塞项**
- [ ] `docs/ui/prototypes/README.md` 已登记（原型 + 质检记录）
- [ ] 信息架构可达：从壳的侧栏菜单能走到该模块的每个页面，且都有返回路径
- [ ] 状态矩阵齐全（加载/空/错/无权限/主操作 loading），文案为真实业务文案
- [ ] 与落地一致性：字段与交互与 `.vue` 对齐；不一致处在质检记录里显式标注（「原型简化」或「落地待改」）
- [ ] 全程未改落地代码

## 6. 建议顺序（每批一次人审）

| 批次 | 内容 | 为什么这个顺序 |
|---|---|---|
| P1 | 用户管理（列表 + 详情） | 使用频率最高，权限/角色相关字段多，最易产生交互分歧 |
| P2 | 角色权限、字典管理/编辑 | 权限与配置类页面，误操作代价高（删角色/改字典） |
| P3 | 变变管理、数据浏览 | 数据浏览涉敏感数据（需强调只读与脱敏呈现） |
| P4 | MCP 管理、Agents 12 页 | 页面最多、信息架构最复杂，放最后重量级处理 |
| P5 | 工作台、登录、403/404 | 例外页与首页，视觉为主，交互少 |

## 7. 参考

- 壳样板：`docs/ui/prototypes/admin-settings.html`（2026-09-22，含 `[原型]` 对照/状态控件写法）
- 设计系统：`docs/ui/design-system.md`（G1 色值只引 token / G4 品牌橙文本档）、`docs/ui/color-reference.md`、`docs/ui/css-override-rules.md`
- 规格模板：`docs/ui/page-spec-template.md`；页面级规格存放 `specs/**/page-spec*.md`
- 原型能力：`.codebuddy/skills/ux-prototype-designer/`（workflow + `references/prototype-common.md` + `references/ux-review-checklist.md`）
- 已完成的样例（含质检记录写法）：`docs/ui/prototypes/deploy-console-settings-storage-质检记录.md`
- 设计锚点与 `data-dr`：`docs/ui/anchor-backlog.md`、`specs/design-reviewer/design.md` §3.7.1

## 8. 给新会话的开场白（可直接粘贴）

> 按 `specs/admin-prototype-coverage/tasks.md` 执行 admin 原型补齐：先做 **P1 用户管理（列表 + 详情）**，
> 以 `docs/ui/prototypes/admin-settings.html` 为壳样板、token 引 `roles.light` + `--ws-accent`；
> 产出 `docs/ui/prototypes/admin-users.html` + `docs/ui/prototypes/admin-users-质检记录.md`，
> 过 `ux-review-checklist` 并做浏览器实跑，登记 `docs/ui/prototypes/README.md`；
> 原型/规格单独 commit，**不要改落地代码**。
