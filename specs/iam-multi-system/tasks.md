# 任务清单 · 统一账号与系统隔离（IAM 一期）

> 来源：`requirements.md`（V1–V7）/ `design.md`　状态：**待确认后开工**
> 方式：TDD，每任务独立可回退；每项绑定验证判据编号

---

## 1. 任务列表

- [ ] **T1 数据模型：`users.systems`**（判据：V7）　依赖：无
  - `packages/shared/src/entities/user.entity.ts` 加 `systems?: string[] | null` JSON 列
  - 回填脚本：openid 非空 → `['portal']`；`admin`/`test` → `['admin','deploy']`；其余兜底
  - 单测：回填规则纯函数（空值/openid/运营三类）

- [ ] **T2 user-service：按系统过滤用户**（判据：V4, V5）　依赖：T1
  - `POST /internal/users/by-permissions` 增可选 `system`
  - `GET /users` 增 `system` 查询（默认 `admin`，`all` 显式放开）
  - 单测：过滤逻辑 + 与权限码的组合（AND）

- [ ] **T3 auth-service：登录支持 system 并校验**（判据：V1, V2）　依赖：T1
  - `LoginDto` 增 `system?`；JWT payload 增 `systems`
  - 校验：用户 `systems` 不含目标系统 → 403（message 明确）
  - 注册 / 微信 / 小程序三条创建路径写入 `['portal']`
  - 单测：三类用户 × 三个系统的登录矩阵

- [ ] **T4 deploy-console：废弃自建登录，改验统一 JWT**（判据：V3, V6）　依赖：T3
  - 删除 `ADMIN_USER`/`ADMIN_PASS` 比对；`jwt.strategy.ts` 去掉硬编码 `role:'admin'`
  - 缺失 `JWT_SECRET` → 启动失败（去掉兜底串）
  - `ecosystem.config.js` 放开对 console 的 `JWT_SECRET` 注入（同步修改现行"刻意不注入"策略）
  - 单测：验签失败 / 缺 systems 的 token 被拒

- [ ] **T5 console 前端：登录改走 auth-service**（判据：V3）　依赖：T4
  - 登录调 `/api/auth/login`（同源走 gateway），token 结构改为 `{accessToken, refreshToken, user}`
  - 刷新逻辑复用 admin 前端的做法（裸 axios 调 `/api/auth/refresh`）
  - 手工验收：登录后能调 `/console/api/pipelines/meta/approvers`

- [ ] **T6 数据迁移与验证**（判据：V7）　依赖：T1
  - 本机 + dev 各跑一次回填；抽查 C 端与运营账号
  - 清理：console `.env` 移除 `ADMIN_PASS`（并同步 `.env.example`）

---

## 2. 依赖关系

```
T1 ──┬──> T2 ──────────────┐
     ├──> T3 ──> T4 ──> T5 ─┤──> T6（迁移与验证）
     └──────────────────────┘
```

T1 是底座（无字段则一切过滤都无从谈起）；T3→T4→T5 是登录链路，必须顺序做。

---

## 3. 待确认（开工前）

1. **登录不传 `system` 时的默认**：建议默认 `portal`（对 C 端零影响），admin / console 前端显式传。是否同意？
2. **放开 console 的 `JWT_SECRET` 注入**：会与 `ecosystem.config.js` 现行策略冲突，且旧 token 全部失效（需一次性重登）。确认接受？
3. `systems` 用 JSON 数组（一个用户可跨系统，如 admin 兼运维）还是单值？建议数组。
4. 存量 `test` 账号（viewer）归到哪个系统？建议 `['admin']`（不给 deploy）。

---

## 变更日志

- 2026-09-14 首版：6 个任务 + 依赖图 + 4 项待确认。
