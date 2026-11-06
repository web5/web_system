# 研发方案 · admin 预览页 NCE 交互式阅读器补齐

> 版本：v1.0（2026-11-06）
> 类型：前端组件对齐型补齐（微调，复用 portal 已验证写法）
> 关联需求：用户 2026-11-06「给 admin 预览页也补上交互式阅读器（与 portal 发现页对齐）」
> 契约真源：`docs/development/nce-integration-spec.md`、`nce-admin-preview-spec.md`、`nce-portal-spec.md`
> 状态：需求已提出；用户 2026-11-06 授权「研发立刻开工」（本方案即需求载体，方案确认随授权一并完成）

## 0. 元信息

| 项 | 值 |
|---|---|
| 负责人 | 文追 |
| 模块 | apps/admin |
| 唯一改动文件 | `apps/admin/src/views/Content/NceLessons.vue` |
| 复用接口 | GET /content-admin/nce/lessons/:id（封装于 apps/admin/src/api/nce.ts，不变） |
| 分支 | feature/nce-lessons |
| 凭证 trailer | `Plan:` 本文件 · `Spec: docs/ui/page-specs/nce-admin-reader.md` · `Test: docs/development/reports/测试用例-nce-admin-reader.md` |

## 1. 背景与目标

- **问题**：NCE 阅读器的「点生词就地查词」交互已在 **portal 发现页**（`Nce.vue`）与**小程序**（`detail.ts`）实现，但 **admin 后台预览页**（`NceLessons.vue`）仅平铺展示（纯文本 + 生词列表），无交互式查词。运营/质量人员在后台核查生词配对时，无法直接点词看释义，三端体验不一致。
- **目标**：admin 预览页「逐句对照 / Bilingual」英文部分支持点词查词，与 portal 同源体验，便于后台核查生词。
- **Non-goals（明确不做）**：
  - 不改 admin 列表 / 分页 / 只读属性；
  - 不改「课文全文 Text」纯文本段（保留整块核查用途）；
  - 不引入 portal 三档阅读模式 / 字号档 / 习题门（admin 用途为核查，逐句对照已中英并排）；
  - 不改任何后端 / 接口 / 表结构 / 权限 / 配置。

## 2. 方案设计

### 2.1 架构与数据流
- 纯前端组件内交互，数据来自 `preview.value.words`（已随 `getNceLesson` 取回，无新增请求）。
- **复用 portal `tokensOf()` 写法**：生词 `map` 绑定**对象**（`Map<string, NceWord>`），token 携带真实 `NceWord` 对象；点词 `wordPopup = w` 弹卡。
- 🔴 **关键约束（对齐已修 bug）**：必须**对象绑定**，禁止「排序后 list 下标 → 原始数组取下标」写法。2026-11-06 网页原型 `index.html` 因后者导致悬停 `beggar` 弹 `pocket`（错位 bug，已修复）；portal / 小程序同源绑定无此问题。本次 admin 实现直接采用 portal 的安全写法，从根规避。

### 2.2 页面清单
- 不变：路由 `/content/nce-lessons`（`name: NceLessons`）、菜单 `key: content-nce-lessons`、权限 `content:view`。

### 2.3 接口清单
- 无新增 / 改动，复用 `GET /content-admin/nce/lessons/:id`。

### 2.4 数据结构
- 无 DDL。

### 2.5 配置清单
- 无。

### 2.6 依赖系统或接口
- 内部强依赖 content-hub 现有 nce 接口（已存在，无新增依赖）。

### 2.7 初始化数据
- 无。

### 2.8 权限模型
- 不变（`content:view`）。

### 2.9 接口设计约束
- 不涉及新接口。

## 3. 影响面与风险

| 改动范围 | 风险 | 兼容性 |
|---|---|---|
| 仅 `NceLessons.vue` 单文件（script + template + style） | 低：不影响列表/只读/接口；新增交互不删除现有「生词平铺列表」section | 向前兼容，纯增量交互 |

## 4. 测试方案

### 4.1 单元测试
- 不适用：纯模板渲染 + 复用 portal 已验证的 `tokensOf` 纯逻辑（对象绑定，无副作用）。

### 4.2 接口 / 集成测试
- 无新增接口。

### 4.3 功能测试用例矩阵
- 见 `docs/development/reports/测试用例-nce-admin-reader.md`（独立文档，TC-01~TC-06）。

### 4.4 回归范围
- 现有 admin 预览功能：列表 / 分页 / 逐句对照中文 / 生词平铺列表 / 习题答案，均不受影响。

## 5. ⭐ 发布任务清单

- **仅前端 admin 模块发布（阶段 3）**。无后端 / 表结构 / 初始化数据 / 权限 / 配置变更。
- 阶段 0 pre-flight：无 DDL 差异、无权限常量新增、无网关路由差异 → 直接进阶段 3。
- 阶段 3：admin 前端构建 → 上传 → 切指针；校验产物 HTTP 可达。

## 6. 回滚预案

| 层 | 回滚方式 |
|---|---|
| 前端 | 指针切回旧 commit |

## 7. 验收标准

- 见 §4.3 用例文档 TC-01~TC-06 全部通过：点生词就地弹正确释义、点 beggar 不弹 pocket（错位 bug 回归验证）、查词卡可关、无生词课文不崩、现有功能不回退。

## 8. 追溯矩阵

| 需求 | 设计项 | 改动项 | 测试用例 | 发布项 | 验收 |
|---|---|---|---|---|---|
| admin 补交互式查词 | §2.1 tokensOf 对象绑定 | NceLessons.vue script/template/style | TC-01~TC-06 | 阶段3 admin | 点词正确弹释义，无错位回归 |

## 9. 实现记录（微调豁免）

> 微调豁免（Micro-exempt）：本次为纯对齐型微调用，1:1 复用 portal `Nce.vue` 已评审的
> `tokensOf()`（生词 map 绑对象）+ `.word-card` 交互写法，无新增视觉语言 / 设计决策，
> 沿用同一 NCE 浅色 token（#0EA5A4 / #F97316）。需求凭证见 `e3e519b3`（三件套已落分支）。
> 实现：`apps/admin/src/views/Content/NceLessons.vue`（2026-11-06，研发部），点词查词卡
> 在 `openPreview` 切换课文时重置（对齐 portal `openLesson`，防残留旧词卡）。
