# 设计 · 统一账号与系统隔离（IAM 一期）

> 状态：**待确认**（2026-09-14）｜需求见 `requirements.md`

---

## 1. 现状（已取证）

| 项 | 现状 |
|---|---|
| 系统清单 | portal（C 端，含 kedou-ai-minigram）／ admin（运营）／ deploy-console（运维） |
| users 表 | **无 system 字段**；C 端与运营混存，只能靠 `mp_openid` / `oa_openid` 是否非空区分（用户名 `wx_` 前缀两种来源都用，不可靠） |
| auth-service | `POST /auth/login`，**自己直连 users 表**校验；JWT payload `{sub:userId, username, roles, type}`；密钥 `JWT_SECRET`（与 gateway 同源，缺失即退出） |
| deploy-console | **独立登录**：`.env` 的 `ADMIN_USER`/`ADMIN_PASS` 硬比对；JWT payload `{sub:username}`、无 roles、硬编码 `role:'admin'`；密钥有 `'deploy-console-secret-key-change-in-production'` 兜底；`ecosystem.config.js` **刻意不给它注入 JWT_SECRET** |
| nginx | `location /console/` 直连 6200，**绕过 gateway**；console 前端登录调 `/console/api/auth/login` |
| 权限码 | 全局一张表；"系统"只体现在前缀（`deploy:` / `system:`）约定 |

---

## 2. 方案总览（A + 最小 B）

```
                    ┌──────────────────────────────┐
 portal / admin  ──▶│  gateway  /api/auth/*        │
 console(前端)   ──▶│      → auth-service(6101)     │──▶ users 表（新增 systems）
                    └──────────┬───────────────────┘
                               │ 签发统一 JWT（含 systems）
                    ┌──────────▼───────────────────┐
                    │ deploy-console(6200) 只验签   │
                    │ 不再有登录逻辑、不再有口令     │
                    └──────────────────────────────┘
```

- **A（登录统一）**：console 废弃自建登录，改为**校验 auth-service 签发的 JWT**；前端登录改调 `/api/auth/login`（走 gateway）。
- **最小 B（系统维度）**：`users` 增 `systems: string[]`；登录、授权、用户列表三处按系统过滤。

**不做**：租户 / 计费 / 开放 API；`roles`、`permissions` 暂不加 `system` 列（权限码前缀已能区分，等真出现跨系统同名权限再说）。

---

## 3. 数据模型

```ts
// packages/shared/src/entities/user.entity.ts
/** 该用户归属的系统（多值）：portal / admin / deploy */
@Column({ type: 'json', nullable: true, comment: '归属系统：portal(C端) / admin(运营) / deploy(运维)' })
systems?: string[] | null;
```

回填规则（一次性脚本 + 之后由创建路径保证）：

| 用户来源 | systems |
|---|---|
| `mp_openid` / `oa_openid` 非空（微信/小程序注册） | `['portal']` |
| 账号密码注册（portal 注册入口） | `['portal']` |
| 运营手工创建（admin 后台） | 创建时勾选，默认 `['admin']` |
| 运维账号 | 显式授予 `['deploy']`（可与 `admin` 并存） |
| 存量 `admin` / `test` | `['admin','deploy']`（保持现有运维可用） |
| 空值兜底 | 有 openid → `portal`；否则 `['admin']` |

---

## 4. 接口契约

```ts
// auth-service
POST /auth/login  { username, password, system?: 'portal'|'admin'|'deploy' }
  → 200 { accessToken, refreshToken, user }         // payload 增加 systems
  → 401/403 用户不属于该系统（message 明确"该账号不属于 X 系统"）

// user-service（内部）
POST /internal/users/by-permissions  { codes: string[], system?: string }
  → 现有接口增加可选 system 过滤（console 传 'deploy'）

// user-service（admin 后台）
GET /users?system=admin      // 默认按调用方系统过滤，空值=不过滤（需显式传 all）
```

---

## 5. 关键改造点

| # | 服务 | 改动 | 风险 |
|---|---|---|---|
| 1 | shared | `User.systems` 字段 | 低；synchronize 建列，存量回填脚本 |
| 2 | auth-service | 登录 DTO 增 `system`；校验 `systems`；payload 带 `systems`；注册/微信登录写入 `['portal']` | 中：portal/admin 前端登录不传 system → 需定**默认系统**（建议按调用来源：不传=portal，保证 C 端不受影响） |
| 3 | deploy-console | 删除 `ADMIN_USER/ADMIN_PASS` 校验；改为 JwtStrategy 验 auth-service 的 token（**同一 JWT_SECRET**，缺失即启动失败）；`jwt.strategy.ts` 去掉硬编码 `role:'admin'`，改从 payload 的 roles/systems 判定 | **高**：与 `ecosystem.config.js`「刻意不注入 JWT_SECRET」的现行策略冲突，必须同步放开；且要处理"老 token 失效" |
| 4 | deploy-console 前端 | 登录改调 `/api/auth/login`（gateway）；token 结构 `{accessToken, refreshToken, user}`；刷新逻辑复用 | 中：console 走 nginx 绕过 gateway，需新增 `/console/api/auth/login` 代理到 auth-service，或前端直连 `/api/auth/login`（同源，推荐后者） |
| 5 | user-service | 用户列表/可审批人支持 system 过滤 | 低 |
| 6 | 数据 | 存量回填脚本 + 验证 | 低 |

---

## 6. 假设与必然

- **假设**：console 与 auth-service 能共用同一 `JWT_SECRET`（部署在同一批机器上，密钥本来就在 env 体系里）。若否 → 退化为 console 调 user-service 内部接口自行签发，改造量更大。
- **必然**：只要 users 表不分系统，隔离就只能靠应用层过滤 —— 一期接受这个代价（用户量级小），二期若需要再上分表/独立库。
- **不可逆点**：放开 console 的 JWT_SECRET 注入后，旧的自签 token 全部失效，需要一次性重新登录。

---

## 变更日志

- 2026-09-14 首版：A + 最小 B 的技术方案、数据模型、接口契约与改造点。
