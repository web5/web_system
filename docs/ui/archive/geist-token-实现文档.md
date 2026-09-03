# Geist 范式 Token 化改造 · 详细实现文档

> 配套：《geist-token-需求文档.md》（同目录）—— 本文档只讲 How，目标/边界/优先级见需求文档。
> 版本：v1.0（草稿待评审）｜ 日期：2026-09-02 ｜ 状态：待评审
> 适用范围：packages/ui + apps/deploy-console（试点）；admin/mcp-admin 灰度见第 6 节

---

## 0. 新会话接力清单（每次开工先做）

1. 读本文件 + 需求文档（~10 分钟，恢复全部上下文）。
2. 复核现状基线是否变化：
   ```bash
   cd /Users/geekwen/workspace/web_system
   git status --short                # 有无未提交改动
   cat packages/ui/package.json      # 结构是否仍如上文
   ls apps/deploy-console/src/views  # 试点页面是否仍在
   ```
3. 确认需求文档 DR-3（品牌主橙裁决）是否已确认；未确认则开工前问用户一次。
4. 找到本次里程碑：若 M2 未动，从 4.1 开始；若 M4 进行中，从 5.3 继续并更新评审记录。
5. 执行完任何文件改动后，跑对应 app 的 `pnpm dev` 目检 + 更新 `docs/ui/geist-token-评审记录.md`（P1-4）。

---

## 1. 目标架构

```
┌─────────────────────────────────────────────────────┐
│ 业务消费层  apps/{deploy-console,admin,...}         │
│   Vue 组件引用 CSS 变量(var(--x)) / ConfigProvider   │
├─────────────────────────────────────────────────────┤
│ 适配层      @web-system/ui                          │
│   antd-theme.ts  (ThemeConfig: 全局token+组件token)  │
│   theme.css      (收敛后的 antd 兜底覆盖, 极少)       │
├─────────────────────────────────────────────────────┤
│ Token 层    语义 Token（唯一事实源，单份定义）        │
│   tokens.css   :root[data-theme=light|dark] 双值     │
│   → 派生：antd-theme.ts 引用同名常量                 │
└─────────────────────────────────────────────────────┘
```

关键点（对应需求 P0-6 / 原则 2）：
- **antd 能力内用 ConfigProvider token 表达，CSS 覆盖只兜 antd 表达不了的**；`!important` 从"常态"降级为"例外"。
- Token 常量定义在 TS 侧一份（供 antd-theme.ts 引用的同时可导出），CSS 变量一份（供业务 var()），两者由**同一数值源**生成（实施时可用一个 `tokens.ts` 常量 + 脚本/手动同步生成 `tokens.css`，避免二次漂移）。
  - 轻量做法（推荐先做）：`packages/ui/src/tokens.ts` 导出 `uiTokens = { colors:{...}, radius, font }`，`antd-theme.ts` 从 `uiTokens` 映射；`tokens.css` 的变量值由 `uiTokens` 注释标注来源，人工保持同步（当前无构建流水线，先不做自动生成，留 TODO）。

---

## 2. Token 规范详细设计

### 2.1 命名规范

| 类别 | 前缀 | 示例 | 说明 |
|---|---|---|---|
| 中性灰 | `--ws-gray-{100..1000}` | `--ws-gray-1000` | 10 步，数字越大越深（light）；dark 下同一语义数字映射反向深浅 |
| 品牌橙 | `--ws-brand-{50..900}` | `--ws-brand-500` | 沿用仓库既有 Tailwind orange 系值 |
| 语义色 | `--ws-{success|warning|error|info}-{100..700}` | `--ws-error-500` | 至少 500 主色 + 100 底色 |
| 功能/语义角色 | `--ws-{bg|text|border}-{role}` | `--ws-text-primary` | 高层语义，向下引用 scale，业务优先用此层 |
| 其他 | `--ws-radius-*` `--ws-space-*` `--ws-shadow-*` `--ws-font-*` | | 分组前缀 |
| 兼容 alias | 旧名（--color-brand-*、--surface-*、--text-*、--border-*…）保留映射 | | 过渡期双写，见 7.1 |

