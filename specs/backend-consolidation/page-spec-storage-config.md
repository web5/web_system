## 页面规格书 · 存储配置（deploy-console · 系统设置）

- 页面类型：**表单页**（设置类；单屏两卡）
- 参照页：`apps/deploy-console/src/views/SystemSettings.vue`（现有「通知与审批」字段同屏）
- 目标端：**桌面 Web**（deploy-console 深色控制台壳）
- 需求一句话：让运维在控制台**看得见、选得准、改得动**「上传文件落在哪」——展示当前生效与待生效双值、用目录树或手填选定路径、保存前校验、并明确「重启 upload-service 才生效」。
- 原型：`docs/ui/prototypes/deploy-console-domain-split.html` → `dc-settings` 屏；质检记录见 `docs/ui/prototypes/deploy-console-settings-storage-质检记录.md`
- 后端契约（已上线）：`specs/backend-consolidation/design.md` §1.2 / §1.4 / §1.5

### 页头

- 标题：`系统设置`
- 副标题：`控制台基础参数与平台存储配置；上传根目录改动后需重启 upload-service 生效`
- 主操作：`保存`（**存储配置卡内**，primary ≤ 1；「通知与审批」卡的保存为次要按钮）

### 模块清单（自上而下，每个模块一行）

| 序 | 模块 | 数据来源/API | 承载组件 | 空态策略 | 备注 |
|---|------|-------------|---------|---------|------|
| 1 | 通知与审批（**现有**，本次不动） | 现有 | a-form：通用 Webhook / 企业微信 Webhook / 需审批环境 | — | 与「存储配置」同屏，保存按钮降为 secondary |
| 2 | 存储配置 · 状态徽标 | 由 3、4 派生 | a-tag：`已生效` / `待重启生效` | — | 两值不一致时 `warning` 色（非 error：这是预期状态，不是故障） |
| 3 | 存储配置 · 双值区 | `GET /api/admin/settings/storage`（权威值）<br>`GET /internal/storage/path`（upload-service 内存值） | a-descriptions（2 行 + 来源行） | 接口失败 → 卡内 error + 重试 | 路径用 mono；来源徽标 `system_service` / `env` / `default` |
| 4 | 存储配置 · 待重启提示条 | 同上 | a-alert（warning） | — | 文案：`已保存但尚未生效：upload-service 只在启动时读取该配置，需重启后才切换目录（不做运行时热切换）` |
| 5 | 存储配置 · 目录选择器 | `GET /api/admin/settings/storage/browse?path=` | a-radio-group（目录树 / 手动输入）+ a-tree（懒加载）+ a-input + `校验` 按钮 | 空目录 → 文案 + 仍可「使用此目录」 | 树需 `storage:browse`（super_admin）；不可用时禁用 + 说明 |
| 6 | 存储配置 · 校验结果块 | `POST /api/admin/settings/storage/validate` | a-descriptions + a-alert | — | 展示 `resolvedPath / exists / writable / freeSpace / code / message` |
| 7 | 存储配置 · 保存 | `PUT /api/admin/settings/storage` | button（primary，默认 disabled） | — | 校验通过才可用；成功 → toast + 切「待重启」态 |

### 交互清单（每条操作一行）

| 操作 | 触发 | 反馈（成功/失败） | 是否破坏性→确认文案 | 完成后动作 |
|------|------|------------------|--------------------|-----------|
| 读取配置 | 进入页面 | 骨架 → 双值区 / 失败 → error + 重试 | 否 | — |
| 浏览目录 | 点树节点 | 骨架（懒加载该层）→ 子目录列表 | 否 | 面包屑与「使用此目录」联动 |
| 使用此目录 | 树右上按钮 | 待保存值 = 当前目录 | 否 | 待保存值显示（双值区第二行） |
| 使用默认目录 | 卡片内 link | 待保存值 = `~/web_system/uploads` | 否 | 同上 |
| 校验 | `校验` 按钮 | loading → 结果块（`ok` / 越界 `UPLOAD_DIR_OUT_OF_SCOPE` / 不可写 / 不存在可创建） | 否 | 通过 → 保存可用；不通过 → 保持禁用 + 字段级文案 |
| 保存 | `保存` 按钮 | loading → success toast `已保存，将在 upload-service 重启后生效` | **否**（可回退：再改回或删下发文件） | 徽标 →「待重启生效」+ warn 条 |
| 切「手动输入」 | radio | 输入框显示当前待保存值 | 否 | — |
| 降级（非超管 / 浏览关闭） | 接口/权限返回 | 树 radio 禁用 + a-alert 说明原因（权限点 / `storage.browse_enabled=0`） | 否 | 自动落回手动输入 |

**接口契约（已实现，勿改形状）**

```
GET  /api/admin/settings/storage          → { code:0, data:{ uploadDir, source, browseEnabled, defaultDir, envOverride, allowedRoots, restartHint } }
PUT  /api/admin/settings/storage          ← { uploadDir } → { code:0, data:{ uploadDir, previousDir, check, restartRequired:true, message } }
POST /api/admin/settings/storage/validate ← { uploadDir } → { code:0, data:{ ok, resolvedPath, exists, isDirectory, writable, freeSpace, created, code?, message } }
GET  /api/admin/settings/storage/browse?path= → { code:0, data:{ path, root, parent, depth, entries:[{name,path,symlink}], truncated } }
GET  /internal/storage/path（×2：system-service 权威值 / upload-service 内存值，x-internal-key）
```

