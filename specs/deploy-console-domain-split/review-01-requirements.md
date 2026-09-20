# 需求评审 · deploy-console 双域重构（第 1 轮：需求与设计一致性）

> 状态：**已确认（2026-09-18）** —— Q101 / Q103 / Q106 / Q107 与 Q105（选 B）由用户拍板，其余按建议通过；
> 修订动作已完成：`requirements.md` → v1.1、`design.md` → v2；技术方案见 `tech-design.md`
> 评审目的：在输出技术方案之前，先解决「需求/设计/原型」三者之间的不一致与缺口；**未确认前不进入技术方案**
> 评审输入：`requirements.md`(v1.0) · `design.md`(v1.0) · `environment-design.md`(v1.1) · `page-spec.md`(v1.3) · 已落地原型代码
> 评审方法：文档交叉一致性 → 需求完整性 → 可行性风险 → 验收可测性

---

## 0. 评审结论（摘要）

| 项 | 结论 |
|---|---|
| 方向 | ✅ 清晰：双域分离 + 环境作为微前端加载维度 + envId 目录，方向无异议 |
| 原型 | ✅ 已可运行（console 三域页面 + 共享 EnvSwitcher），可作为实现基线 |
| **文档一致性** | ❌ **有 8 处冲突，其中 4 处为模型级**（两套环境模型并存）。必须先定稿，否则技术方案会写成两套 |
| 需求完整性 | ⚠️ 9 处缺口（产物生命周期、站点与 env 的基数、小程序/shell 的环境语义、切换与登录态等） |
| 技术风险 | ⚠️ 8 项，其中 **R1（覆盖式发布的缓存/回滚）** 与 **R4（前后端环境联动）** 会直接影响架构选型 |
| 阻塞项 | **Q101 / Q103 / Q105 / Q106 / Q107** 五项必须人工拍板，其余可按建议默认通过 |

---

## 1. 评审依据（事实源清单）

### 1.1 文档

| 文档 | 版本 | 角色 |
|---|---|---|
| `requirements.md` | v1.0 | 需求 spec（FR-1~FR-10 + EARS 判据） |
| `design.md` | v1.0 | 数据模型 + 接口契约 + 迁移计划 |
| `environment-design.md` | v1.1 | 环境模型重设计（**晚于 design.md 写成**） |
| `page-spec.md` | v1.3 | 页面规格（含环境详情、服务域三 tab 等修订） |

### 1.2 已落地代码（原型即代码，作为实现基线）

| 层 | 文件 | 事实 |
|---|---|---|
| 框架 | `apps/deploy-console/src/layouts/MainLayout.vue` | 顶部一级（仪表盘/微前端/API 网关/流水线/基础设施）+ 左侧二级 |
| 微前端域 | `views/AppManager.vue` · `AppDetail.vue`（3 tab：概览/路由/部署） | 应用注册与发布 |
| 微前端域 | `views/EnvironmentManager.vue` · `EnvironmentDetail.vue`（基本信息 + **后端服务指向**） | 环境列表（envId/站点/内置/排序/启用）+ 指向编辑 |
| API 网关域 | `views/ServiceManager.vue` · `ServiceDetail.vue`（5 tab，**接口默认**） | 服务与接口清单 |
| 共享 | `packages/ui/src/components/EnvSwitcher.vue` | 挂件 → 大弹窗（ID 前置 + 搜索 + 常用）→ `localStorage` + `location.reload()` |
| 挂载点 | `apps/shell/src/App.vue` · `apps/admin/src/layouts/BasicLayout.vue`（`v-if="!inShell"`） | 基座提供 / 模块 standalone 兜底 |
| 已下线 | `/modules*` 路由、`ModuleDetail.vue`、`ModuleEdit.vue` | 旧模块管理退役 |

---

## 2. 文档一致性冲突（必须定稿）

