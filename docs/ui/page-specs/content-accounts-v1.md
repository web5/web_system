# 页面规格书 · 自媒体账号管理（ContentAccounts）

- 页面类型：列表页 + 表单页（一对：列表 / 新增编辑）
- 参照页：`apps/admin/src/views/Content/ContentSources.vue` + `ContentSourceEdit.vue`
  （同模块既有「采集源管理」，同为 code/name/config/enabled 结构 + CRUD 双页；本次完全对齐它，不新造交互范式）
- 需求一句话：把散在服务器环境变量里的自媒体平台凭据收进后台可管理的加密注册表，
  让「加一个号」不用上机改 `.env`、不用重启进程，并在发布前就知道这个号有没有发布权限。

> 状态：**已确认（2026-10-23 用户过完原型 p11–p19，无异议）** —— 可写 UI 源码（R9b / L1 hook）。
> 落地进度：路由 `/content/accounts` + BasicLayout 菜单 + `ContentAccounts.vue` / `ContentAccountEdit.vue`
> 骨架页已落（数据走占位，等 `content_accounts` 表与 CRUD / 连通性检测接口）。
> 配套原型：`docs/ui/prototypes/admin-media-ops.html`（自媒体运营**模块稿**的第 6 个菜单页，
> 2 个 section：列表 / 新增编辑；评审台场景包 **p11–p19** 共 9 个 = 下面 9 条评审分支）。
>
> ⚠️ 归位说明（2026-10-23）：首版曾开独立稿 `admin-content-accounts.html`，违反
> `docs/ui/prototypes/README.md` §0.5/§0.6（唯一整合容器是 `admin-agents-hub.html` 生成物，
> 新模块一律「模块稿 + 注册表一行 + 重跑 build」，同一模块只留一份稿），体检 FAIL 4 / WARN 5。
> 已并入模块稿并删除独立稿。落地对照看 `admin-agents-hub.html` 里的自媒体运营分组。

---

## 页头

| 屏 | 标题 | 副标题 | 主操作 |
|---|---|---|---|
| 账号列表 | 账号管理 | 登记各平台账号凭据；发布管线与手动发布按账号取用，不再依赖服务器环境变量 | 新增账号（primary，`content:manage`） |
| 新增/编辑 | 新增账号 / 编辑账号 · {名称} | 凭据一经保存不再展示明文，仅显示掩码；需变更时点「重新录入」 | 无（主操作在底部保存） |

## 模块清单（自上而下）

### 屏 1 · 账号列表

| 序 | 模块 | 数据来源/API | 承载组件 | 空态策略 | 备注 |
|---|------|-------------|---------|---------|------|
| 1 | 凭据加密说明条 | — | `a-alert` info 型（沿用 `--ws-info-bg` / `--ws-info`） | 常驻展示，不随数据态消失 | 文案点明 `ACCOUNT_CRED_KEY_FILE` 与「不进进程环境变量」；是 A3 决议的用户可见面 |
| 2 | 筛选条 | — | 平台下拉 / 状态下拉 / 关键词输入 / 刷新按钮 | — | 平台下拉只列**已接入**平台，已下线的腾讯文档不出现 |
| 3 | 账号表格 | `GET /api/content-admin/content/accounts` | `a-table` | 空态：图标 + 「还没有登记任何账号」+ 主出路按钮「新增账号」 | 行内 `启用` 开关直连 `PATCH .../accounts/:id/enabled` |

### 屏 2 · 新增 / 编辑

| 序 | 模块 | 数据来源/API | 承载组件 | 空态策略 | 备注 |
|---|------|-------------|---------|---------|------|
| 1 | 基础信息卡 | — | 名称 / 编码 / 平台 / 启用 四项 | — | 编码新建可填、编辑态 disabled + tooltip「创建后不可改」 |
| 2 | 凭据卡 | — | **平台决定字段**（公众号：AppID / AppSecret / GH_ID） | — | 已保存时显示掩码 + 「重新录入」；未保存时显示输入框 |
| 3 | 连通性卡 | `POST .../accounts/:id/test`（新建时 `POST .../accounts/test-preview`） | 按钮 + 结果面板 | 未检测时显示灰字提示「保存前建议先测一次」 | 结果含主体名、能力清单、错误码与处置建议 |
| 4 | 底部操作栏 | `POST/PATCH .../accounts` | 删除（danger，仅编辑态）/ 取消 / 保存 | — | sticky 底栏，与 ContentSourceEdit 一致 |

