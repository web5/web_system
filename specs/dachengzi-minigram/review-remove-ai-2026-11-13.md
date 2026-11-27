# AI 内容整改 · 大橙子英语小程序 · PRD + 交互原型 + 技术方案

> 建：2026-11-13
> 责任：rd-product（产品设计）
> 仓库：`/Users/geekwen/workspace/web_system`，小程序代码 `apps/dachengzi-minigram/`
> 真源：本文件（整改后唯一事实源）；规则真源指向 `研发方案与发布规范 v2`、`研发硬门禁跨智能体规范`
> 参考格式：同目录 `page-spec.md`（范围表 / 交互判据表 / 验收判据表 / 待拍板表）

---

## 0. 需求三件齐

【需求 / 问题陈述】
小程序「大橙子英语」（原「大橙子个人助理」，个人主体）因内含 AI 生成内容未通过微信审核。整改目标：**彻底移除 AI 对话 / 翻译能力与相关设置，只保留「新概念英语（NCE）逐句朗读 + 逐句收藏」这一纯学习能力**，使小程序内容合规可通过审核。

【目标用户】
个人主体英语学习者；场景：打开小程序 → 首页直达常用功能 → 选课文 → 逐句点读 → 收藏句子 → 我的里回看收藏。

【成功判据】
1. 代码层面：`pages/chat/*`、`packageTranslate/*`、`pages/mine/discover-settings/*`、`services/agent-stream.ts`、`utils/{feature-flags,translate-keys,translate-parse,chat-msg,history-cards,markdown,share-image}` 全部**删除**（git 无残留），非「隐藏」。
2. `app.json` 不含 chat/translate/discover-settings 页面注册、无 `packageTranslate` 分包、无 `preloadRule`、无 `permission.scope.record`。
3. NCE 详情页只剩「英文课文 + 逐句朗读 + 逐句收藏」，三种模式 / 点句译文 / 生词查词 / 参考译文 / 习题 / 导读问题 / 全文朗读控制条全删。
4. 生词本改造为「NCE 收藏」，`CollectPayload.sourceType` 增 `'nce'`，NCE 逐句可收藏。
5. 三 tab 目标态达成（见 §2）：首页=常用功能入口、发现=全部功能+添加常用、我的=无 AI 设置。
6. 全量文案中性化：无「AI / 对话 / 翻译 / 语音输入 / 讲解」等 AI 语义残留（about / agreement / login-gate desc 同步改）。

---

## 1. 方案定案（已拍板，不重开）

| # | 决策点 | 定案 | 备注 |
|---|---|---|---|
| D1 | NCE 详情页 | 全删，只留英文课文 + 逐句朗读 | 逐句加「收藏」入口 |
| D2 | 生词本 | 保留，改造为「NCE 收藏」 | `sourceType` 增 `'nce'` |
| D3 | 删除方式 | 彻底删除（非隐藏） | 见 §4 文件清单 |
| D4 | 首页/发现 | 首页=常用功能入口；发现=全部功能+「添加常用」 | 新增功能注册表 + 本地收藏 storage |
| D5 | 标题 | 「大橙子英语」保留 | app.json 已正确 |
| D6 | 后端 | 只改前端，后端接口不动 | agent/translate/glossary 被 web 端共用 |

---

## 2. 三 tab 目标态

| Tab | 现状 | 目标态 |
|---|---|---|
| 首页 `pages/home/index/index` | 问候 hero + 今日一句 + 新对话卡(开关) + NCE 卡 + 最近对话(开关) | 问候 hero + 今日一句 + **常用功能**（默认 NCE）+「更多功能」跳发现；**删新对话卡 / 最近对话** |
| 发现 `pages/discover/index/index` | NCE + 对话练习(开关) + 文本翻译(开关) | **全部功能列表**（NCE + 收藏），每项带「添加常用」；**删对话/翻译卡** |
| 我的 `pages/mine/index/index` | 头像 + 翻译记录(开关) + 课文进度 + 生词本 + 翻译设置(开关) + 设置 + 协议 + 关于 | 头像 + 课文进度 + **收藏** + 设置 + 协议 + 关于；**删翻译记录 / 翻译设置** |