| # | 冲突点 | 位置 A | 位置 B | 影响 | 建议 |
|---|---|---|---|---|---|
| **C1** | **两套环境模型并存**（模型级） | `design.md` §0.2/§1.1/§1.3：`deploy_environments` + `deploy_env_slots`（slot 概念） | `environment-design.md` §2：`deploy_sites` + `deploy_envs`（envId 自增，**无 slot**） | 无法同时实现；技术方案会分叉 | **以 `environment-design.md` 为准**，重写 `design.md` 环境章节 |
| **C2** | `requirements.md` 前提 D1 与术语仍写「同环境多实例 slot」 | `requirements.md` §1.3 D1、§3 术语表「环境实例 slot」、FR-8.4、§2 场景"给 dev 加一套 dev2 实例" | `environment-design.md` §2.3：「去掉 slot，dev1/dev2 是**并列环境**」 | 需求判据自相矛盾（FR-8.4 在新模型下成为无效需求） | 修订 D1 表述；删除 slot 术语；FR-8.4 改写为「同一站点可建多个环境，无实例数上限」 |
| **C3** | 版本指针表结构不一致 | `design.md` §1.2 `deploy_app_deployments(appKey, envKey, slotKey)` | `environment-design.md` §2.3 `deploy_app_env_versions(appKey, envId)` | 表结构与迁移脚本无法确定 | 采用 `deploy_app_env_versions`（去 slot） |
| **C4** | 服务"指向"的编辑入口与表结构 | `design.md` §1.3 `deploy_service_envs(serviceKey, envKey, slotKey)`（服务维度） | `page-spec.md` §5.1 + 原型：**环境详情 → 后端服务指向** | 归属与 UI 入口不一致 → 权限、缓存失效范围不同 | 表保留 `deploy_service_envs`，**去 slotKey**，**入口以环境为中心**（服务详情只读） |
| C5 | 产物路径 | `design.md` 多处仍写 `/static/modules/<key>/<version>/` | `environment-design.md` §3：`/static/modules/<key>/<envId>/` | 发布/回滚/缓存策略不同 | 切到 envId 目录（版本保留策略见 R1） |
| C6 | gateway manifest 结构 | `design.md` §3.4：数据源切到 `deploy_app_deployments` | `environment-design.md` §4：返回 `envs` / `byEnv` / `switchable` | 前端加载协议不同 | 采用 `envs/byEnv`（兼容期保留旧字段） |
| C7 | 迁移计划 | `design.md` §6 M1–M8（含"建 default slot""写 slotKey='default'"） | 新模型无 slot | 迁移脚本不可执行 | 重写迁移计划（见 §7） |
| C8 | 环境管理页字段与模型 | `design.md` §1.1 `deploy_environments`（key/name/kind/runtime/baseUrl） | 原型 `EnvironmentManager`（envId/name/siteKey/isProd/builtin/sort/enabled） | 页面与表结构不一致 | 以原型为准回写 `design.md` |

---

## 3. 需求完整性缺口（建议补充）

| # | 缺口 | 为什么重要 | 建议 |
|---|---|---|---|
| G1 | 环境删除后，产物目录与历史版本如何处置 | 影响磁盘占用与回滚能力 | 环境删除 → 目录保留 N 天（可配），并禁止在被引用时删除 |
| G2 | 一个 envId 是否可归属多个站点 | 决定 `siteKey` 是 1:N 还是 N:N | 建议 **1 个 envId 属于 1 个站点**（页面按站点分段；简化 manifest 生成） |
| G3 | `local` 站点多环境的物理含义 | local 是"本机发布目录"，与远程主机语义不同 | 明确 local 多环境 = **多个发布目录**（或仅用于本地验证，不允许并行） |
| G4 | 小程序（`mini-app`）的环境语义 | 小程序不走 shell 挂载，有独立发布通道 | 明确小程序是否也按 envId 目录；建议**本期不纳入**，只登记 |
| G5 | shell 基座是否纳入 envId 目录 | Q2 已答"不走"，但 shell 仍在 `deploy_apps` 中 | 明确 shell 走「站点 + 版本」通道，部署策略分叉（不是 env 目录） |
| G6 | `deploy-console` 自身发布通道（不能自杀式重启） | 影响服务部署策略实现 | 服务表增加 `deployChannel: managed \| legacy`，legacy 走传统脚本 |
| G7 | 环境切换与登录态的交互（token 跨环境有效？切换后是否需重登？） | 体验与安全，实现必答 | 见 R4 / Q106 |
| G8 | 环境切换是否需要审计（谁切到哪个环境） | 运营可追溯性 | 建议记录一条 audit 事件（成本低） |
| G9 | `unknownPolicy=allow`（未登记接口放行）的默认风险 | 网关会放行未登记接口 | 建议默认 `allow`（迁移期）+ 对未登记接口产生**观测告警** |

