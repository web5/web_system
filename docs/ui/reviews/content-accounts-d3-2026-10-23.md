# 自媒体账号管理（content-accounts）D3 实现一致性评审

阻塞: 0

## 范围与证据

本次在「自媒体运营」功能组内新增第 6 个菜单页「账号管理」，落路由 + 菜单 + 两个骨架页。
依据规格 `docs/ui/page-specs/content-accounts-v1.md`（状态已确认）与原型
`docs/ui/prototypes/admin-media-ops.html` 场景包 p11–p19（账号管理已并入该模块稿，
非独立带壳稿 —— 符合 prototypes/README §0.5/§0.6 的整合约定）。

核对对象：`apps/admin/src/router/index.ts`、`apps/admin/src/layouts/BasicLayout.vue`、
`apps/admin/src/views/Content/ContentAccounts.vue`、`ContentAccountEdit.vue`。

本报告记录执行者的实现一致性自查。原型为静态 HTML（无浏览器自动化证据链），
页面数据当前走占位（后端 `content_accounts` 表与 CRUD / 连通性检测接口未落地），
故本轮只核对**结构与交互契约**，不声称数据链路已通；仍须在 dev 环境逐屏人工复验。

## 检查结果

| 判据 | 结果与反例 |
|---|---|
| 菜单结构与原型一致 | 「自媒体运营」sub-menu 下新增 `content-accounts`，位于「采集监控」之后，图标 `IdcardOutlined`；非新增顶层入口，与该 sub-menu 既有五子页同构 |
| 路由层级与菜单同源 | `/content/accounts`（列表）、`accounts/new`、`accounts/:id` 与菜单 key 一一映射；`handleMenuClick` 映射表已补 `content-accounts`，无「菜单亮着但路由 404」 |
| 选中态不被兜底分支吃掉 | `watch(route.path)` 的 `/content/accounts` 分支插在 `/content` 兜底**之前**；否则会永远高亮到「采集源管理」（与既有五子页同款坑，已按同款修法处理） |
| 权限分级 | 列表 `content:view`；新增/编辑路由 `content:manage`，页内写操作（新增 / 保存 / 删除 / 检测 / 启停）再以 `canManage` 收窄一次，避免只靠路由守卫 |
| 凭据只以掩码出现 | 列表列与编辑页已保存态均走 `credentials_mask` / `secretMask`，接口层约定永不返回明文 secret；AppSecret 输入框 `type="password"`，留空表示不修改 |
| 加密说明条（A3 决议的用户可见面） | 列表页顶部 alert 明写 AES-256-GCM 加密入库、解密钥由 `ACCOUNT_CRED_KEY_FILE` 指向的 0600 文件提供且**不进进程环境变量**；与「pm2 env 打出明文」的事故教训一致 |
| 破坏性操作有确认 | 列表删除与编辑页删除均走 `a-popconfirm`；编辑页确认文案补了「若仍有管线引用此账号，那些管线会发布失败」，避免用户以为只删了一条记录 |
| 平台枚举只列已接入项 | 平台选项仅 `wechat_mp`；腾讯文档按 A5 已下线、小红书未接入 → 不出现在选项里，避免做出「能配但发出去必失败」的假能力 |
| 空态与失败态 | 列表 `a-empty` 带「新增账号」主按钮（p12）；失败 `a-result` 带重试按钮（p14），无「转圈到底无出口」 |
| 骨架期诚实标注 | 两个页面顶部常驻「骨架页 · 后端接口建设中」warning alert，写明接口落地后该条移除；未用假数据冒充真实列表 |
| 无裸色值 / 无 emoji | 沿用 antd token 与既有 `var(--*)` 变量，未引入 hex/rgba 硬编码；文案无 emoji |
| 无红线词 | 源码与本文档全文不出现 R3 红线词（含注释），替换点以「后端接口落地后替换」表述 |

## 未覆盖（须人工复验）

- 真实列表数据、分页与筛选的服务端行为：依赖 `content_accounts` 表与 CRUD 接口，当前为空数组
- 连通性检测的真实三态（正常 / 权限不足 / 失败）与错误码文案：依赖后端调用微信接口
- 启停开关在管线已引用该账号时的联动提示：需后端返回引用关系
- 403 无权限态：原型未演示，实现沿用既有 `/403` 路由
- dev 环境页面可达性与 antd 主题一致性（骨架页未包 `a-config-provider`，沿用 shell token）

## 原型 → 实现的已知偏差

- 原型为静态演示；实现中保存 / 检测 / 删除为占位提示，接口落地后就近替换（替换点已在代码中就近标注）
- 原型场景包覆盖到 p19；实现当前只落 p11–p19 的结构，数据行为留空，属预期缺口而非漂移
- 列表未做服务端分页（骨架期无数据）；后端落地时与采集源 / 成文两页同款改为服务端分页

## 结论

结构、路由、权限、凭据掩码与破坏性确认均与已确认原型一致，无阻塞项（`阻塞: 0`）。
数据链路缺口已在页面与本文档显式标注，不构成实现一致性偏差。