---

## 3. 交互原型（ASCII 版）

### 3.1 首页（tab 1）
```
┌──────────────────────────────┐
│ [橙] 下午好                    │  ← 问候 hero（保留）
│      今天想学哪一课？           │
├──────────────────────────────┤
│ 今日一句                      │  ← 今日一句（保留）
│  「慢慢来，比较快。」           │
│  Slow is smooth, smooth is    │
│  fast.                        │
├──────────────────────────────┤
│ 常用功能                      │  ← 新：注册表 pinned 项
│ ┌──────────────────────────┐ │
│ │ [英] 新概念英语        ›  │ │  ← 默认常驻（NCE）
│ │      NCE 逐句精读·点句朗读 │ │
│ └──────────────────────────┘ │
│ ┌──────────────────────────┐ │
│ │ [藏] 收藏            ›    │ │  ← 若用户「添加常用」则出现
│ │      收藏的句子，随时回看   │ │
│ └──────────────────────────┘ │
│  每天一句，稳步进阶。           │
└──────────────────────────────┘
```

### 3.2 发现（tab 2）
```
┌──────────────────────────────┐
│ 全部功能                      │
│ ┌──────────────────────────┐ │
│ │ [英] 新概念英语    [已添加]│ │  ← 常用标记（★实心）
│ │      NCE 逐句精读·点句朗读 │ │
│ └──────────────────────────┘ │
│ ┌──────────────────────────┐ │
│ │ [藏] 收藏         [+添加] │ │  ← 可加常用（☆空心）
│ │      收藏的句子，随时回看   │ │
│ └──────────────────────────┘ │
│  更多内容持续更新中            │
└──────────────────────────────┘
```

### 3.3 我的（tab 3）
```
┌──────────────────────────────┐
│ (头像) 点击设置昵称       ›    │
│        138****6688            │
├──────────────────────────────┤
│ 课文学习进度        未开始 ›   │
│ 收藏               N 条 ›     │  ← 生词本 → 收藏
├──────────────────────────────┤
│ 设置                  ›       │
│ 用户协议与隐私政策     ›       │
│ 关于与免责            ›       │
└──────────────────────────────┘
```
（已删：我的翻译记录、翻译设置两行）

### 3.4 NCE 详情（只留英文课文 + 逐句朗读 + 逐句收藏）
```
┌──────────────────────────────┐
│ Lesson 12 · A private ...    │
│ 字号  A-  A  A+              │  ← 字号保留（纯阅读偏好）
├──────────────────────────────┤
│ Last week I went to the    ♪ ☆
│ theatre.                      │
│ I had a very good seat.    ♪ ☆
│                              │
│ ▶ The play was very        ♪ ☆  ← 朗读中高亮（点同一句=停）
│   interesting.                │
│ ...                           │
├──────────────────────────────┤
│ ‹ 上一课        下一课 ›      │
└──────────────────────────────┘
```
- 点某句正文 → 播放该句（`readingLineIdx` 高亮 + 句首 ▶/♪ 态）；再点同一句 → 停止。
- 点句末「☆」→ 收藏该句（catchtap 隔离，不触发朗读）。
- 已删：沉浸/点按/对照三段、字号旁的三模式 segmented、点句译文、生词虚线查词、参考译文、导读问题、开始练习浮层、整篇朗读控制条（刻度条/暂停/继续/停止）。

### 3.5 收藏 / 生词本（glossary）
```
┌──────────────────────────────┐
│ 你收藏的句子会一直保留在这里    │
│ ┌──────────────────────────┐ │
│ │ I had a very good seat.   │ │
│ │ Lesson 12 · A private...  │ │  ← sourceText
│ │ 我坐的座位很好。           │ │  ← note（句子译文）
│ │                     [×]  │ │
│ └──────────────────────────┘ │
│ 点右上角 × 删除收藏           │
└──────────────────────────────┘
```
- 空态：`还没有收藏` / `在课文中点句子旁的「收藏」` / 按钮 `去学课文`（跳 NCE 目录，替换原「去翻译」）。