---

## 4. 技术风险（技术方案必须回答）

| # | 风险 | 后果 | 建议对策 |
|---|---|---|---|
| **R1** | **覆盖式发布与浏览器缓存冲突**：envId 目录被新产物覆盖后，旧的分包文件（带 hash）若被清理，正在运行旧版本的页面会 404 | 用户白屏 | 采用 `envId/` 固定入口 + **保留最近 N 版分包**；或 `envId/<version>/` + `envId/index.js` 指向当前版本（**此项直接影响架构，需定**） |
| **R2** | 切换版本 / 回滚依赖产物保留 | 功能不可用 | 与 R1 同一机制；保留策略需给出默认值（建议 5 版 / 7 天） |
| **R3** | 「切换环境」与「切换版本」语义易混 | 用户误操作 | 明确：环境切换 = 换**加载目录**（整页 reload）；切换版本 = 换该目录**指向的版本**（也 reload） |
| **R4** | **前后端环境联动一致性**：切到 envId=1，后端指向是否同步切到"1 的建议集" | 前端用新代码、后端连旧地址 → 数据错乱 | 约定 **envId 同时决定前端产物与网关上游**（gateway 按 envId 解析上游）；切换即整页 reload，两侧同时生效 |
| R5 | gateway manifest 缓存 TTL 60s vs「切完 reload 立即生效」 | 切换后仍加载旧环境 | 切换时在 manifest 请求带 `?env=<id>` 绕过缓存，或把 TTL 降到 5s |
| R6 | 灰度（canary）与新 env 目录的叠加规则未定义 | 两者无法共存 | 明确阶段：本期先跑通 env 目录，灰度后续叠加（两者正交：env 决定目录，canary 决定同目录内的版本） |
| R7 | 迁移期回退能力 | 出问题无法快速回滚 | 保留 `DEPLOY_LEGACY_READ` 开关（gateway 读旧表） |
| R8 | 路径结构变更对 nginx / CDN 的影响 | 静态资源 404 | `/static/modules/` 前缀不变，仅目录层级语义变化，**nginx 无需改** |

---

## 5. 待确认清单（需人工拍板）

> 标注 ⭐ 的为**阻塞项**，必须回答；其余可按建议默认通过（回复"其余按建议"即可）。

