# 界面偏好跟账号同步（B 方案）— 页面/接口规格

> 上游：`specs/radius-style-dual/page-spec.md`（圆角三档机制）、`page-spec-legacy-convergence.md`（存量收敛已完成）
> 决策（2026-09-23，负责人确认）：**走 B（跟账号同步）**；**范围仅 portal + 小程序**；**偏好入口不移出登录墙**。
> 原型：本轮**零 UI 改动**，无需新原型（理由见 §1.2）。

## 1. 目标与范围

### 1.1 要解决的问题

现状：四端各写各的本地存储（portal `ui-prefs` / admin+console `theme-store` / 小程序 `appearance_radius`），换端/换设备偏好丢失。本期让**用户端（portal、小程序）**的界面偏好**跟账号走**。

### 1.2 范围与「零 UI 改动」说明

| 端 | 本期行为 | 理由 |
|---|---|---|
| **portal** | 登录后拉取服务端偏好并覆盖本地；本地改动即时上报 | 用户端 |
| **小程序** | 同上 | 用户端 |
| admin / deploy-console | **保持各端本地独立** | 内部工具，无"跨端一致"诉求 |

**入口位置与文案一律不变**（仍在 portal「我的 → 偏好」卡片、小程序「我的 → 小程序设置 → 圆角风格」），改动只在数据流。

> **不触发 UI 动作门**：改动文件为 `servers/**`、`packages/shared/**`、`apps/portal/src/{stores,api,lifecycle}.ts`、`apps/kedou-ai-minigram/{app.ts,utils/appearance.ts}` —— 均不在 `apps/*/pages/**`、`apps/*/components/**`、`packages/ui/**`、`app.json`、`*.wxml/.wxss/.vue` 范围内。**若实施中需要动上述任一路径（含小程序 `pages/mine/settings/settings.ts`），则必须先出原型并走完整 UI 门。**

## 2. 数据模型

字段加在共享用户实体 `packages/shared/src/entities/user.entity.ts`（该文件是用户表结构唯一真源；`servers/user-service/src/user/user.entity.ts` 仅转发）：

```ts
/** 圆角风格三档（口径：specs/radius-style-dual/page-spec.md §2） */
export type UiRadiusStyle = 'soft' | 'crisp' | 'sharp';

/** 界面偏好（跟账号走；本期仅圆角风格，后续可扩） */
export interface UserPreferences {
  radiusStyle?: UiRadiusStyle;
}

// User 实体新增（与既有 roles / 归属系统 的 json 列同风格）
/** 界面偏好 JSON */
@Column({ type: 'json', nullable: true, comment: '界面偏好（跟账号走）' })
preferences?: UserPreferences | null;
```

**设计取舍**：用 `json` 而非 `varchar(16) radius_style` —— 后续界面偏好（字号、主题、语言）可继续挂进同一列，避免每加一项就改表；接口层仍用 DTO 白名单约束，不会变成"任意 JSON 容器"。

## 3. 接口契约

复用既有路由，**不新增 endpoint**。

### 3.1 读取

`GET /users/me`（portal 已有 `getCurrentUser()`；小程序复用其登录态请求）→ 响应新增 `preferences` 字段：

```json
{ "id": 1, "nickname": "…", "preferences": { "radiusStyle": "crisp" } }
```
- `preferences` 为 `null` 或缺省 ⇒ 客户端**保持本地值**（不覆盖）。
- 未知键（未来版本写入的）⇒ 客户端忽略，不报错。

### 3.2 写入

`PUT /users/me`（已存在，portal `updateUserProfile()` 即此路由）→ 请求体新增可选 `preferences`：

```json
{ "preferences": { "radiusStyle": "sharp" } }
```

**服务端语义（必须）**：

| 规则 | 要求 |
|---|---|
| 校验 | `preferences.radiusStyle` 仅允许 `soft` / `crisp` / `sharp`，非法值 → 400 |
| 合并 | `preferences` 为**浅合并**（读旧值 → 展开新值 → 写回），不得整体覆盖，避免将来多字段互相抹除 |
| 幂等 | 同值重复提交结果一致 |
| 脱敏/安全 | 沿用既有 `AuthGuard`（只能改自己的）+ 全局 ValidationPipe 白名单 |
| 日志 | 复用 `Logger`，不新增 `console.log`；不打印 token |

## 4. 两端数据流

### 4.1 portal

