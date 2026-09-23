# 圆角语义档 + 双风格偏好（柔和 / 清爽）· 页面规格

> 原型稿：`docs/ui/prototypes/radius-style-dual.html`
> 判据源：`docs/ui/design-system.md` §2.5 G7（圆角取圆角档、同层级一致）、P2（一致性优先）、I3（密度与圆角）；`specs/ui-prototype-token-alignment/整改影响清单.md` §7.3（品牌端圆角阶梯，负责人已确认 2026-09-23）
> 状态：**原型待人工确认**（动作门第 3 步未过，禁止落码）
> 修订：2026-09-23 按 D2 盲审意见修正（统一两端基线、元素→档封闭映射、AC2 可验证化）

## 1. 背景与目标

现状问题：三端圆角**语义混乱**——同一"按钮"在 `--ws-radius-sm/md/lg` 与裸值（4/6/8/10/12/14/16/20px 与 rpx 值）之间随页面取值，同层级元素不一致（违反 G7）。

目标两条（互为因果）：

1. **收敛**：圆角用法统一到 4 个**语义档**（chip / control / card / pill），业务样式不再直接引用裸值。
2. **双风格**：新增用户偏好 `圆角风格`（柔和 / 清爽）。柔和 = 现状值（**零视觉变化，向后兼容**）；清爽 = 更小圆角。风格差异只体现在语义档取值上。

## 2. 语义档契约（元素封闭映射）

**两端基线统一为 4 / 6 / 8px**（品牌端落地 8 / 12 / 16rpx，依整改清单 §7.3 已确认口径）——不存在"品牌端放大一档"。

| 语义档 | 覆盖元素（封闭清单） | 柔和（默认） | 清爽 | 直角 |
|---|---|---|---|---|
| `--r-chip` | 标签、徽标、微角、代码片段背景 | 4px (8rpx) | **2px (4rpx)** | **0px** |
| `--r-control` | 输入框、按钮、选择器、下拉、分段控件、日期选择、上传按钮 | 6px (12rpx) | **2px (4rpx)** | **0px** |
| `--r-card` | 卡片、面板、弹窗、抽屉、列表容器、表格容器、Popover/Dropdown 面板 | 8px (16rpx) | **4px (8rpx)** | **2px** |
| `--r-pill` | 胶囊按钮、**开关（轨道 + 圆钮）**、标签式筛选片 | 9999px | 9999px | 9999px（风格无关） |
| *不参与* | `border-radius:50%`（头像/状态点/圆形图标）、`border-radius:0`（气泡贴边角/贴边抽屉） | 字面值 | 字面值 | 字面值 |

配套规则：

- **R1**：业务样式**只允许**引用上述 4 档；禁止裸 px / rpx 字面值（G1 口径同）。
- **R2**：旧尺寸档 `--ws-radius-sm/md/lg` 保留（作为语义档的**底层真源**，见 §3.1），新代码**推荐**语义档；两者在两种风格下取值一致。
- **R3**：`50%` 与 `0` 不纳入切换（保持字面值）。
- **R4**：派生值（分段控件内层等）用 `--r-control-inner: max(0px, calc(var(--r-control) - 2px))`。清爽档 `control=2px` 时结果为 `0`（方角内层嵌于 2px 外层容器，属可接受形态）；**禁止**裸写 `calc()` 而不兜底。
- **R5**：**开关归 `--r-pill`**（轨道与圆钮皆圆形语义），**不归 control** —— 原型与规格表述已统一。

## 3. 双风格机制

统一约定：根元素属性 `<html data-radius="soft|crisp">`，默认 `soft`（首次访问即柔和）。

```css
/* 底层：尺寸档（唯一真源） */
:root                 { --ws-radius-sm:4px; --ws-radius-md:6px; --ws-radius-lg:8px; }
[data-radius="crisp"] { --ws-radius-sm:2px; --ws-radius-md:2px; --ws-radius-lg:4px; }
[data-radius="sharp"] { --ws-radius-sm:0px; --ws-radius-md:0px; --ws-radius-lg:2px; }

/* 业务层：语义别名 + 派生兜底 */
:root { --r-chip:var(--ws-radius-sm); --r-control:var(--ws-radius-md); --r-card:var(--ws-radius-lg);
        --r-control-inner:max(0px, calc(var(--r-control) - 2px)); }
```