| # | 问题 | 选项 | 我的建议 |
|---|---|---|---|
| ⭐ **Q101** | 环境模型以哪份文档为准？ | A. `environment-design.md`（sites + envs，无 slot）<br>B. `design.md`（environments + slots） | **A**。B 已被你 2026-09-18 的澄清否定 |
| ⭐ **Q103** | 版本指针表 | A. `deploy_app_env_versions(appKey, envId)`（无 slot）<br>B. 保留 slot | **A** |
| ⭐ **Q105** | 产物目录与版本共存策略（决定 R1/R2） | A. `envId/index.js` 覆盖式 + 保留最近 N 版**分包**<br>B. `envId/<version>/` + `envId/index.js`（或指针文件）指向当前版本<br>C. 其他 | **B**：版本天然保留、回滚=改指针、缓存友好；代价是多一层目录与一个指针写入 |
| ⭐ **Q106** | 环境切换后登录态 | A. 保留 token（同一域，token 有效）<br>B. 强制重新登录（更安全）<br>C. 保留 token 但校验失败自动跳登录 | **A**（同域切换，体验优先；权限仍由后端 JWT 校验兜底） |
| ⭐ **Q107** | shell 基座与小程序是否纳入 envId 目录 | A. 都不纳入（shell 走站点+版本，小程序另议）<br>B. shell 纳入<br>C. 都纳入 | **A** |
| Q102 | `requirements.md` D1/术语/FR-8.4 按新模型修订 | 同意 / 不同意 | 同意（修订为"并列环境"） |
| Q104 | 服务"指向"编辑入口 | A. 环境详情（服务详情只读）<br>B. 服务详情<br>C. 两处都可改 | **A**（已在原型实现） |
| Q108 | 灰度与 env 目录的排期 | A. 本期先 env 目录，灰度后续<br>B. 本期一起做 | **A** |
| Q109 | 旧数据迁移映射 | A. 旧 `local/dev/prod` → 新同名字段保留字，历史 `deploy_deployments` 数据平移<br>B. 重建 | **A** |
| Q110 | 环境切换是否记审计 | 记 / 不记 | 记（一条 audit 事件） |
| Q111 | 站点与 envId 基数（G2） | A. 1 个 envId 属 1 个站点<br>B. 可多站点 | **A** |
| Q112 | 版本/分包保留默认值 | 建议 5 版 or 7 天 | 5 版 + 7 天取先到者 |

---

## 6. 需求可测性检查

| 检查项 | 结果 |
|---|---|
| EARS 判据可测 | ✅ FR-1~FR-10 大多可测（"当…时，系统应…"） |
| 缺少性能类判据 | ⚠️ 建议补：manifest 接口 P95 < 100ms；环境切换（reload 到可用）< 3s |
| 缺少兼容性判据 | ⚠️ 建议补：切换 env 后旧页面不 404（对应 R1）；新旧数据双读期一致 |
| 缺少安全类判据 | ⚠️ 建议补：切换环境不得绕过服务端鉴权（前端仅改加载源） |

---

## 7. 确认后的修订动作（我来做）

| # | 动作 | 产出 |
|---|---|---|
| 1 | 按 Q101/Q103 重写 `design.md` 环境与版本部分（删除 `deploy_environments` / `deploy_env_slots` / slot 相关） | `design.md` v2 |
| 2 | 按 Q102 修订 `requirements.md`（D1、术语表、FR-3/FR-8/FR-10、B3） | `requirements.md` v1.1 |
| 3 | 按 Q104 更新 `design.md` 的服务环境归属描述 | 同上 |
| 4 | 按 Q105/R1 定义产物与版本共存策略（目录结构 + 保留策略 + 指针写法） | `design.md` §产物与缓存 |
| 5 | 按 Q106/Q109/Q111 补充「环境切换与登录态」「迁移映射」「站点基数」章节 | `design.md` |
| 6 | 重写迁移计划（migrations 脚本清单） | `design.md` §迁移 |
| 7 | **输出技术方案**（见 §8） | `tech-design.md` |

---

## 8. 技术方案（下一份文档）的目录预告

确认上述后，技术方案将按此结构输出，便于评审：

1. 架构总览（双域 + 共享基础设施 + 流水线适配层）
2. 数据模型（最终 DDL：表 / 字段 / 索引 / 约束）
3. 接口契约（console REST + gateway manifest/proxy 内部契约）
4. 运行时链路（产物发布 → envId 目录 → 指针 → manifest → shell 加载 → EnvSwitcher）
5. 前后端环境联动（envId → 网关上游解析）
6. 缓存与版本保留策略
7. 迁移方案（表迁移 + 数据迁移 + 双读回退开关）
8. 风险与对策（逐条对应 §4）
9. 分期实施计划（P0–P4 任务清单与验收判据 V1…Vn）
10. 测试策略（单测/集成/端到端）

---

## 变更日志

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-09-18 | v1.0 | 第 1 轮需求评审：8 处文档冲突（4 处模型级）、9 处完整性缺口、8 项技术风险、12 条待确认（5 条阻塞） |