### 3.6 设置（mine/settings）
```
┌──────────────────────────────┐
│ 外观                         │
│   圆角风格           柔和 ›    │
│ 存储                         │
│   清除缓存          3.2KB ›    │
│ 关于                         │
│   用户协议与隐私政策     ›     │
│   关于与免责            ›     │
│ 账号                         │
│   退出登录            ›       │
└──────────────────────────────┘
```
（已删：「功能」分区及「发现设置 ›」入口）

---

## 4. 技术方案（九子项）

### 4.1 页面（页面级改动清单）

> 标记约定：**[改]** 改造保留 / **[删]** 彻底删除 / **[增]** 新增

#### 4.1.1 删除整目录 / 整文件

| 文件/目录 | 动作 | 说明 |
|---|---|---|
| `pages/chat/index/*`（4 文件） | [删] | AI 流式对话 |
| `pages/chat/history/*`（4 文件） | [删] | 对话历史 |
| `packageTranslate/pages/translate/{index,settings,history}/*`（12 文件） | [删] | 翻译分包 |
| `pages/mine/discover-settings/*`（4 文件） | [删] | 发现设置（开关页） |
| `services/agent-stream.ts` | [删] | SSE agent 管线 |
| `utils/feature-flags.ts` | [删] | 本地功能开关 |
| `utils/translate-keys.ts` | [删] | 翻译存储 key/类型 |
| `utils/translate-parse.ts` | [删] | 翻译输出解析 + `splitSpeakParts`（迁入 tts） |
| `utils/chat-msg.ts` | [删] | 对话纯函数 |
| `utils/history-cards.ts` | [删] | 历史卡片归属 |
| `utils/markdown.ts` | [删] | 对话 markdown 渲染器 |
| `utils/share-image.ts` | [删] | 仅对话/翻译页引用（分享卡） |

#### 4.1.2 改造保留

