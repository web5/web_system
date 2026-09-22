# 页面规格 · 我的页「AI 记忆」+ 生词本（mine-ai-memory）

> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on

## 1 背景

个人中心要承载三类「用户级、跟用户走」的数据（均落 user-service，见 `specs/user-memory/design.md`、`specs/glossary-collect/design.md`）：

1. **音乐口味**（`user_taste_profiles`，已并入记忆体系）—— 已有定案原型 `apps/kedou-ai-minigram/prototype/music-taste.html`（方案 B 扁平列表）。
2. **用户记忆**（`user_memories`，新）—— AI 每轮对话后异步提炼，用户可看可删。
3. **生词本 / 收藏**（`glossary_entries`，新）—— 用户主动收藏的译文快照。

原型整合进整体原型稿 `apps/kedou-ai-minigram/prototype/index.html` 的「我的」页（`p-mine`）与三个二级页（`p-taste` / `p-memory` / `p-glossary`）。

## 2 入口与信息架构

「我的」页（`p-mine`）在会员卡之后、`应用设置` 之前新增「AI 记忆」分组；「我的数据」分组首行新增「生词本」：

| 分组 | 行 | 摘要 | 目标二级页 |
|---|---|---|---|
| AI 记忆 | 音乐口味 | 已记录 N 个口味（未设置显示「未设置」） | `p-taste` |
| AI 记忆 | 用户记忆 | N 条 | `p-memory` |
| 我的数据 | 生词本 | N 条 | `p-glossary` |

## 3 二级页规格

### 3.1 音乐口味页（`p-taste`，复用 music-taste 方案 B）

- 顶部说明 `AI 自动归类 · 红色为不想听`。
- 扁平标签列表：likes 标签品牌橙底、dislikes 标签红底（前缀「不想听」），每条带 × 删除。
- 「手动补充」输入 + 添加按钮（≤12 字，空值/超长 toast 拦截）。
- 「清空口味记忆」危险按钮（红色文字）。
- 空态：无标签时显示「还没记住你的口味」+ 引导「去对话里说说」。
- 对应接口：`GET/PUT/DELETE /api/user-taste/:namespace`（已迁 user-service）。

### 3.2 用户记忆页（`p-memory`）

- 顶部说明条：`AI 每次对话后，从你们的聊天里提炼关于你的稳定信息…可单条删除`。
- 按 `category` 分组：事实 / 偏好 / 习惯，组标题带条数（`<em>N 条</em>`）。
- 每条记忆 = 内容文本 + 右侧 × 删除。
- 空态：整页无记忆时显示空态引导。
- 对应接口：`GET/DELETE /api/user-memory`（user-service，只读 + 删除；一期不支持手动新增/编辑）。

### 3.3 生词本页（`p-glossary`）

- 顶部说明条：`你收藏的译文会一直保留在这里，即使原对话删除`。
- 每条收藏卡片：英文主文（600）+ 中文原文 + 注解（虚线分隔）+ meta（语气 · 方向）+ 右上角 × 删除。
- 空态：无收藏时显示空态。
- 对应接口：`GET/DELETE /api/glossary`（user-service）。

## 4 状态矩阵

| 页 | 空态 | 有数据 | 删除交互 | 补充交互 |
|---|---|---|---|---|
| 音乐口味 | 空态 + 引导去对话 | 扁平标签 | 点 × 移除（toast） | 输入 + 添加 |
| 用户记忆 | 空态引导 | 分组列表 | 点 × 删除（toast） | 一期无（AI 自动积累） |
| 生词本 | 空态引导 | 卡片列表 | 点 × 删除（toast） | 无（收藏来自翻译卡片/结果页） |

## 5 交互约束

- 删除均为**单条即时**，删除后同步刷新「我的」页摘要（`N 条`）。
- 口味/记忆/生词本三者数据隔离，互不影响。
- 平台原生能力（微信转发、支付等）不涉及本板块，无占位需求。

## 6 与后端契约对齐

- 三组数据都走 user-service，鉴权 `AuthGuard`（`req.user.id`），越权按「不存在」处理。
- 摘要数字由前端按返回列表长度计算（一期不单设 count 接口）。
- 音乐口味数据源已从 `/api/ai-agent/user-taste` 切到 `/api/user-taste`（`services/user-taste.ts` 已改）。