### 2.2 色板（建议值；落地时微调并回填本表）

**品牌橙 scale（主色 #F97316 = 500）**：直接沿用仓库既有值，补齐 300/800/900：

| step | hex | step | hex |
|---|---|---|---|
| 50 | #FFF7ED | 600 | #EA580C |
| 100 | #FFEDD5 | 700 | #C2410C |
| 200 | #FED7AA | 800 | #9A3412 |
| 300 | #FDBA74 | 900 | #7C2D12 |
| 400 | #FB923C | — | — |
| **500** | **#F97316** | 强调(暖橙 accent，历史 spec) | #FF8C42（降级作 hover/图表强调，DR-3） |

**中性灰 scale（Light，参考 Geist 纯净灰阶，弃用 Element Plus 蓝调灰）**：

| step | 角色（Geist intent 语义） | light hex | dark hex |
|---|---|---|---|
| 100 | 默认背景/卡片面（bg-100） | #FAFAFA | #0A0A0A |
| 200 | hover 背景 / 次级面 | #F2F2F2 | #111111 |
| 300 | active 背景 / recessed | #EBEBEB | #1A1A1A |
| 400 | 默认边框（border） | #E5E5E5 | #2A2A2A |
| 500 | hover 边框 / 分隔 | #D4D4D4 | #333333 |
| 600 | 禁用/图标弱 | #A3A3A3 | #525252 |
| 700 | 实心填充高对比 | #737373 | #737373 |
| 800 | 弱文本 | #525252 | #A3A3A3 |
| 900 | 次文本/图标 | #262626 | #D4D4D4 |
| 1000 | 主文本 | #171717 | #EDEDED |

说明：
- 100 步语义沿用 Geist 文档：100 默认背景 / 200 hover 背景 / 300 active / 400 边框 / 500 hover 边框 / 700 实心 / 900 次文本 / 1000 主文本。
- dark 是"同一数字、镜像深浅"，不新增命名。
- 替换影响：现仓库 `--surface-0 ~ 4`（#F5F7FA/#FFF/#FFF/#FAFAFA/#F5F7FA）、`--text-*`、`--border-*` 全部归一到 gray scale 对应角色（alias 见 7.1）。

**语义色（antd 对齐）**：

| 语义 | 主色(500) | 底色(100) | 说明 |
|---|---|---|---|
| success | #398E4A | #EAF6EC | antd colorSuccess |
| warning | #B8860B 建议改 Geist amber #F5A623 | — | 用 amber 系，见下 |
| error | #E5484D | #FCEBEC | antd colorError |
| info | = 品牌橙 #F97316 | — | admin 信息色沿用品牌（Geist 用蓝做交互，此处尊重品牌，交互色=橙） |

> 注意：Geist 用蓝 #0072F5 作唯一交互点缀；本项目 DR 未采纳蓝，**交互点缀 = 品牌橙**，蓝仅预留给未来"第三方/外部链接"类区分（可选）。warning 建议整段取 amber 系（#F5A623/#BA7517 区间），落值时统一微调。

### 2.3 语义角色映射（业务优先引用这一层，别直接抓 scale）

| 角色变量 | light 取值（建议） | 对应旧变量（alias） |
|---|---|---|
| `--ws-bg-page` | gray-100 #FAFAFA | --surface-0 |
| `--ws-bg-surface` | #FFFFFF | --surface-1/2 |
| `--ws-bg-subtle` | gray-200 #F2F2F2 | --surface-3/4、--table-header-bg、--tab-bg |
| `--ws-bg-hover` | gray-200（alpha 亦可） | --table-hover-bg |
| `--ws-text-primary` | gray-1000 #171717 | --text-primary/heading |
| `--ws-text-secondary` | gray-800 #525252 | --text-body/secondary |
| `--ws-text-tertiary` | gray-600 #A3A3A3 | --text-tertiary/muted/faint |
| `--ws-text-disabled` | gray-500 #D4D4D4 | --text-disabled |
| `--ws-border` | gray-400 #E5E5E5 | --border-default |
| `--ws-border-subtle` | gray-300 #EBEBEB | --border-subtle/lighter/divider/表行边框 |
| `--ws-input-bg/border/placeholder` | surface/gray-400/gray-500 | 对应旧 --input-* |