- 真源落点：`packages/ui/src/tokens.css` + `packages/ui/src/tokens.ts`（`radius` 增语义档字段）。
- **因两端基线一致，无需 `data-scale` 分支**（此前版本的分支与 AC2 冲突，已移除）。
- **实现约束（2026-09-23 实测踩坑，必读）**：CSS 自定义属性的 `var()` 在**声明处**解析。若只在 `:root` 声明 `--r-control:var(--ws-radius-md)`，而尺寸档覆盖发生在**另一个元素**上（如某面板/组件根挂 `data-radius`），别名**不会跟随覆盖**（它已在 `:root` 定值为 6px），表现为"切了风格但页面没变化"。
  → 落地时**必须**把「尺寸档覆盖」与「语义别名」声明在**同一元素**（`html`）上（两者同元素时 `var()` 解析正确）；**组件/容器内不得再挂 `data-radius`**。原型演示台因把属性挂在并排面板上，故每个覆盖块（`crisp` / `sharp`）都重声明了一次别名与 `--r-control-inner`。
- **三档取值（2026-09-23 已定）**：柔和 `4/6/8`（默认）· 清爽 `2/2/4` · 直角 `0/0/2`。原型三列并排对照（实测按钮 6px → 2px → 0px）。

### 3.1 与并行「新规范整改」的关系（兼容口径）

整改清单（`specs/ui-prototype-token-alignment/整改影响清单.md`）正把业务裸值 → 尺寸档 `--ws-radius-*`，圆角是其中一条判据。**本方案不废除该批成果，反而让其自动获得风格能力**：

- 双风格直接覆盖**尺寸档**的值 → 已完成整改的页面（引用尺寸档）**自动跟随风格，无需回改**。
- 整改清单 §1 的判据（「`border-radius` 写字面值，未引 `radius-*`」）**无需修订**，继续有效。
- 需修订的是清单 **§7.3 品牌端圆角阶梯注释**：现为 4/6/8px（8/12/16rpx），与本规格一致，补一行「该档值随用户圆角偏好切换」即可。

## 4. 四端落点

### 4.1 portal

| 项 | 落点 |
|---|---|
| 入口 | `views/Profile.vue` 第 **78 行**插入「偏好」卡片（`profile-card info-card` + `card-title` + `form-section/form-row`） |
| 交互 | `a-radio-group button-style="solid"`（与「基本信息-性别」行同款，portal 唯一在用的分段控件） |
| 状态 | 新增偏好 store（Pinia + `persist` localStorage，照 `stores/user.ts` 的 `user-store` 模式），key 建议 `ui-prefs` |
| 应用 | 根节点写 `data-radius`；portal **目前无任何主题层**，需新建写入器（启动 + 切换时） |
| 样式 | `Profile.vue` `<style scoped>` 新增 `.form-hint`（走 `var(--ws-text-tertiary)`，无裸色值） |
| **antd 圆角** | `App.vue` 的 ConfigProvider `theme` 由硬编码常量改为 computed：按 `uiPrefs.radiusStyle` 取 `uiTokens.radiusStyle[...]` 的 control/card/chip → `borderRadius` / `borderRadiusLG` / `borderRadiusSM`（§4.3 同一坑）。**只覆盖圆角 token**，其余保持 portal 原有覆盖，避免引入非圆角视觉变化 |
| **已登记视觉变化（AC2 例外）** | portal antd 圆角由硬编码 `borderRadius: 8` **收敛为语义档**。注：antd 的 `borderRadiusLG/SM` 由 base 派生（base=8 → LG=10 / SM=6），故收敛后为三处变化：基础 `8→6`、**LG `10→8`**、**SM `6→4`**（D3 复核确认已全部登记）。此为「收敛到语义档」的显式代价，非缺陷 |
| **首屏预置（AC6）** | `apps/portal/index.html` `<head>` 内联脚本：样式生效前读 `localStorage['ui-prefs'].radiusStyle`，为 crisp/sharp 时写根属性（soft 不写 = 默认柔和） |
| **入口一致性** | `lifecycle.ts`（微前端）与 `main-standalone.ts`（独立运行）**都**调用 `useUiPrefsStore(pinia).init()` |
| **卸载复位** | `lifecycle.ts` `unmount()` 移除 `data-radius`：避免偏好残留在宿主 `<html>` 上影响其他模块。多模块共存时**不做仲裁**（各端接入时写各自值，末次写入生效） |