## 表格/列表列清单

| 列 | 来源字段 | 展示规则 | 操作 |
|----|---------|---------|------|
| 账号 | `name` + `code` | 主行 `name`；副行 `code` 用 mono + `--ws-t4` | — |
| 平台 | `platform` | tag（`wechat_mp` → info 色「公众号」） | — |
| 主体标识 | `identity` | mono 掩码（`wxc94524****717a06`）；副行「服务号 · 已认证」 | — |
| 凭据 | `credentials_mask` | mono 掩码 + `已加密` tag（ok 色）。**接口永不返回明文 secret** | — |
| 连通性 | `last_checked_at` / `last_check_status` | ok「正常」/ warn「权限不足」/ err「失败」/ 灰「未检测」；副行 `MM-DD HH:mm` + 能力摘要 | — |
| 启用 | `enabled` | `a-switch`，`content:manage` 可点 | 切换即生效 |
| 操作 | — | 检测 / 编辑 / 删除（删除 danger 色） | 仅 `content:manage` 可见 |

## 交互清单

| 操作 | 触发 | 反馈（成功/失败） | 是否破坏性→确认文案 | 完成后动作 |
|---|---|---|---|---|
| 新增账号 | 页头主按钮 | 跳编辑屏 | 否 | — |
| 保存 | 底栏「保存」 | success「已保存」/ error 展示后端错误 | 否；保存中 disabled 防重复提交 | 返回列表并刷新 |
| 测试连通性 | 凭据卡/列表行内 | 结果面板：成功显示主体 + 能力清单；失败显示错误码 + 处置建议 | 否 | 写回 `last_checked_at` / `last_check_status` |
| 重新录入凭据 | 凭据卡按钮 | 掩码切换为输入框，留空表示不修改 | 否 | — |
| 启用/停用 | 行内 switch | success toast / error 回滚开关状态 | 否（可逆） | 就地刷新该行 |
| 删除账号 | 行内 / 底栏 danger | success「已删除」/ error | **是** → Modal「删除账号「{name}」？该账号的加密凭据会一并删除，且不可恢复。若仍有管线引用此账号，那些管线会发布失败。」 | 返回列表并刷新 |

## 状态覆盖自查

- [x] 加载中（表格骨架屏）
- [x] 空态（原因「还没有登记任何账号」+ 出路「新增账号」）
- [x] 失败可重试（错误态给「重试」按钮）
- [x] 破坏性二次确认（删除 Modal，文案含管线影响警告）
- [x] 禁用有 tooltip 原因（编码编辑态 disabled + tooltip）
- [x] 保存中防重复提交
- [x] 无弹窗套弹窗（删除确认是唯一弹层）

## 原型继承

> 分支清单以原型演示控件的场景包为单一来源：**9 个场景包 → 下面 9 行**，一行不多一行不少。
> 控件本身（`data-demo-*`、场景包）不进实现。