### 2.4 Typography

| token | 建议 | 备注 |
|---|---|---|
| 字体栈 | `'Inter', -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif` | 中文回退系统栈；不引 Geist 字体（P2-2） |
| mono 栈 | `'Geist Mono','JetBrains Mono',ui-monospace,'SF Mono',Menlo,Consolas,monospace` | 代码/端口/标识/表格数字 |
| 字重哲学 | **只用 400/500/600，废弃 700+**（页面正文 400；表头/导航/小节 500；标题/强调 600） | Geist 三字重规则 |
| 表格数字 | `font-variant-numeric: tabular-nums`（Table 全局 class 或 body 默认） | 运维数据对齐 |
| 标题梯度 | h1 32/600、h2 24/600、h3 18/500、h4 16/500、正文 14、caption 12 | antd fontSize 体系内对齐 |
| 字号基线 | antd fontSize=14（保持），对应 token 映射 | — |

### 2.5 圆角 / 间距 / 边框技法 / 阴影

| 类别 | token 建议 | 备注 |
|---|---|---|
| radius | sm 4 / md 6 / lg 8 / pill 9999 | 现 borderRadius=4 → 升级为 sm=4、组件默认 md=6（antd borderRadius token=6 统一感更强），**落值前与用户确认是否动全局 4→6** |
| space | 4 的倍数 4/8/12/16/24/32/48 | 沿用 antd 惯例 |
| 边框技法 | **shadow-as-border**：`box-shadow: 0 0 0 1px var(--ws-border)` 替代常规 border 用于卡片/面板（可随圆角/层级平滑），普通分隔线仍用 border | Geist 特色，试点页卡片类优先体验 |
| 阴影 | 卡片 0 1px 2px rgba(0,0,0,.06) + 0 2px 8px rgba(0,0,0,.04) 双层；弹窗更深一层 | 收敛现 0 2px 12px 单层 |

### 2.6 暗色主题

- 机制沿用：`:root` 默认 light 值 + `[data-theme='dark']` 覆盖（**单开关全局生效**，开关实现由宿主 app 控制 data-theme 属性，本轮不做 UI 开关，仅保证切换即生效）。
- gray scale dark 列已见 2.2；语义色 dark 需调亮 100/200 底色与文字（落地时补表）。
- **注意现状坑**：现 tokens.css 的 `[data-theme='dark']` 块会整体覆盖，改造后要求 `[data-theme]` 两块与 `:root` 结构一致，避免遗漏变量导致暗色下回退到 light 值（灰阶应整体镜像）。

---

## 3. antd-theme.ts 适配详细

### 3.1 结构（antd v5 风格 theme token，ant-design-vue 4.x 支持）

```ts
// packages/ui/src/antd-theme.ts —— 目标形态
import type { ThemeConfig } from 'ant-design-vue/es/config-provider/context';
import { uiTokens } from './tokens';

export const antdTheme: ThemeConfig = {
  token: {
    colorPrimary: uiTokens.colors.brand[500],   // #F97316
    colorInfo: uiTokens.colors.brand[500],
    colorSuccess: uiTokens.colors.success[500],
    colorWarning: uiTokens.colors.warning[500],
    colorError: uiTokens.colors.error[500],
    colorTextBase: uiTokens.colors.gray[1000],
    colorText: uiTokens.colors.gray[1000],
    colorTextSecondary: uiTokens.colors.gray[800],
    colorTextTertiary: uiTokens.colors.gray[600],
    colorTextQuaternary: uiTokens.colors.gray[500],
    colorBgLayout: uiTokens.colors.gray[100],
    colorBgContainer: uiTokens.colors.bgSurface,   // #FFF
    colorBgElevated: uiTokens.colors.bgSurface,
    colorBorder: uiTokens.colors.gray[400],
    colorBorderSecondary: uiTokens.colors.gray[300],
    colorSplit: uiTokens.colors.gray[300],
    borderRadius: uiTokens.radius.md,               // 6（待 DR 确认 4→6）
    fontFamily: uiTokens.font.sans,
    controlHeight: 32,
    wireframe: false,
  },
  components: {
    Layout: { headerBg: 'var 化表面色', siderBg: ..., bodyBg: ... },
    Menu:  { itemSelectedBg, itemSelectedColor, itemColor, itemHoverBg, itemBg: 'transparent' },
    Table: { headerBg, headerColor, headerSplitColor, rowHoverBg, borderColor },
    Card:  { headerBg: 'transparent', colorBorderSecondary },
    Button: {},
    Form:  { labelColor },
    Tag:   {},
    Statistic: {},
    Modal: { contentBg },
  },
};
```