| 文件 | 动作 | 关键改动 |
|---|---|---|
| `app.json` | [改] | 见 §4.2 |
| `pages/home/index/index.{ts,wxml}` | [改] | 删 `createAgentApi`/`feature-flags` 依赖、新对话卡、最近对话整块（`Recent`/`loadRecent`/`openConv`/`formatTime`/`openEntry`/`goChat`）；新增「常用功能」渲染（读 `utils/features`）；`onShareAppMessage` 标题改「大橙子英语」 |
| `pages/discover/index/index.{ts,wxml}` | [改] | 删 `feature-flags`、`openTranslate`/`openChat`；改为渲染 `FEATURES` 全量 + 每项「添加常用」开关 |
| `pages/mine/index/index.{ts,wxml}` | [改] | 删 `translate-keys`/`feature-flags`、`readTrCount`/`goHistory`/`goTrSettings`、`flags` 相关；生词本行改「收藏」；`login-gate` desc 去「翻译记录」 |
| `pages/mine/settings/settings.{ts,wxml}` | [改] | 删 `translate-keys` 依赖、`goDiscoverSettings`；`PRESERVE_KEYS` 去掉 3 个 `TRANSLATE_*` 与 `nce-mode`，新增 `feature_pinned`；清缓存文案去「翻译记录」 |
| `pages/mine/glossary/index.{ts,wxml,json}` | [改] | 生词本 → 收藏；`metaText` 改为兼容 `nce` meta（`Lesson N · 第 M 句`）+ 旧 `tone/direction` 兜底；空态与「去翻译」按钮改「去学课文」；`index.json` 标题「生词本」→「收藏」 |
| `pages/nce/detail/detail.{ts,wxml,wxss}` | [改] | 重写：只留英文课文 + 逐句朗读 + 逐句收藏（见 §4.7 判据） |
| `pages/nce/index/index.{ts,wxml}` | [改] | 基本不变；卡片副文案若含「点句出译文 / 生词就地查」改为「逐句朗读 · 收藏」；`detail` 页删习题后，目录卡 `exerciseCount` 元信息可保留或去「N 题」（建议去「N 题」，见待拍板 P7） |
| `pages/mine/about/about.{ts,wxml}` | [改] | 文案中性化：品牌名「大橙子个人助理」→「大橙子英语」；「我们做什么」与「免责声明」去「翻译 / 讲解 / AI」措辞（见 §4.8） |
| `pages/mine/agreement/agreement.wxml` | [改] | 「对话与学习数据：翻译记录、课文学习进度、生词本」→「学习数据：课文学习进度、收藏」 |
| `components/login-gate/index.{ts,wxml}` | [改] | 默认 `desc` 去「AI 对话、翻译与合翻」；图标「豆」→「橙」（品牌修正，见待拍板 P6） |
| `services/tts.ts` | [改] | 去 `agent-stream`/`translate-parse` 依赖，自包含 `getApiBase` + `splitSpeakParts`；删整篇朗读管线（`speakLines`/`onLineProgress`/`LineProgress`/`LineSpeakOptions`/`playLines`/`finishLines`/`pauseSpeak`/`resumeSpeak`/`emitLineProgress`/`lineListeners`），保留 `speakText`/`onSpeakState`/`stopSpeak` 与内部播放/缓存/流式管线 |
| `services/glossary.ts` | [改] | `CollectPayload.sourceType: 'chat' | 'translate' | 'nce'`；其余不动 |
| `utils/features.ts` | [增] | 功能注册表 + 常用收藏 storage（见 §4.4） |
| `pages/nce/books.ts` | [改] | 不动（保留书册常量） |

#### 4.1.3 新增

| 文件 | 说明 |
|---|---|
| `utils/features.ts` | 功能注册表 `FEATURES` + 常用收藏读写 + `features:updated` 广播 |
| `tests/features.test.ts` | 注册表/收藏/广播单测 |

### 4.2 配置（app.json）

```json
{
  "pages": [
    "pages/home/index/index",
    "pages/discover/index/index",
    "pages/mine/index/index",
    "pages/mine/profile/profile",
    "pages/mine/bind-email/bind-email",
    "pages/mine/agreement/agreement",
    "pages/mine/settings/settings",
    "pages/mine/about/about",
    "pages/mine/glossary/index",
    "pages/nce/index/index",
    "pages/nce/detail/detail"
  ],
  "window": {
    "backgroundTextStyle": "light",
    "backgroundColor": "#F5F8FF",
    "navigationBarBackgroundColor": "#FFFFFF",
    "navigationBarTitleText": "大橙子英语",
    "navigationBarTextStyle": "black"
  },
  "tabBar": {
    "custom": true,
    "color": "#8A90A0",
    "selectedColor": "#2563EB",
    "backgroundColor": "#FFFFFF",
    "borderStyle": "black",
    "list": [
      { "pagePath": "pages/home/index/index", "text": "首页" },
      { "pagePath": "pages/discover/index/index", "text": "发现" },
      { "pagePath": "pages/mine/index/index", "text": "我的" }
    ]
  },
  "resizable": true,
  "style": "v2",
  "sitemapLocation": "sitemap.json"
}
```

变更点：
1. `pages` 移除 `pages/mine/discover-settings/discover-settings`、`pages/chat/index/index`、`pages/chat/history/history`。
2. `subpackages`（packageTranslate）整体移除。
3. `preloadRule` 整体移除（唯一分包已删）。
4. `permission.scope.record` 整体移除 —— **理由**：语音输入权限仅对话页录音用，对话删除后无任何录音能力；NCE 逐句朗读是「播放」（`InnerAudioContext`）不申请录音。保留该权限会被审核追问「为何申请录音却无对应功能」，故**删除**。