| # | 场景包 | 路由 | 权限码 | 数据态 | 期望结果 |
|---|---|---|---|---|---|
| 1 | 列表 · 有数据 | `/content/accounts` | `content:view` | normal | 2 行；凭据列只显掩码；「科豆AI」行连通性为 warn「权限不足 48001」 |
| 2 | 列表 · 空态（首次） | 同上 | `content:manage` | empty | 图标 + 「还没有登记任何账号」+ 主出路按钮「新增账号」 |
| 3 | 列表 · 加载中 | 同上 | `content:view` | loading | 4 条骨架行，无闪烁 |
| 4 | 列表 · 请求失败 | 同上 | `content:view` | error | 「请求失败 · 超时（3s）」+ 重试按钮 |
| 5 | 列表 · 只读角色 | 同上 | `content:view`（viewer） | normal | 无「新增账号」、无行内检测/编辑/删除、switch 只读 |
| 6 | 列表 · 无权限 | 同上 | 无 `content:view` | forbidden | 「无访问权限 · 需要 content:view」+ 申请权限出口 |
| 7 | 新增 · 公众号字段 | `/content/accounts/new` | `content:manage` | normal | 平台=公众号时显示 AppID/AppSecret/GH_ID；腾讯文档标「已下线」不可选、小红书标「未接入」不可选 |
| 8 | 新增 · 检测成功 | 同上 | `content:manage` | normal | 面板 ok：主体名 + AppID + 能力「建草稿/正式发布/封面上传 可用」 |
| 9 | 新增 · 检测失败 48001 | `/content/accounts/:id` | `content:manage` | normal | 面板 err：错误码 48001 + 能力「建草稿可用 / 正式发布不可用」+ 处置建议「改发布模式为只建草稿，或先完成微信认证」 |

**角色可见性**：`content:view` 看列表；`content:manage` 才出现新增/编辑/删除/检测/启停。菜单项「账号管理」归入既有「自媒体运营」分组。

**平台能力占位**：原型里「小红书（未接入）」是占位，**落地时下拉只渲染已接入平台**，不渲染禁用项以外的占位（禁用项仅腾讯文档一条，标注「已下线」直到 A5 清理完成）。

## 契约要点（C3 触发面）

| 项 | 决议 |
|---|---|
| 新表 | `content_accounts`：`id / platform / code / name / credentials(json 密文) / identity / enabled / last_checked_at / last_check_status / last_error / created_at / updated_at / deleted_at` |
| 唯一约束 | `(platform, code)` 唯一；`deleted_at` 软删 |
| 加密 | AES-256-GCM，密文格式 `<keyId>:iv:tag:data`，与既有 `config-crypto.ts` 对齐 |
| 解密钥 | `ACCOUNT_CRED_KEY_FILE`（0600 文件路径）优先，回退 `ACCOUNT_CRED_KEY`（仅本地开发）；**生产禁用值形态**。归 content-hub 域自管，**与配置中心 `CONFIG_MASTER_KEY` 体系解耦** |
| 配置中心 | **不进 `config_items`**：自媒体三方平台 key 是业务资产、运行期可增删改，不属部署配置范畴。放进配置中心会导致改一个号要走下发 + 重启（退回原痛点），并把故障域绑到部署链路 |
| 接口 | 列表 / 详情 / 新增 / 编辑 / 删除 / 启停 / 测试连通性；列表与详情**不返回明文**，只返回 `credentials_mask` |
| 迁移 | `migrations/0016_content_accounts.sql`，幂等；**dev 与 prod 都跑**（两边 `NODE_ENV=production`，synchronize 关闭） |
| 兜底 | publisher 取凭据：表里有 → 用表；没有 → 回退 env（保证未登记时现有链路不断） |

## 风险/待澄清

1. ~~**密钥域**：dev / prod 各一把钥，还是共用一把？~~ → **已决议（2026-10-23 用户拍板）**：
   三方平台 key **从配置中心剥离**，跟 content-hub 模块走（入 `content_accounts` 表）；
   解密钥按部署库实例分域 —— dev / prod **各一把**，dev 库泄露不牵连 prod 凭据。
2. **已下线目标的清理范围**：A5 要下线的腾讯文档，是只从「平台下拉」移除，还是同时删 `TencentDocsPublisher` 代码 + 清洗 `content_pipelines.publish_targets` 里的 `tencent_docs` 值？——建议保留代码（未来可能复用）、前端下拉移除并标注、管线数据一次性清洗，需确认。
3. **凭据迁移入口**：现有 dev 2 个号 / prod 1 个号的 env 凭据，是人工在后台录一次，还是写一个一次性导入脚本读 env 入库？——建议人工录（顺手做一次连通性检测，正好验证密钥链路），需确认。
4. **测试连通性的频率**：是否纳入每日巡检（提前发现 token 失效）？本轮不做，P1 再议。
