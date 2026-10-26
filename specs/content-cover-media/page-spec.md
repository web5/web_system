# 页面规格书 · 自媒体运营·封面素材库与中文标题展示（ContentMedia / ContentItems）

> 设计真相源：`docs/development/reports/2026-10-26-内容中文化与封面素材.md`（九子项方案，用户已确认）
> 原型：本次未做 HTML 原型（后台管理类页面，视觉沿用 Content 系既有 token）；本规格即 UI 实现依据
> 参照页：`ContentItems.vue`（列表形态/列宽/操作列）；抽屉与上传交互参照 `ContentAccounts.vue`

- 页面类型：列表页（新增）+ 既有列表页的列扩展
- 需求一句话：公众号封面要能挑、能传、能复用、能按标题生成；英文资讯标题自动中文化展示（原文 `title` 永不覆盖）

## 一、新增页 · 素材库（`views/Content/ContentMedia.vue`）

### 页头
- 标题：封面素材
- 副标题：公众号封面可上传、可复用、可按标题生成；发布时按需选择
- 主操作：上传素材（primary）

### 模块清单

| 序 | 模块 | 数据来源 | 承载组件 | 空态策略 |
|---|---|---|---|---|
| 1 | 筛选条（用途/来源/标签/关键词） | `GET /content-admin/content/media` | a-form 内联 | — |
| 2 | 素材表格 | 同上 | a-table | 原因+出路「暂无素材，先上传或用 AI 生成」 |
| 3 | 上传抽屉（含比例提示，不强拦） | `POST /content-admin/content/media/upload` | a-upload + Drawer | 宽高非 9:3.8/2.35:1 时给黄条提示 |
| 4 | AI 生成抽屉（标题→提示词→生图） | `POST /content-admin/content/media/ai` | Drawer + 表单 | 失败把 `last_error` 透出到行内 |
| 5 | 微信同步（行内动作） | `POST /content-admin/content/media/:id/sync-wechat` | a-button | 同步失败退回兜底封面，行内显示失败原因 |

### 表格列
素材预览 / 名称 / 来源(upload|ai) / 尺寸 / 用途 / 微信状态(已同步 media_id · 未同步) / 使用次数 / 更新时间 / 操作(编辑·同步·停用·删除)

### 交互红线
- 删除为**软删**（`deleted_at`），历史成文快照不得断链
- `media_id` 按公众号隔离，行内必须显示所属 `account`
- 不在本服务写盘；二进制一律走 upload-service 的 `covers` 分类

## 二、既有页改动

### `ContentItems.vue` / `ContentItemDetail.vue` · 中文标题
- 标题列/详情显示 `title_zh || title`，副行保留原文 `title`（便于对照）
- 语言标记 `source_lang`：仅 zh/en/other 小标签，不参与筛选

### `ContentPipelineEdit.vue` · 默认封面
- 新增「默认封面」选择器（下拉+缩略图预览），取 `GET /content-admin/content/media?kind=cover&enabled=1`
- 说明文案：定时发布无人值守，用管线绑定的封面；单次发布可在发布请求里覆盖

### 导航
- `BasicLayout.vue` 菜单「自媒体运营」下新增「封面素材」，`router/index.ts` 注册 `Content/ContentMedia`
- 图标 `PictureOutlined`，与同组其它菜单一致

## 三、验收判据
1. 上传一张图 → 表格出现新行，尺寸/字节正确，比例不符有提示但可保存
2. AI 生成 → `source=ai` 且 `prompt` 落库，失败时 `last_error` 可见
3. 同步微信 → `media_id` 回填；再发布一次，草稿封面即该图
4. 删除素材 → 行消失，但历史成文里「当时用的哪张」仍能查到
5. 英文条目标题列显示中文译名，原文仍在副行；中文条目不发起翻译调用