### 4.2 小程序（kedou-ai-minigram）

| 项 | 落点 |
|---|---|
| 入口 | `pages/mine/settings/settings.wxml` 第 **5 行**（「字体大小」行）之后，同一 `.list` 内加一行 `圆角风格 / {{radiusText}} ›` |
| 交互 | 新增 `pickRadius()`，照 `pickFont()` 的 `wx.showActionSheet({itemList:['柔和','清爽','直角']})` 同构 |
| **必须先补** | ① `app.wxss` 的 `page{}` token 段（现 L6–L57）**目前无任何圆角 token** → 先建 `--r-chip/--r-control/--r-card/--r-pill`（按 1px≈2rpx 换算）；② 覆盖类 `.page.radius-crisp{--r-chip:4rpx;--r-control:4rpx;--r-card:8rpx}` |
| **根 class 绑定** | `page` 元素**无法绑定 class** → 各页根 `<view class="page {{radiusClass}}">` 绑定（**实测 30 处**）；`radiusClass` 由新建 `utils/appearance.ts`（读 storage）在 `onShow` 提供 |
| 持久化 | `wx.setStorageSync('appearance_radius', 'soft'\|'crisp')` |
| 例外 | 保留 `50%` 与 `border-radius:0`；`music-card` 等自定义组件可通过 CSS 变量继承 |

### 4.3 admin

| 项 | 落点 |
|---|---|
| 入口 | `views/Settings.vue` 第 **193 行**（`quota` pane 结束）与第 195 行（`logs` pane 开始）之间插入 `<a-tab-pane key="appearance" tab="外观">` |
| 状态 | 扩展 `stores/theme.ts`（persist key `theme-store`）：加 `radiusStyle` + `setRadiusStyle()`，并让 `applyTheme()` 同时 `setAttribute('data-radius', ...)` |
| **关键坑** | antd 的 `borderRadius` 来自 **JS 常量**（`packages/ui/src/antd-theme.ts` 第 71 行 `borderRadius: t.radius.md`），**只改 CSS 变量对 antd 组件无效** → 需让 `antdTheme()` 按风格取档，并在 `apps/admin/src/App.vue` 把 `themeConfig` 的 watch 源从 `isDark` 扩为 `[isDark, radiusStyle]` |
| 待确认 | 深色模式切换在 `BasicLayout.vue` 顶栏、圆角风格在设置页 → 同类偏好**两处入口**，是否统一见 §7.3 |

### 4.4 deploy-console

| 项 | 落点 |
|---|---|
| 入口 | `views/SystemSettings.vue` 新增「外观」卡片（现为 通知渠道 / 审批门禁 / 存储配置 三卡） |
| 状态 | **无偏好 store**（`App.vue` 的 theme 是组件内 ref，仅被动读 `data-theme`）→ 新建偏好载体（localStorage + 根节点写入）；可与 admin 共用 `theme-store` key 以复用同一偏好 |
| 应用 | `App.vue` 第 52 行 `ConfigProvider :theme` 覆盖 `token.borderRadius`；第 31–43 行 `syncThemeFromDom/onMounted` 旁补 `data-radius` 同步，并把 `MutationObserver` 的 `attributeFilter` 从 `['data-theme']` **扩为 `['data-theme','data-radius']`** |
| 外壳 | 外壳固定深色（不随 `data-theme`），**仅圆角跟随偏好** |

## 5. 存量收敛策略

不做一次性全量替换（回归面过大）。策略：**新代码走语义档 + 存量按页面逐步收敛**。

| 端 | 裸值圆角规模 | Top 文件 |
|---|---|---|
| portal | ~136 处 / 30 文件 | Draw 14、Create 11、LoginPanel 10、Home 9、Profile 8 |
| 小程序 | ~190 处 / 31 文件 | contract/result 23、chat/index 19、contract/assistant 14 |
| admin | ~90 处 / 24 文件 | AgentPlayground 15、BianbianManage 14 |
| deploy-console | ~90 处 / 26 文件 | OrchestrationEditor 14、ProgressFlow 12 |

