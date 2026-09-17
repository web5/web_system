# 方案探索 · console 用户管理 & user-service 多系统能力

> 状态：**待选择**（2026-09-14）
> 触发：审批人接入权限体系（B1）后引出的两个问题 —— console 要不要用户管理？user-service 要不要支持多系统？

---

## 需求理解

一句话：随着 deploy-console 也按权限码控制审批人，需要决定「console 的用户从哪来」以及「user-service 要不要从『单系统的用户中心』升级成『多系统的 IAM 中心』」。

## 需求辨证

- **做成** = 任意一个内部系统（admin / deploy-console）都能回答「这个用户是谁、属于哪些系统、有哪些权限」，且**只有一处**能改答案。
- **不算做成** = 每个系统各建一套账号（今天 console 的 `.env` 管理员就是这一类的苗头）；或只加字段但没有系统隔离，C 端小程序用户仍能被授予 `deploy:pipeline:approve`。
- **为什么现在做** = 审批人已按权限码从 user-service 拉取（B1），下一步 B2（console 登录统一）必然要回答"console 的用户是谁"；越晚做，console 侧的自建账号越容易长出来。

---

## 关键约束

| 约束 | 现状 |
|---|---|
| user-service 实体 | 只有 `users` / `roles` / `role_permissions` / `permissions` / `mcp_api_keys` / `mcp_key_codes`，**没有任何 tenant / system / app 字段** |
| 用户构成 | `users` 表里 **C 端小程序用户（`wx_*` / `mp_contract_*`）与运营用户（`admin` / `test`）混存** |
| 角色 | 全局固定 4 个：`super_admin` / `admin` / `editor` / `viewer`，无系统维度 |
| 权限码 | 全局一张表；"系统"只体现在命名前缀（`deploy:` / `system:` / `agents:` …）上，**是约定不是机制** |
| console | 无用户表，登录是 `.env` 的 `ADMIN_USER`/`ADMIN_PASS` |
| 已定排除项 | `specs/agent-platform-evolution/requirements.md`：多租户、计费、开放 API **不做**（注意：那是**产品级多租户**，与本议题的"内部多系统 IAM"不是一回事，不要混为一谈） |
| 红线 | 权限码单一真相源在 `packages/types`；跨端配置收口 `@web-system/shared` |

---

## 方案对比

### 方案 A：console 接入 user-service 认证（B2），**不引入 system 字段**

- **思路**：console 登录改走 user-service（JWT），用户/角色/权限全部复用；"系统"继续由权限码前缀表达（`deploy:` = 运维系统），靠 `ROLE_PERMISSIONS` 控制谁能拿到。
- **优点**：改动最小；单一用户源；与已落地的 B1 一脉相承（B1 是过渡，A 是收口）。
- **缺点**：C 端用户与运营用户仍同表 —— 给 `wx_xxx` 授 `deploy:pipeline:approve` 技术上可行，靠流程约束；console 可用性依赖 user-service。
- **涉及文件**：约 8–10 个（console auth 模块改造 + 前端登录态 + user-service 登录接口支持来源标识）

### 方案 B：引入 `system` 维度（轻量多系统）

- **思路**：`users` 增加 `systems`（或 `user_systems` 关联表），`roles` / `permissions` 增加 `system` 列；登录与授权都带系统上下文，console 只看 `system='deploy'` 的用户与角色。
- **优点**：真隔离，C 端用户天然进不来；后续接第三个内部系统零成本。
- **缺点**：改 3 张表 + seed 逻辑 + 同步接口 + admin 角色管理页 + portal 登录链路要标 system；迁移存量用户。
- **涉及文件**：约 20+ 个

### 方案 C：console 自建用户管理

- **思路**：console 自己建 `console_users` / `console_roles`。
- **优点**：自治、不依赖 user-service。
- **缺点**：**违反单一真相源** —— 两套账号要手工同步，审批人名单会漂移；今天的"手填用户名"就是这个坑的雏形。
- **涉及文件**：约 10 个，但长期成本最高

### 方案 D：独立 IAM / 引入成熟方案（Keycloak 等）

- **优点**：标准、开箱有多系统（realm）与 SSO。
- **缺点**：引入新组件与运维成本；与项目「自研、不追产品化」的定位冲突；存量用户迁移更痛。

---

## 推荐

🥇 **先 A，条件成熟再 B**：

1. A 是 B1 的自然收口（B1 已经是"审批人来自 user-service"，只差登录统一），1–2 天可落地，能立刻消除"console 一个口令管全部"的现状；
2. B 的触发条件应该是**出现明确隔离需求**（比如要把 C 端用户彻底挡在运维权限外，或有第三个内部系统接入），现在上会为假想需求付迁移成本；
3. C / D 不推荐：C 制造第二套真相源，D 与项目定位不符。

**明确不做**：产品级多租户（按 `specs/agent-platform-evolution` 已排除）。

---

## 待确认

- [ ] portal 的 C 端用户（`wx_*` / `mp_contract_*`）是否必须与运营/运维用户彻底隔离？（决定 A 够不够，还是必须 B）
- [ ] console 是否接受"可用性依赖 user-service"？（若不接受，需要本地缓存登录态/降级方案）
- [ ] 内部"系统"清单怎么定：`admin`（运营）、`deploy-console`（运维）、`portal`（C 端）、`kedou-ai-minigram`？还有别的吗？
- [ ] 是否接受 console 用 admin 系统的账号登录（废弃 `.env` 的 `ADMIN_PASS`）？

---

## 变更日志

- 2026-09-14 首版：console 用户管理与 user-service 多系统能力的方案探索（A/B/C/D），推荐 A 后 B。