### 4.3 依赖（npm）

无新增依赖。本次为**纯删减 + 内聚重构**：`tts.ts` 内联 `getApiBase`/`splitSpeakParts` 两段小函数，不引入新包。

### 4.4 初始化数据

**功能注册表 `utils/features.ts`**：

```ts
export interface FeatureDef {
  id: string;            // 'nce' | 'glossary'
  title: string;         // 新概念英语 / 收藏
  desc: string;          // 短描述
  icon: string;          // 单字图标
  iconClass: string;     // 配色 class（.ic.n / .ic.g）
  path: string;          // navigateTo url
  needLogin: boolean;    // 是否需登录才可进
  defaultPinned: boolean;// 默认是否常驻首页
}

export const FEATURES: FeatureDef[] = [
  { id: 'nce', title: '新概念英语', desc: 'NCE 逐句精读 · 点句朗读',
    icon: '英', iconClass: 'n', path: '/pages/nce/index/index',
    needLogin: false, defaultPinned: true },
  { id: 'glossary', title: '收藏', desc: '收藏的句子，随时回看',
    icon: '藏', iconClass: 'g', path: '/pages/mine/glossary/index',
    needLogin: true, defaultPinned: false },
];

const PINNED_KEY = 'feature_pinned';
export const FEATURES_UPDATED_EVENT = 'features:updated';
export function getPinned(): string[] { /* storage 读；无值回退 defaultPinned 集合 */ }
export function isPinned(id: string): boolean { /* getPinned().includes(id) */ }
export function togglePinned(id: string): string[] { /* 写 storage + eventBus 广播 */ }
```

**存储 key 语义变化**：
- 新增 `feature_pinned`（JSON 数组，常用功能 id 列表），加入设置页 `PRESERVE_KEYS` 白名单。
- 删除 `feature_chat` / `feature_translate`（旧开关 key，随 feature-flags 删除不再读）。
- 删除 `kd_tr_history` / `kd_tr_params` / `kd_tr_settings`（翻译存储，随翻译删除不再写/读；白名单同步移除）。
- `nce-mode`（三种模式偏好）随三种模式删除不再使用，白名单移除；`nce-font`（字号）保留、白名单保留。

### 4.5 权限

- 删除 `permission.scope.record`（见 §4.2.4）。NCE 朗读仅使用 `InnerAudioContext` 播放，无需录音授权；登录仍是 `wx.login` 静默，无授权弹窗。
- 无新增权限。

### 4.6 接口约束（后端不动）

| 接口 | 用途 | 改动 |
|---|---|---|
| `GET/POST /api/content-admin/nce/*` | NCE 目录/详情 | 不改；详情仍返回 `lines[].cn`（用于收藏 note，前端不渲染） |
| `POST /api/ai/tts/speak`（+ stream） | 逐句朗读 | 不改；`speakText` 单句沿用 |
| `GET/POST/DELETE /api/glossary` | 收藏 | 不改；仅前端 `CollectPayload.sourceType` 增 `'nce'` |

**接口风险（须研发确认）**：`sourceType` 当前为前端自由字符串，若 user-service 的 glossary 表/校验对 `sourceType` 有枚举白名单，则需确认 `'nce'` 已放行；默认按 string 透传处理，**前端不依赖后端改动**。此点列入「待拍板 P8」。

### 4.7 NCE 详情页重写（关键交互判据）