```
启动/lifecycle.mount()
  ├─ useUiPrefsStore().init()            # 先按本地值应用（现有行为，减少首屏跳变）
  └─ fetchUserInfo() 成功后（已登录）
       └─ syncFromServer(user.preferences)
            └─ 有 radiusStyle ⇒ setRadiusStyle(server值) 并写回本地（服务端为准）

用户点击偏好 radio
  └─ setRadiusStyle(v)
       ├─ 立即应用根属性 + 持久化本地   # 现有行为（乐观，UI 不等网络）
       └─ PUT /users/me { preferences:{ radiusStyle:v } }   # 失败仅记日志，不回滚 UI
```

### 4.2 小程序

```
app.ts onLaunch → autoLogin() 成功后
  └─ 拉取 /users/me → appearance.applyFromServer(prefs.radiusStyle)
       └─ 有值 ⇒ wx.setStorageSync + 后续各页 onShow 自然生效

用户在小程序设置里选风格
  └─ appearance.setStyle(v)   # 现有入口调用点不变（仍在 pages/mine/settings，但该文件不改）
       ├─ wx.setStorageSync（现有行为）
       └─ 异步 PUT 上报（失败仅日志，不回滚）
```

## 5. 边界与冲突策略

| 场景 | 行为 |
|---|---|
| 未登录 / 401 | 纯本地，不报错、不弹窗（portal 入口本就在登录墙后） |
| 网络失败（拉取） | 保持本地值；下次登录/启动重试 |
| 网络失败（上报） | UI 不回滚（已应用的值保持），仅记日志；形成"本地与服务端不一致"，下次拉取时**服务端为准**覆盖 |
| 服务端 `preferences` 为 null | 不覆盖本地（视为"用户从未设置过"） |
| 服务端值非法（数据被外部写坏） | 忽略并保持本地 |
| 两端同时改 | 后登录/后启动的一方按服务端值收敛（服务端为准） |
| 登出 | **不清理本地偏好**（保留用户最后选择；下次登录若服务端有值则覆盖） |

## 6. EARS 验收判据

- **AC1**｜当用户已登录且在 portal 把圆角切为「直角」时，`PUT /users/me` 必须收到 `preferences.radiusStyle='sharp'`，且**页面圆角立即变化**（不等网络回包）。
- **AC2**｜当同一用户在新浏览器/新设备登录 portal 时，页面圆角必须自动变为服务端保存的档位（默认「柔和」用户不受影响）。
- **AC3**｜当用户在 portal 把圆角切为「清爽」后进入小程序（已登录同一账号），小程序圆角必须为「清爽」。
- **AC4**｜当请求体含非法档位（如 `radiusStyle: 'round'`）时，接口必须返回 **400**，且用户表不被写入。
- **AC5**｜当 `PUT /users/me` 仅含 `preferences.radiusStyle` 时，用户既有字段（昵称/头像/性别等）必须**不变**。
- **AC6**｜当 `preferences` 为 `null`（新用户）时，两端行为与本期之前**完全一致**（本地默认「柔和」，零视觉变化）。
- **AC7**｜当上报失败（如断网）时，UI 不得回滚已应用的值，且不得弹错（仅日志）。
- **AC8**｜当 admin / deploy-console 被使用时，其偏好**不得**因本期改动被写入或读取服务端（保持本地独立）。

## 7. 实施任务

| # | 任务 | 落点 | 备注 |
|---|---|---|---|
| 1 | shared：`UserPreferences` / `UiRadiusStyle` 类型 + `preferences` 列 | `packages/shared/src/entities/user.entity.ts`（及其 index 导出） | 影响所有消费 shared 的服务，需重建 shared 产物 |
| 2 | DTO：`UserPreferencesDto` + `UpdateUserDto.preferences` | `servers/user-service/src/user/dto/` | `@IsIn` 白名单 + `@ValidateNested` + `@Type` |
| 3 | service：`updateMe` 浅合并 preferences | `servers/user-service/src/user/user.service.ts` | 幂等 |
| 4 | portal：`syncFromServer` + `setRadiusStyle` 上报 | `stores/ui-prefs.ts`、`api/user.ts`、`lifecycle.ts` | 拉取挂 `fetchUserInfo` 之后 |
| 5 | 小程序：`applyFromServer` + `setStyle` 上报 | `utils/appearance.ts`、`app.ts` | **不动** `pages/**` |
| 6 | 验证 | 见 §8 | 依 AC1–AC8 实测，留证 |

## 8. 验证方式（完成声明 = 证据）