权限：读 + 校验 + 保存 → `settings:view` / `settings:edit`；**浏览目录 → `storage:browse`（仅 super_admin）**。

### 状态覆盖自查（design.md §3，逐项勾）

- [x] 加载中（loading）：读取配置与校验、树懒加载均有骨架/loading
- [x] 空态（原因+出路）：空目录 →「没有子目录，可点『使用此目录』或补子路径」
- [x] 失败可重试：读配置失败 → 卡内错误 + 重试；校验失败 → 结果块 + 可改再校验
- [x] 破坏性二次确认：本页无破坏性操作（改目录可回退）
- [x] 禁用有 tooltip 原因：保存禁用（未校验/校验不通过，文案说明）；树禁用（权限/开关）
- [x] 保存中防重复提交：loading 期间按钮不可点
- [x] 无弹窗套弹窗：本页不弹窗

### 落地方案（供 rd-execute 用）

- 文件：`apps/deploy-console/src/views/SystemSettings.vue` 新增「存储配置」卡（不动现有「通知与审批」卡逻辑，仅把其保存按钮降为 secondary）
- 新增 API 封装：`apps/deploy-console/src/api/storage-settings.ts`（4 个调用 + 类型；`/internal/storage/path` 无需前端调用，前端取「当前生效值」用 **upload-service 的对外可见方式**——落地前确认：若不便直连内部接口，则由 A2 的 `GET /api/admin/settings/storage` 增补 `effectivePath` 字段回传，**不要在前端拼内部路径**）
- 组件：a-descriptions / a-radio-group / a-tree（`loadData`）/ a-input / a-alert / a-tag / message
- 权限：用 `userStore.hasPermission('storage:browse')` 决定树可用性；`settings:edit` 决定保存可用性
- 文案：全部走原型文案（已在质检记录中定稿）

### 风险/待澄清

1. **「当前生效目录」的来源需要一个对外接口**：upload-service 的 `/internal/storage/path` 是内部接口（`x-internal-key`），前端不能直连。落地前需二选一：(a) A2 的 `GET /api/admin/settings/storage` 增补 `effectivePath`（system-service 代表前端去问 upload-service）；(b) 新增一个 admin 可见的只读代理接口。**未定则本页只能展示权威值 + 重启提示**（功能可用，但少了「当前 vs 待生效」对比）。
2. **保存后是否提供重启入口**：原型仅提示不含入口（待拍板，见质检记录 §一.1）。
3. **谁可改目录**：现为 `settings:edit`（admin 可改）。是否收紧为仅 super_admin 待定。
4. **目录树懒加载的规模**：后端单层上限 200 条 + 深度 5 层；a-tree 需按层加载，勿一次性拉全树。

### admin 侧处理（A6 配套：删掉重复且未接线的存储设置）

**背景**：`apps/admin` 的「系统设置」有 `storage` tab（存储方式 local/OSS、Bucket、Region、AccessKey/SecretKey、
上传大小限制）。核查后确认它是**未接线的空壳**：这些键（`storage_type` / `storage_bucket` / `storage_region` /
`storage_access_key*` / `storage_max_upload_mb`）在全仓 `servers/`、`packages/` **零引用**，配置表里**零值**；
真正生效的上传限制来自 upload-service 的 `CATEGORIES` 代码常量。

**决策（2026-09-22，用户）**：去掉 admin 侧的「存储配置」，真正生效的「上传根目录」统一由
**deploy-console 系统设置**（本规格）承载，避免两处都能改存储却只有一处生效。

**删除范围**（`apps/admin/src/views/Settings.vue`）
| 项 | 说明 |
|---|---|
| `<a-tab-pane key="storage" tab="存储配置">` 整块 | 含存储方式单选、OSS 字段（bucket/region/AK/SK）、上传大小限制 |
| `KEY` 映射里的 `storageType/storageBucket/storageRegion/maxUploadMB` | 连同 `storage` reactive 对象、回填与提交逻辑 |
| 页头副标题 | 现为「…包括站点信息、安全策略、通知与存储」→ 去掉「与存储」 |
| 保存时的键 | 提交 payload 不再带上述键（避免继续往配置表写死键） |

**不做的事**
1. **不清库**：配置表里若曾有这些键（本机为零条），保留不动 —— 清理属数据操作，收益低、误删风险高。
2. 不迁移「上传大小限制」到新页面：它当前是代码常量；将来若要可配，另立需求（不要顺手挂到本轮页面上）。

**验证要点**：admin「系统设置」不再出现存储 tab；其余 tab（基本信息/安全/通知）保存后配置表键不变；
`storage.upload_dir` 只在 deploy-console 页面可改。

**原型稿**（2026-09-22 补，UI 门要求）：`docs/ui/prototypes/admin-settings.html`
- 单文件桌面 Web 壳（admin 亮色），含「[原型] 变更对照：移除前 / 移除后」切换 —— 移除前多一个
  「存储配置」tab（划线标注「本次删除」）并展示其内容作为对照；移除后即本次落地目标。
- 页头副标题：**`管理平台全局配置，包括站点信息、安全策略与通知`**（去掉原句末的「与存储」）。
- 质检与实跑证据见 `docs/ui/prototypes/deploy-console-settings-storage-质检记录.md` §附。


