# 契约草案 · 个人信息更新接口（PATCH /api/user/profile）

> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
> 日期：2026-11-09
> 服务：`servers/auth-service`（端口 6101）
> 消费方：`apps/dachengzi-minigram`（大橙子个人助理小程序）
> 关联：`specs/auth-service/api-design.md`（C1 对外 HTTP 接口真相源）· `docs/api/contracts.md`（C5 网关路由登记）

## 1. 背景与范围

小程序「个人信息」页需要把**昵称**与**头像**持久化到后端。现状：

- `auth-service` 的 `UserController`（`@Controller('user')`）只有 `GET /user/profile`（读）与 `GET /user/:id`，**无写接口**。
- `UserService.update(id, Partial<User>)` 已存在，可直接复用。
- `User` 实体（`packages/shared/src/entities/user.entity.ts`）已含 `nickname`（varchar 50）、`avatar`（varchar 500，头像 URL）两列。

## 2. 接口契约

### PATCH /api/user/profile

- 鉴权：`Bearer JWT`（`@UseGuards(JwtAuthGuard)`，`req.user.userId` 由 `JwtStrategy.validate` 注入 `payload.sub`）
- 请求体（JSON）：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| nickname | string | 否 | 昵称，trim 后非空才更新，截断至 50 字符（对齐列宽） |
| avatar | string | 否 | 头像 URL，截断至 500 字符（对齐列宽） |

- 响应（与现有 `GET /user/profile` 同风格）：

```json
{ "code": 200, "data": { "id": 1, "username": "wx_xxx", "email": null, "nickname": "新昵称", "avatar": "https://...", "phone": null, "roles": ["user"] } }
```

- 错误：
  - 无 `userId`：`{ "code": 401, "message": "未登录" }`
  - 无可更新字段：`{ "code": 400, "message": "无可更新的字段" }`

## 3. 网关路由（C5）

`auth-service` 目前经 gateway 只暴露 `/api/auth`、`/api/auth/qrcode` 两个前缀（`specs/auth-service/api-design.md` §网关访问前缀），**`/api/user/*`（UserController）尚未暴露**。

本次在 `servers/gateway/src/proxy/proxy.controller.ts` 新增：

- `@All('user')` → `getAuthProxy()`（`/api/user` 精确匹配）
- `@All('user/:path(*)')` → `getAuthProxy()`（`/api/user/*` 通配）

放置于 `auth/:path(*)` 之后、`users/:path(*)` 之前。经 `authProxy` 的 `^/api` pathRewrite 后，`/api/user/profile` → `/user/profile`，命中 `UserController`。

> 与 `/api/users/*`（user-service，复数）前缀不同、不冲突；新增后 `GET /api/user/profile`、`GET /api/user/:id` 也一并对外可达（均为只读 + 鉴权）。

## 4. 消费方（小程序）

- `services/account.ts` 新增 `updateProfile({ nickname?, avatar? })`，走 `PATCH /api/user/profile`。
- `utils/request.ts` 的 `RequestOptions.method` 联合类型补充 `'PATCH'`，并新增 `patch()` 快捷方法。
- 响应信封 `{ code, data }` 由 `unwrapProfile()` 统一解包为 `ProfileInfo`（`fetchProfile` 同步接入该解包，修复此前直读 `info.phone` 的潜在信封错位）。

## 5. 头像上传取舍（必读）

- **后端未接对象存储**，`avatar` 列只存 URL 字符串。
- **最小实现**：小程序用 `button open-type="chooseAvatar"` 拿临时路径 → `wx.getFileSystemManager().saveFile` 转**本机持久路径** → 存 `storage(kd_profile_avatar)` + `globalData.userInfo.avatar`。
- **本次仅把 `nickname` 提交后端持久化**；`avatar` 字段接口已留好，但前端暂不传（本地路径不是 URL，传上去会污染多端可读的 `avatar` URL 字段）。头像**仅本机持久化**，跨端不同步。
- 后续接对象存储 / 上传通道后，只需在 `onSave` 补一次文件上传并回填真实 URL，后端无需再改。

## 6. 前端页面改动（`pages/mine/profile/`）

- 头像：`chooseAvatar` 按钮包 `<image>`；无头像时回退「橙」占位。
- 昵称：`<input type="nickname">` + 保存按钮。
- 手机号行：置灰「暂不可用」，去掉 `getPhoneNumber` 交互。
- 邮箱行：保持 `bindtap → navigateTo bind-email`，不改。
- 「我的」页（`pages/mine/index/`）：删除底部「退出登录」按钮（归设置页）。