| # | 判据 | 实现 |
|---|---|---|
| N1 | 点句朗读 | `toggleLine`：`i = dataset.i`；`speakText(line.en)`；`_playingIdx = i` |
| N2 | 点同一句停止 | `speakText` 内置「same text → stopSpeak」语义；`_onSpeakState(null)` 复位 `readingLineIdx=-1`/`phase=idle` |
| N3 | 点他句切换 | `speakText` 内部 `stopSpeak()` 顶掉上一句再播新句 |
| N4 | 句级高亮 | `_onSpeakState(s)`：`readingPhase = s.phase`；`readingLineIdx = this._playingIdx` |
| N5 | 逐句收藏 | `collectLine`：先 `isLoggedIn()`，未登录 toast「请先登录」+ `switchTab(mine)`；否则 `collectGlossary({ sourceType:'nce', enMain:line.en, note:line.cn || '', sourceText:\`Lesson ${id} · ${title}\`, meta:{ book, lessonId:id, lineIndex:i } })`；成功 toast「已收藏」，`existed` toast「已在收藏中」 |
| N6 | 收藏与朗读隔离 | 收藏按钮 `catchtap`，不冒泡到 `toggleLine` |
| N7 | 页面卸载停读 | `onUnload`/`onHide` → `stopSpeak()` + 退订 `onSpeakState` |

### 4.8 文案中性化（去 AI 语义）

| 位置 | 现 | 改 |
|---|---|---|
| login-gate 默认 desc | AI 对话、翻译与合翻都需要登录后使用 | 学习进度与收藏都跟着账号走 |
| 首页 login-gate desc | 对话记录都跟着账号走…（chat 态） | 学习进度和收藏都跟着账号走 |
| 我的 login-gate desc | 翻译记录、学习进度与生词本都跟着账号走 | 学习进度与收藏都跟着账号走 |
| 发现 login-gate desc | 发现页的能力与记录都关联你的账号 | 不变（中性） |
| 首页 NCE 卡副文案 | NCE 逐句精读 · 点句出译文 | NCE 逐句精读 · 点句朗读 |
| 首页空态/提示 | 直接对话，进来就能用… | 每天一句，稳步进阶。 |
| about 我们做什么 | 只提供两项能力：语言翻译，以及新概念英语… | 提供新概念英语课文学习辅助：逐句朗读与句子收藏。 |
| about 免责 | 仅用于语言翻译与新概念英语…翻译与讲解内容可能存在偏差 | 仅用于新概念英语课文学习辅助。课文与朗读内容可能存在偏差，重要场景请自行核实。 |
| agreement | 对话与学习数据：翻译记录、课文学习进度、生词本 | 学习数据：课文学习进度、收藏 |
| settings 清缓存确认 | 你的翻译记录、学习进度与偏好设置会保留 | 你的收藏、学习进度与偏好设置会保留 |
| home onShareAppMessage | 大橙子个人助理 | 大橙子英语 |

---

## 5. 文件改动清单（汇总）

### 5.1 删除（28 个页面文件 + 8 个 util/service + 测试）

- **页面**：`pages/chat/index/{index.json,index.ts,index.wxml,index.wxss}`、`pages/chat/history/{...4}`、`packageTranslate/pages/translate/index/{...4}`、`packageTranslate/pages/translate/settings/{...4}`、`packageTranslate/pages/translate/history/{...4}`、`pages/mine/discover-settings/{...4}`
- **服务/工具**：`services/agent-stream.ts`、`utils/feature-flags.ts`、`utils/translate-keys.ts`、`utils/translate-parse.ts`、`utils/chat-msg.ts`、`utils/history-cards.ts`、`utils/markdown.ts`、`utils/share-image.ts`

### 5.2 改造（14 项）

`app.json`、`pages/home/index/index.{ts,wxml}`、`pages/discover/index/index.{ts,wxml}`、`pages/mine/index/index.{ts,wxml}`、`pages/mine/settings/settings.{ts,wxml}`、`pages/mine/glossary/index.{ts,wxml,json}`、`pages/nce/detail/detail.{ts,wxml,wxss}`、`pages/nce/index/index.{wxml}`、`pages/mine/about/about.wxml`、`pages/mine/agreement/agreement.wxml`、`components/login-gate/index.{ts,wxml}`、`services/tts.ts`、`services/glossary.ts`

### 5.3 新增（2 项）

`utils/features.ts`、`tests/features.test.ts`

