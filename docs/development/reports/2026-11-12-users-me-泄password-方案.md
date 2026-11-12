# users/me 响应泄漏 password 哈希修复方案

- 日期：2026-11-12
- 分支：`fix/user-password-exclude`（基于 master e1d924e9）
- 级别：P1 安全（11-11 发布验证实测发现，属既有行为）

## 1. 根因

user-service 的 `UserController.getMe` / `updateMe` 把 TypeORM `User` 实体整体展开进响应体：

- `servers/user-service/src/user/user.controller.ts:74`（getMe）：`{ ...user, avatar: ... }`
- `servers/user-service/src/user/user.controller.ts:83`（updateMe）：同病

`User` 实体含 `password` 列（bcrypt 哈希），随响应原样泄出。

同模式扫描后追加发现两处管理端接口同样泄（service 直接把 `save()` 后的完整实体返回给 controller 当响应体）：

- `POST /users`（create → `user.service.ts:126` 返回完整实体）
- `PUT /users/:id`（update → `user.service.ts:141` 返回完整实体）

已安全的接口（本次不改动）：

- `GET /users`（findAll，`user.service.ts:95-98` 已剥 password）
- `GET /users/profile`、`GET /users/:id`（findOne，`user.service.ts:116-120` 已剥）
- auth-service 登录/注册响应（`auth.service.ts:385-402` 显式挑选字段，无 password）
- auth-service `GET/PATCH /user/profile`、`GET /user/:id`（controller 已解构剥除）

## 2. 方案选型

### 否决：实体 `@Exclude()` + ClassSerializerInterceptor

全仓 grep 无任何 `ClassSerializerInterceptor` 使用。要让 `@Exclude()` 生效必须新增全局序列化拦截器，而 `User` 实体在 `@web-system/shared`，auth-service / todo-service 等共用——新增全局拦截器会改变所有服务全部响应的序列化路径，影响面远超本次修复目标，违背最小爆炸半径原则。

### 采纳：响应边界显式剥除（与 findAll/findOne 既有写法对齐）

1. `user.service.ts`：`create()` / `update()` 返回值剥 password（返回类型改 `Omit<User, 'password'>`），写法与 `findOne` 一致。
   - 内部调用方已核：仅 `user.controller.ts`（create/update 直接当响应、uploadAvatar 忽略返回值），无 service 间依赖，登录/改密链路不经过这两个方法的返回值取密码。
2. `user.controller.ts`：`getMe` / `updateMe` 解构剥 password 后再拼 avatar URL。

约束核对：登录走 auth-service 自己 `findByUsername` 查库做 bcrypt.compare，改密走 `changeOwnPassword`/`resetPassword`（均不读这两个方法的返回值），不动实体列定义、不动 select，登录/改密链路零影响。

## 3. 影响面

| 接口 | 修前 | 修后 |
|---|---|---|
| `GET /users/me` | 泄 password 哈希 | 不含 password |
| `PUT /users/me` | 泄 password 哈希 | 不含 password |
| `POST /users`（admin 创建用户） | 泄 password 哈希 | 不含 password |
| `PUT /users/:id`（admin 编辑用户） | 泄 password 哈希 | 不含 password |
| `GET /users`、`GET /users/profile`、`GET /users/:id` | 已安全 | 不变 |
| 登录/注册/刷新（auth-service） | 已安全 | 不变（跑测试验证不回归） |

响应字段变化仅「少一个 password 键」。前端（admin 用户管理、小程序个人中心）均无读取响应 password 字段的合理用途，判定无兼容风险。

## 4. 微调豁免

无。本改动为安全修复，非机械重构。

## 5. 验证计划

- user-service：`user.service.spec.ts` 补断言「create/update 返回值不含 password」；新增 controller 层断言「getMe/updateMe 响应 data 不含 password」。
- 全量跑 user-service spec；auth-service 登录链路 spec（auth.service.spec / user.service.spec）跑一遍确认不回归。