> 注意：组件级 token 的**准确属性名以 ant-design-vue 4.x 的 `ThemeConfig['components']` 类型为准**，写码时 `tsc` 会校验；上面仅列意图，不逐字照抄。

### 3.2 覆盖收敛原则（对应 P0-6）

- theme.css 中每条 `!important` 逐一判断归属：
  1. antd 有组件 token → 删除该条，改 components 配置；
  2. 是布局级语义（Layout 背景链）→ 用 token 或保留 1 条兜底；
  3. 登录页等特殊场景 → 保留但分组注释"例外：登录页专属"。
- 目标：试点改造后全仓库新增 0 条 `!important`；存量条目减量 ≥70%。
- 背景链一致性：Layout bodyBg → Table/Card 用 colorBgContainer，视觉上"页面灰、卡片白"分层由 token 自动成立，无需再逐条覆盖。

---

## 4. 文件级实施步骤（packages/ui 内部）

### 4.1 新增 `packages/ui/src/tokens.ts`
- 导出 `uiTokens`（colors.gray 100..1000 / brand 50..900 / success·warning·error·info / bgSurface / radius / font / space），类型 `UiTokens`。
- 同一文件顶部注释：**tokens.css 数值必须与此文件一致**（当前人工同步，自动生成留 TODO）。

### 4.2 重写 `packages/ui/src/tokens.css`
- `:root` = light 全量（gray scale 新名 + brand scale + 语义色 + 角色层 + radius/space/shadow/typography）+ **旧名 alias 块**（7.1）。
- `[data-theme='light']` 与 `:root` 合并去重（现状重复一份，直接删）；`[data-theme='dark']` 按 2.6 全量镜像。
- 颜色值全部与 tokens.ts 同源（注释引用）。

### 4.3 重写 `packages/ui/src/antd-theme.ts`
- 见第 3 节；从 `uiTokens` 取值；暗色适配通过 `算法函数 antdTheme(mode: 'light'|'dark')` 导出（App 侧按 data-theme 调用），或先导出 light 版 + 注释 dark 扩展点。

### 4.4 收敛 `packages/ui/src/theme.css`
- reset/全局保留；antd 覆盖条目按 3.2 收敛；.login-* 保留归组；新增 `.ws-table-nums { font-variant-numeric: tabular-nums; }`（或全局对 .ant-table 开）与 mono 工具类 `.ws-mono`。

### 4.5 更新 `package.json` exports
- 追加 `./theme.css` 已存在；若新增 `typography.css` 或仅并入 tokens.css 则不扩 exports（按实现选择记录）。

### 4.6 自检
```bash
cd packages/ui && pnpm build   # tsc 通过
```
- `pnpm dev` 前确认 apps 侧未引用被删旧名（grep 兜底，见 7.1）。

---

## 5. 试点实施（deploy-console · ServiceManager）

### 5.1 前置
- deploy-console `src/main.ts` 确认：引入 `@web-system/ui` 的 tokens.css/theme.css + `ConfigProvider`（用 antdTheme）。当前未引（基线 3.1），需补上：import 包导出后包 `App`。
- 保留/收敛 `src/style.scss` 的自定义业务样式，先做"去裸值"标记（P1-1 顺带部分）。