收敛时须跳过 §2「不参与」例外。

## 6. 验收判据（EARS）

- **AC1**｜当用户在任一端把「圆角风格」切为清爽，则该端所有引用尺寸档或语义档的元素应立即变化，且 chip/control/card = 2/2/4px（品牌端 4/4/8rpx）。
- **AC2**｜当风格为柔和，则**引用尺寸档/语义档的元素取值与改动前逐项一致**（`--ws-radius-sm/md/lg` 仍为 4/6/8px）——即对已完成 token 化的页面**零视觉变化**；裸值元素本就不引用变量，不在本条范围。
- **AC3**｜当用户刷新页面或重进小程序，偏好应从本地存储恢复；**admin 需同时恢复 antd 组件的 `borderRadius`**（非仅 CSS 变量）。
- **AC4**｜当风格切换时，`50%` 元素与 `0` 角元素形态不变。
- **AC5**｜当风格为清爽，所有 `calc()` 派生圆角经 `max(0px, …)` 兜底，无负值。
- **AC6**｜首次访问（无偏好记录）默认必须为 `soft`；且**反向亦成立**——清爽用户首屏不得先以柔和渲染再跳变（`index.html` 内联预置根属性）。

## 7. 决策记录 / 风险

> **圆角风格三档（2026-09-23 已定）**：柔和（4/6/8，默认）· 清爽（2/2/4）· 直角（0/0/2）。下列各项已按推荐落定，落码直接执行。

1. **端范围**：四端全做；实施序 portal → 小程序 → admin → console（console 无偏好载体，成本最高）。
2. **跨端同步**：本期各端**本地存储、不跨端同步**（后端无用户偏好接口）；跟账号走另立项。
3. **admin 入口**：圆角风格进 `Settings.vue` 新增「外观」Tab；深色模式保留顶栏快捷开关，并在「外观」Tab 内提供同一开关（两处入口同一 store，不产生第二份状态）。
4. **I3 修订**：`design-system.md` I3 的「品牌端卡片大圆角」改为「品牌端留白/密度更松；圆角按 §2 语义档（两端同值 4/6/8）」。
5. **未归类元素（已归类）**：进度条/骨架条、checkbox/radio → `--r-chip`；菜单选中项背景、Toast/Message、分页器 → `--r-control`；Tooltip/Popover/Dropdown 面板、上传拖拽区 → `--r-card`。
6. **pill 策略**：`--r-pill` **恒 9999px**，三档都不变（圆是形状语义、非圆角风格；开关轨道须圆头）。直角档下「矩形全直角 + 胶囊仍圆」的反差按此执行；若要收窄 pill 请在落码前提出。
7. **antd 派生档**：`antd-theme.ts` 落码时**显式**给 `borderRadius` / `borderRadiusLG` / `borderRadiusSM`（按当前档取语义档），避免组件内派生值不自洽。
8. **判据源同步**：`design-system.md` G7 改为「圆角取**语义档**（chip/control/card/pill），风格由用户偏好统一决定」；并同步 `ui-interface/RULE.mdc` 与 `brand-interface/RULE.mdc` 最小禁项精要。

## 8. 实施顺序（落码阶段，须先过人审）

| 步 | 内容 | 门 |
|---|---|---|
| 1 | `tokens.css` + `tokens.ts` 增语义档与清爽覆盖；`antd-theme.ts` 支持按风格取档 | 本规格（packages/ui 改动） |
| 2 | portal：偏好 store + 根节点写入器 + `Profile.vue` 偏好卡片 | 本条 + 原型 |
| 3 | 小程序：`app.wxss` 圆角变量层 + `utils/appearance.ts` + 根 view 绑定（30 处）+ settings 行 | 本条 + 原型 |
| 4 | admin：theme store 扩 `radiusStyle` + App.vue themeConfig + Settings.vue 外观 Tab | 本条 + 原型 |
| 5 | deploy-console：偏好载体 + 根节点同步 + SystemSettings 外观卡片 | 本条 + 原型 |
| 6 | 存量逐页收敛（按 §5，独立分批） | 各页自身规格 |

每步 UI commit 的 message 必须带 `Proto: <sha>`（原型/规格的单独 commit sha）。
