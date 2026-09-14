# 需求 · 统一账号与系统隔离（IAM 一期）

> 状态：**待确认**（2026-09-14）
> 上游：`brainstorm.md`（方案 A + 最小 B）。用户四项答复：①先 A 后 B；②**C 端用户必须与运营/运维彻底隔离**；③系统清单 = admin（运营）/ deploy-console（运维）/ portal（C 端，含 mini-contract）；④接受废弃 `.env` 的 `ADMIN_PASS`。

---

## 1. 需求辨证

- **做成** = 三端（portal / admin / deploy-console）共用一套账号，但**一个用户只能登录他被授权的系统**；C 端用户在任何情况下都登不进 admin 与 deploy-console，也拿不到 `deploy:pipeline:approve`。
- **不算做成** = 只是加了 `systems` 字段但登录不校验（形同虚设）；或 console 仍保留自己的 `ADMIN_PASS` 后门。
- **为什么现在做** = 审批人已按权限码从 user-service 拉取，但今天给 `wx_xxx` 授 `deploy:pipeline:approve` 技术上完全可行 —— 隔离是审批体系能成立的前提。

> ⚠️ **与 brainstorm 的偏差（必须记录）**：用户选 A（不引入 system 字段），同时又要求②彻底隔离。
> A 单独做不到②，故本计划 = **A + 最小 B**：登录统一（A）+ `users.systems` 维度（B 的最小子集）。
> 不做：租户、计费、开放 API（按 `specs/agent-platform-evolution/requirements.md` 已排除）。

---

## 2. 用户故事与验收标准（EARS）

| # | EARS |
|---|---|
| E1 | When C 端用户（systems 仅 `portal`）登录 admin 或 deploy-console，系统应拒绝登录并给出明确原因 |
| E2 | When 运营用户（systems 含 `admin`）登录 admin，系统应正常签发令牌 |
| E3 | When 运维用户（systems 含 `deploy`）登录 deploy-console，系统应正常签发令牌；systems 不含 `deploy` 的运营用户应被拒绝 |
| E4 | While 查询可审批人，系统应只返回 systems 含 `deploy` 且持有 `deploy:pipeline:approve` 的用户 |
| E5 | While admin 后台查看用户列表，系统应默认只展示本系统用户，C 端用户不出现在运营后台 |
| E6 | When deploy-console 启动时未配置 `JWT_SECRET`，系统应启动失败（不允许回落到硬编码密钥） |
| E7 | When 存量用户回填完成后，`mp_openid` / `oa_openid` 非空的用户应归入 `portal`，运营账号归入 `admin`+`deploy` |

---

## 3. 验证判据表 V1…V7

| 编号 | 判据（做成 = 一句话可验证） | 验证手段 | PASS 条件 | 不通过如何处理 |
|---|---|---|---|---|
| V1 | C 端用户登不进 deploy-console / admin | `curl -X POST localhost:6101/auth/login -d '{"username":"<wx 账号>","password":"x","system":"deploy"}'` | 返回 401/403 且 message 指明"该账号不属于目标系统" | 明确告知用户，不静默放行 |
| V2 | 运维用户能登 deploy-console | 同上（username=admin，system=deploy） | 200 + 返回 token，payload 含 `systems` | 同上 |
| V3 | console 不再依赖 `ADMIN_PASS` | 从 `.env` 删除 `ADMIN_PASS` 后重启 console，用 auth-service token 调 `GET /console/api/pipelines/meta/approvers` | 200（token 验签通过） | 同上 |
| V4 | 可审批人按系统 + 权限码双重过滤 | `curl /api/pipelines/meta/approvers` | 只含 systems 含 `deploy` 且持权限码的用户；`wx_*` 不出现 | 同上 |
| V5 | admin 用户列表不含 C 端用户 | `curl /api/users?system=admin` | 返回结果中无 `mp_openid` 非空的用户 | 同上 |
| V6 | console 缺 `JWT_SECRET` 时启动失败 | 临时清空该变量后启动 | 进程退出码非 0 且日志明确 | 同上 |
| V7 | 存量数据回填正确 | 查 `users`：`mp_openid/oa_openid` 非空 → systems 含 `portal`；`admin` → 含 `admin`+`deploy` | 两类各 100% 命中，0 遗漏 | 同上 |

### 验证结果（本机，2026-09-14）

| 编号 | 结果 | 证据 |
|---|---|---|
| V1 | ✅ | `ctest`（systems=[portal]）登 `deploy` / `admin` 均 **403**：`该账号不属于「运维控制台」，无法登录（可登录：用户端）`；登 `portal` 200 |
| V2 | ✅ | `admin` + `system=deploy` → 200，payload `systems:["admin","deploy"]` |
| V3 | ✅ | `.env` 的 `ADMIN_PASS` 已注释；console 登录代理返回 201，`token` 251 字符，带它调 `approvers` → 200 |
| V4 | ✅ | 故意给 `role=user` 误授 `deploy:pipeline:approve`：不传 system 返回 4 人（含 `wx_*`），传 `system=deploy` 只剩 `admin` |
| V5 | ✅ | `?system=admin` → admin、test；`?system=portal` → 2 个 `wx_/mp_`；`?system=deploy` → 仅 admin |
| V6 | ✅ | `JWT_SECRET= node dist/main.js` → 启动即报 `deploy-console 缺少 JWT_SECRET…`，端口未监听 |
| V7 | ✅ | 回填 4/4：`admin=[admin,deploy]`、`test=[admin]`、`wx_*=[portal]`、`mp_*=[portal]`；越权 0 |

> 说明：V1 的 C 端账号（`ctest`）为临时建、验完即删；误授的 `role_permissions` 也已清理。

---

## 变更日志

- 2026-09-14 首版：用户四项答复落地为需求；记录「A 单独做不到②」的偏差，方案调整为 A + 最小 B。