1. **接口层**：`curl` 三例 —— 合法值 200 且回读一致；非法值 400；只传 preferences 后其他字段不变（AC4/AC5）。
2. **portal**：真实浏览器（`:5181`）登录 → 切档 → Network 面板确认 PUT 载荷 → 重新登录/换隐身窗口确认拉取生效（AC1/AC2）。
3. **小程序**：微信开发者工具登录同账号 → 确认拉取生效（AC3）；断网切换确认不弹错、不回滚（AC7）。
4. **回归**：admin / console 偏好仍只走本地（AC8）；新用户（preferences=null）零变化（AC6）。

## 9. 发布注意（易漏）

- **生产环境 `synchronize: false`**（`servers/user-service/src/app.module.ts`），新列**不会**自动建。上线前必须先执行 DDL：
  ```sql
  ALTER TABLE `user` ADD COLUMN `preferences` json NULL COMMENT '界面偏好（跟账号走）';
  ```
  开发/测试环境因 `synchronize: true` 自动同步。
- `packages/shared` 是构建产物依赖：改实体后需**重新构建 shared**，否则各服务读不到新字段类型。
- 网关 `/api/users/*` 已有代理，无需改路由；无需新增 CORS。

## 10. 待确认（实施前）

1. **列名 `preferences`** 是否可接受（备选：`ui_preferences`，语义更窄、更不易被误用为通用配置桶）？
2. **登出是否清理本地偏好**：本规格取「不清理」。若希望登出即复位为默认「柔和」，需改 §5。
3. **是否需要「已同步」提示**：本规格为静默同步（零 UI 改动）。若要在设置项旁显示同步状态，则属 UI 改动 → 走原型门。

### 5.1 实施期发现的阻塞缺陷（2026-09-23 已修）

**portal 的圆角选择器长期没有渲染出来** —— 这解释了「portal 好像没办法用户修改」的真因（不是登录墙）。

- 现象：`apps/portal/src/plugins/antd.ts` 注册的是**子组件** `RadioGroup` / `RadioButton`，而**父组件 `Radio` 从未注册**。
- 机理：ant-design-vue **4.2.6** 中 `RadioGroup` / `RadioButton` **没有 `install` 方法**，`app.use(comp)` 对无 install 的对象**静默无效** → 模板里的 `<a-radio-group>` 变成未解析标签、**整块不渲染**。
- 证据（实测）：浏览器中 `.ant-radio-group` 数量 = **0**、页面残留裸 `<a-radio-group>`；Node 侧 `RadioGroup.install === undefined`、`Radio.install === function`。
- 同类静默失效（同一注册列表内，均无 install）：`FormItem` / `InputPassword` / `TabPane` / `MenuItem` / `MenuDivider` —— 这些属"子组件"，按 admin 既有口径应由父组件 install 自动注册，无需（也无法）单独注册。
- 修法：改为注册父组件 `Radio`（其 install 自动注册 `ARadioGroup` / `ARadioButton`），并补上缺失的 `Alert`（「我的」页 API Key 区块在用），与 `apps/admin/src/plugins/antd.ts` 的既有口径对齐。
- 影响面：portal 全站 `<a-radio-group>` 类控件（此前凡使用处均不渲染）；**不改变任何已确认的视觉设计** —— 原型 `docs/ui/prototypes/radius-style-dual.html` 中的三档选择器即目标形态，本次是让实现与已审原型一致。

### 5.2 实施期发现的两个次要缺陷（2026-09-23 已修）

**① 上报失败会弹全局错误提示（违反 §6 AC7）**

- 现象：后端返回 400 时，portal 弹出红色 toast「property preferences should not exist」。
- 根因：`apps/portal/src/api/request.ts` 错误分支**无条件** `message.error(...)`；小程序 `utils/request.ts` 虽有 `silent` 选项，但「非 401 错误」与「网络失败」两个 toast 未判 `silent`。
- 修法：portal 增加 per-request `silent` 开关（axios 模块增强 + 错误分支判定）；小程序把 `silent` 判定补齐到上述两处；两端偏好上报均改走静默请求。
- 结果：满足 AC7 —— 上报失败**只记日志、不回滚、不打扰用户**。

**② `@web-system/types` 在本包 TS 解析失败（既有问题，非本次引入）**

- 现象：`apps/portal` 下 4 个文件（`stores/ui-prefs.ts` / `stores/user.ts` / `api/user.ts` / `api/auth.ts`）导入 `@web-system/types` 时 vue-tsc 报 `Cannot find module`。
- 证据：`node_modules/@web-system/types` 软链不存在（工作区未链接该包）；运行时由 Vite 侧解析，故应用行为正常。
- 处置：本次**不新增**同类导入（偏好相关类型各端本地声明，取值与 `packages/shared` 一致）；列为待修项（补工作区链接或给 portal 加 tsconfig paths）。