### 5.4 测试文件处理

| 测试文件 | 动作 |
|---|---|
| `tests/translate-parse.test.ts` | [删] |
| `tests/feature-flags.test.ts` | [删] |
| `tests/chat-msg.test.ts` | [删] |
| `tests/markdown.test.ts` | [删] |
| `tests/history-cards.test.ts` | [删] |
| `tests/home-recent-timeout.test.ts` | [删]（测 loadRecent 超时） |
| `tests/recent-envelope.test.ts` | [删]（测最近对话信封） |
| `tests/home-index.test.ts` | [改] 去掉 `agent-stream` mock 与最近对话断言，改测「常用功能渲染 + 点卡跳转」 |
| `tests/publish.test.ts` | [改] 示例页路径 `pages/chat/index/index` → `pages/nce/detail/detail`（仅参数解析用例，非真实依赖） |
| `tests/e2e/cases/C-translate-prefs.js` | [删]（翻译设置回填） |
| `tests/e2e/cases/D-clear-history.js` | [删]（翻译历史清空） |
| `tests/e2e/cases/G-accent-removed.js` | [删]（翻译发音设置） |
| `tests/e2e/cases/F-clear-cache.js` | [改] 白名单断言去掉 `kd_tr_history/settings`，改用 `feature_pinned`；`nce-mode` 移除 |
| `tests/e2e/cases/A-tabs.js` | [改] 无结构变化，可保留（仍三 tab）；必要时断言文案同步 |
| `tests/e2e/cases/E-radius-persist.js` | 保留 |

---

## 6. 测试六维

| 维度 | 覆盖 |
|---|---|
| 单元测试 | `features.test.ts`（注册表/`getPinned` 默认回退/`togglePinned` 落盘+广播）；`glossary` 的 `sourceType` 类型扩展；`tts.ts` 内联 `splitSpeakParts` 后既有 TTS 行为不回归 |
| 集成测试 | `glossary` 收藏 `sourceType='nce'` 全链路（detail 收藏 → list 可见 → remove） |
| e2e | 三 tab 渲染（A-tabs 保留）；清缓存白名单（F 更新）；删除的翻译 e2e（C/D/G）移除 |
| 回归 | 逐句朗读（点句/切句/停）、字号偏好、圆角偏好、登录墙、tabBar 高亮、账号资料同步不受影响 |
| 真机目视 | 逐句高亮与「请稍候…」内联态、收藏 toast、首页/发现「添加常用」即时刷新（须微信开发者工具真机，不因单测绿视为验收） |
| 包体/性能 | 删 chat/translate 分包后主包体积下降；无新增依赖；`tts.ts` 仍走磁盘缓存（≤30 文件淘汰），逐句朗读不再预取整课 |

---

## 7. 验证判据表 V1…Vn