### 5.2 页面改造步骤
1. 打开 `views/ServiceManager.vue`，截图存档为 **Before 基线**（`docs/ui/baselines/deploy-console-service-manager-before.png`，目录不存在则创建）。
2. 全局替换页面中裸 hex/rgba → 对应 `var(--ws-*)`；圆角/阴影归一到 token。
3. 服务状态标签：状态 → `Tag` 使用语义色（running=success / error=error / 其它=default），统一 `<Tag color>` 或受控 class。
4. 操作按钮分级：主操作（重启/部署）= primary；次操作 = default；危险（停服/删除）= danger 语义；收敛"全页面都是蓝色按钮"的 antd 默认脸。
5. 表格列：端口/实例 ID/时间戳等加 `.ws-mono`；全表开 tabular-nums。
6. 卡片/搜索面板用 `shadow-as-border` 技法替换部分 border 观感。
7. 加 `data-theme='dark'` 临时切换验证（页面根部临时置属性或浏览器改 html 属性均可）。
8. 截图 After 基线 + 走查清单（5.4），评审记录写入 `docs/ui/geist-token-评审记录.md`。

### 5.3 验收走查清单（P0-4/5）

- [ ] 主色、hover、active 全程品牌橙，无 antd 默认蓝紫
- [ ] 页面背景灰/卡片白的分层与 token 一致
- [ ] 无新增 `!important`；table/card/layout 均经 ConfigProvider
- [ ] 服务状态、按钮语义、表格数字、代码文本符合 5.2
- [ ] 切 dark 无错位、无遗漏回退变量
- [ ] 旧名 alias 存在期无回归（7.1）
- [ ] Before/After 截图已存档

### 5.4 评审回流（P1-4 样板，每轮必须填）
每次人工修正按表格记录：`问题描述 → 是否重复 → 能否改写为可观察行为 → 归属（token/组件/规则/观察）→ 行动`。同一问题第 2 次出现即升格为规则。

---

## 6. 灰度与迁移节奏（P2 预备）

| 阶段 | 范围 | 前置条件 |
|---|---|---|
| 试点 | deploy-console ServiceManager → 全 12 页 | M4 验收 |
| admin | admin app + McpAdminPanel 主题拉齐 | 试点稳定 1 周 |
| mcp-admin/新端 | 新页面直接引用新包 | 包发布稳定 |
| shell | 基座注册全局 theme（微前端下子 app 主题一致性） | shell 改造排期 |
| portal/mini-app | **不参与**（DR-5） | — |

---

## 7. 风险与兼容

### 7.1 兼容 alias（必须保留至少一个版本周期）
- 重写 tokens.css 时**保留全部旧变量名**（--surface-*、--text-*、--border-*、--color-brand-*、--input-*、--table-*、--card-*、--header-*、--modal-*、--shadow-*、--tab-*、--tag-*、--login-*、--chart-*）指向新角色变量，避免存量页面/样式瞬间失效。
- 实测 apps 引用极少（基线 3.1），但 theme.css 内旧引用多——**先改 theme.css 消费点，再在试点页验证后，才允许在后续迭代删 alias**（删除动作单独开 PR，便于回滚）。

### 7.2 antd v4 token 名核对
- ant-design-vue 4.x 组件 token 名以官方类型为准确认，勿凭 antd v5 记忆全抄；`tsc` 编译期兜底。

### 7.3 暗色遗漏变量
- dark 块与 light 块变量必须一一对应（写码后用脚本 diff 两个块 key 集合，防遗漏）。

### 7.4 两套橙色裁决未定时的处理
- 若 DR-3 未确认，默认以现运行时 #F97316 实施（改动最小），spec 文档橙色问题在试点评审时一并裁决，不阻塞编码。

---

## 8. 验证与基线存档约定

- 目录：`docs/ui/baselines/`（截图 + 说明），命名 `{app}-{page}-{before|after}-{yyyy-mm-dd}.png`。
- 每次迭代前后各存一张；评审记录 `docs/ui/geist-token-评审记录.md` 追加（不覆盖历史）。
- 最终 M4 出口：Before/After + 走查清单通过 + 评审记录首轮回填。

---

*文档结束。实现时如遇与需求文档冲突，以需求文档第 9 节决策记录为准；新决策补录 DR 表。*