| # | 判据 | 通过标准 |
|---|---|---|
| V1 | 逐句朗读 | 点某句只播该句；点同一句停止；点他句切换；播放中该句高亮、句首有播放态 |
| V2 | 全文朗读下线 | 详情页无「整体朗读/继续朗读」入口、无刻度条、无暂停/继续/停止控制条 |
| V3 | AI 阅读能力下线 | 无 沉浸/点按/对照 三段、无点句译文、无生词虚线查词卡、无参考译文、无习题浮层、无导读问题 |
| V4 | 逐句收藏 | NCE 详情点「收藏」→ `collectGlossary(sourceType='nce')` 落库；我的→收藏可见该句（英文 + Lesson 出处 + 译文 note） |
| V5 | app.json 干净 | 无 chat/translate/discover-settings 注册、无 subpackages、无 preloadRule、无 `scope.record` |
| V6 | 彻底删除 | `grep -r "pages/chat\|packageTranslate\|discover-settings\|agent-stream\|feature-flags\|translate-keys\|translate-parse\|chat-msg\|history-cards\|markdown\|share-image"` 源码 0 命中（除测试更新后） |
| V7 | 首页=常用功能 | 默认仅显示 NCE 卡；发现「添加收藏」后首页即时出现收藏卡；无新对话/最近对话 |
| V8 | 发现=全部功能+添加常用 | 全量功能卡 + 每项「添加/已添加」切换，即时反映到首页 |
| V9 | 我的去 AI 设置 | 无「我的翻译记录」「翻译设置」行；「生词本」改「收藏」 |
| V10 | 设置去发现设置 | 无「功能」分区；清缓存白名单含 `feature_pinned`、不含 `kd_tr_*`/`nce-mode`；清缓存文案无「翻译记录」 |
| V11 | 文案中性 | 全量 wxml/ts 无「AI / 对话 / 翻译 / 语音输入 / 讲解」AI 语义残留（about/agreement/login-gate/首页提示同步改） |
| V12 | tts 自包含 | `services/tts.ts` 不 import agent-stream/translate-parse；编译通过 |
| V13 | 登录守卫 | 逐句朗读（speakText 内）、收藏（collectLine 内）未登录时 toast + 引导，不发请求 |
| V14 | 单测绿 | 保留/新增测试全绿，删除的测试文件不 import 已删模块 |

---

## 8. 待拍板表（附默认建议）

| # | 待确认点 | 默认建议 |
|---|---|---|
| P1 | 字号选择 A-/A/A+ 是否保留？ | **保留**（纯阅读偏好、非 AI，`nce-font` 已落 storage；三段模式已删，字号作为独立小控件保留） |
| P2 | 「收藏」是否作为发现页第二个功能项（让常用功能机制有意义）？ | **是**（注册表含 nce + glossary 两项；首页默认 pin nce，用户可加 glossary） |
| P3 | 生词本入口命名 | **改「收藏」**（导航标题「生词本」→「收藏」；我的列表行「生词本」→「收藏」） |
| P4 | 逐句收藏是否做「已收藏★高亮」？ | **首版不做**（仅 toast 提示；重复收藏后端幂等返回 `existed`；高亮需额外 listGlossary 对比，后续迭代再加） |
| P5 | `nce-mode` 存储 key 处理 | **从 PRESERVE_KEYS 移除**（三种模式已删，key 不再使用） |
| P6 | login-gate 图标「豆」→「橙」品牌修正 | **改**（科豆遗留，与 mine/about 的「橙」统一） |
| P7 | NCE 目录卡元信息「N 题」是否去掉 | **去掉**（习题已删，`exerciseCount` 元信息失去意义；或保留「N 句 · N 词」即可） |
| P8 | `sourceType` 字段是否需后端放行 | **定案：重设计为 `tag` 自由字符串**。`create-glossary.dto.ts` 的 `sourceType: 'chat'\|'translate'` + `@IsIn(['chat','translate'])` → `@IsString() tag: string`（加 `@MaxLength(64)`）；`glossary-entry.entity.ts` 列 `sourceType varchar(16)` → `tag varchar(64)`（comment「来源标记，自由字符串」）；`glossary.service.ts` 的 `CollectResult`/`GlossaryListItem`/`collect()`/`list()` 同步 `sourceType`→`tag`；controller 透传不改。前端 `CollectPayload`/`GlossaryItem` 同步改 `tag`。prod 需执行 `ALTER TABLE glossary_entries` 重命名列（RENAME COLUMN sourceType TO tag，或 CHANGE sourceType tag varchar(64)），历史旧值不迁移 |

---

## 9. 工程门禁状态

- ✅ 本规格为 **Proto commit**（只含 `specs/dachengzi-minigram/`）；后续 UI 落码须另 commit 并带 `Proto: <本 commit sha>` + `Design: pass`（设计评审真源即本文件）。
- ⚠️ 微信开发者工具真机目视仍待人工（逐句朗读高亮/停止、收藏 toast、首页↔发现「添加常用」联动、清缓存白名单、文案中性化），不因单测全绿视为已验收。
