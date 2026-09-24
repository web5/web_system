# 远端微前端入口未接通（prod）· 设计方案

> 立项：2026-09-24，登记于 `specs/version-deploy/design.md §7`（专项 P1）
> 状态：**待确认**（本文只给方案，确认后才动代码）
> 相关：`specs/app-artifact-env-dir/design.md`（env-dir 产物与指针，其 Q5 = 本文要回答的 dev/prod 是否切 env 段）、
> `specs/pipeline-node-model/design.md`（P1 节点 host + SSH 通道）、`specs/remote-backend-release/design.md`（后端远端全链，不覆盖前端指针）

---

## 1 问题

prod 上「流水线发布成功」与「线上真的在跑这个版本」之间没有闭环：产物投到了 prod 机器，但 **prod 的 gateway 读不动这批产物**，控制台里记的「当前版本」只是**账面值**。

### 1.1 实测事实（2026-09-24，prod）

| 项 | prod 现状 |
|---|---|
| 产物目录 | flat 旧布局：`modules/portal/98f29b6/`、`modules/admin/98f29b6/`、`modules/shell/prod/{c934736,4ea6d64}` |
| 入口指针 | `modules/<app>/<env>/index.js` **不存在**（shell 连 env 层都没有指针） |
| `__manifest__` | `env=prod`，只有 `portal/admin@98f29b6`，**无 shell** |
| gateway 二进制 | `dist/deploy-version/` 缺失、`dist/apps/` 无 entry-pointer → **仍是旧读取语义** |

### 1.2 机制澄清（纠正一个常见误解）

- gateway **从不读磁盘上的入口指针文件**，它只是把指针的 **URL** 拼进 manifest：
  `servers/gateway/src/deploy-version/index-html.service.ts:182` → `/static/modules/<app>/<envId>/index.js`
- manifest 的**真相源是数据库**（`deploy_sites/deploy_envs/deploy_apps/deploy_app_env_versions`，注入于 `:64-71`，读取于 `:161-171`）；
  是否出现在 `byEnv` 只由 DB 行决定（`:179`），非 `env-dir` 的 app 直接被跳过（`:178` —— 这就是 shell 缺席的原因）。
- 开关：`DEPLOY_LEGACY_READ`（`:90-104`，默认关 → 走新表）、`DEPLOY_ENV_ID`（默认 `dev`）。

⇒ 所以「未接通」的**根因不是指针文件缺失本身**，而是：① prod gateway 是旧二进制；② 远端投递没有 env 层；③ 指针写入只在编排者本机。

### 1.3 缺口清单（改哪三处才真正接通）

| # | 缺口 | 证据 |
|---|---|---|
| G-A | env-dir 指针写入**只在本机 fs**，无远端通道（后端有 `applyBackendRemote`，前端没有） | `apps.service.ts:420-423` 本地 `writeEnvEntryPointer`；`deploy.service.ts:311` env-dir 分支直接 return，其后的 SSH 分支只服务 backend（`:504-511`） |
| G-B | 远端投递落 **flat、无 env 层** | `remote-delivery.service.ts:57` `REMOTE_MODULES_ROOT/<key>/<version>`；`p20` DEV_SCRIPT `$PUBLISH_PATH/$VER` |
| G-C | p22/p24 的 env-dir 改造**显式排除 dev/prod** | `p22:17`「dev/prod 保持…不动」、`p24:11`「仅 local 投递动作」 |
| G-D | p27 远端 pointer 把微前端排除，责任推给「远端控制台手动切」，而手动路径在远端是死路（`hasEnvVersion` fail-fast 400） | `p27:126-130`、`p27:11-14`；`apps.service.ts:408-412` |
| G-E | **prod gateway 是旧二进制**，即使指针生成也读不动 | 实测 `dist/deploy-version/` 缺失 |
| G-F | 两个根不是同一目录：`RELEASE_WORKSPACE/servers/...` vs `/data/web_system/servers/...` | `release-paths.ts:22` vs `:25` |
| G-G | 没有「远端已生效」的校验与回写，库里 currentVersion 纯账面 | `specs/version-deploy/design.md:141-142` |

---

## 2 目标与非目标

**目标**
- G1：env-dir 应用（shell 等）能在 prod **真正生效**，且与控制台显示一致。
- G2：消除「发布成功但没生效」的静默失效 —— 部署动作必须**校验远端生效**，失败要显式失败，不能只写库。
- G3：`deploy_deployments` / `deploy_app_env_versions` 的当前版本对远端环境**可核验**（账面值 → 可验证值）。

**非目标**
- 不改流水线节点模型本身（host + SSH 属 `specs/pipeline-node-model` P1，本文尽量不依赖它）。
- 不迁移历史 flat 目录里已有的老版本（保留可回滚即可）。
- 不做 prod 的灰度/多版本并存（后续议题）。

---

## 3 方案对比

| | 方案 A：补「远端写指针」 | **方案 B：DB 直读版本目录（去指针化）** | 方案 C：维持 flat，只升级 gateway |
|---|---|---|---|
| 做法 | 远端投递加 env 层；新增「远端写指针」执行体（复用 `RemoteDeliveryService` 的 ssh 通道，在目标机写 `index.js` + 校验） | 远端投递加 env 层；gateway 的 manifest entry **直接拼版本目录** `/static/modules/<app>/<env>/<version>/index.js`，不再依赖磁盘指针文件 | 不动投递布局，仅把 prod gateway 升到新二进制 + 对齐 DB 版本 |
| 写侧复杂度 | 高：新增跨机写文件 + 幂等 + 校验 + 失败回滚 | 低：**远端不再需要写文件**，只需投递版本目录（能力已具备，加 env 层） | 低 |
| 读侧改动 | 无（gateway 仍读指针 URL） | 中：`buildManifest` 的 entry 拼法改为版本目录（兼容：指针存在时仍可走指针） | 无 |
| 依赖 | 需要跨机写文件能力（与 pipeline-node-model P1 的 SSH 通道同源） | **不需要跨机写文件**（只需已有的 scp/ssh 投递） | 无 |
| 多环境隔离 | ✅ | ✅ | ❌（flat 无 env 层，多环境会互相覆盖） |
| 缓存语义 | 指针 no-cache，切换即时 | 版本化 URL，天然可长缓存（对 CDN 更友好） | 同左 |
| 回滚 | 需重写指针文件 | DB 版本回退即可（版本目录 immutable，仍在盘上） | DB 回退 |
| 主要风险 | 跨机写失败难以自证；与本机指针双份真相 | 旧 gateway（未升级机器）读不到 → 需先完成 G-E 升级 | 不解决 env-dir 应用（shell）与新机制，属拖延 |

**推荐：方案 B**，理由：
1. manifest 的真相源**本来就是数据库**，再加一层「磁盘指针文件」是两份真相 —— 去掉它反而更自洽；
2. 远端不必写文件，直接绕开 G-A / G-F 这两个最难、最容易静默失败的点；
3. 版本化 URL 更适合缓存；回滚只改 DB；
4. 不依赖 pipeline-node-model P1 落地，可独立推进。

**保留 A 作为备选**的前提：若后续要求「入口 URL 固定不变」（例如外部硬引用 `/static/modules/<app>/<env>/index.js`），则必须做 A。届时机写指针 + 校验回写，且本机那份指针同样保留给未升级的 gateway。

---

## 4 决策表

| # | 决策 |
|---|------|
| D1 | 采用方案 B：gateway 的 manifest entry 由 DB 版本**直拼版本目录**；**不再依赖磁盘指针文件**判断是否生效 |
| D2 | 入口指针文件**保留生成**（本机/已升级路径），仅作为旧 gateway 的兼容层；新 gateway 不再读它 |
| D3 | 远端投递布局升级为 `<REMOTE_MODULES_ROOT>/<app>/<envId>/<version>/`；历史 flat 目录**保留不动**（回滚锚点） |
| D4 | prod gateway 必须先升级到含 `deploy-version`/env-dir 能力的新二进制（G-E），否则本方案不成立 —— 升级走 `docs/operations/release-checklist.md`（注意 env 铁律：禁止 `env -i` 重启） |
| D5 | 部署/切指针动作增加**远端生效校验**：curl 目标机入口返回 200 且 manifest 版本 == 目标版本；失败 → 动作判 failed，**不写库**（或写库但标 `verified=false`） |
| D6 | shell 等非 env-dir 模块：先登记为 env-dir 应用（`deploy_apps.deployMode`），纳入同一链路；否则继续走 legacy flat，页面明确标注 |
| D7 | 不引入 pipeline-node-model 的 host+SSH 作为前置依赖；其 P1 落地后，可把「校验」也下沉到节点执行 |

---

## 5 分期

### P0 · 止血（低风险，建议先做）

- 页面/接口层面把远端环境的「当前版本」标为**未校验**，避免被当成线上真相（对应 G-G）。
- 提供「校验远端生效」只读动作：curl 目标机 manifest 与入口，返回版本是否一致。
- 不改任何写入链路，零停机。

### P1 · 核心接通

1. prod gateway 升级（新二进制 + 依赖同步 + 按发布清单重启）。
2. 远端投递脚本加 env 层（`PUBLISH_PATH/<env>/<version>/`），保留 legacy 副本可选。
3. gateway `buildManifest` 改直拼版本目录（D1），兼容旧指针。
4. 部署动作加远端校验（D5）。

### P2 · 收口

- legacy flat 目录退役与清理（保留最近 N 个版本）。
- 指针文件生成逻辑收敛/下线（待全部 gateway 升级完成）。
- 「发布后自动生效」开关（流水线发布即自动切版本，而非手动点部署）。

---

## 6 验证判据（V1…Vn）

- V1：prod `__manifest__` 的 `source=new`，且 shell 出现在 `byEnv.prod` 中。
- V2：prod 上 `curl /static/modules/<app>/<env>/<version>/index.js` 返回 200（版本目录真实存在）。
- V3：在控制台对 prod 执行「部署到版本 X」后，V1 的 manifest 版本 == X，且 V2 的入口可访问；动作结果含校验通过标记。
- V4：故意指向一个**未投递**的版本 → 部署动作**显式失败**（不再只写库），DB 当前版本**不变**。
- V5：回退到上一版本后，V3 再次通过（回滚只需改 DB，无需重新投递）。
- V6：portal/admin 等 legacy 应用在 P1 期间**无回归**（页面可加载、版本不变）。
- V7：prod 发布全程按 `docs/operations/release-checklist.md` 执行，发布后 `NODE_ENV=production` 与端口在位、`/health` 全 200。

---

## 7 风险与回滚

| 风险 | 处置 |
|---|---|
| prod gateway 升级本身是线上变更（有停机） | 走发布清单 + 窗口；备份 dist 与 ecosystem；先 dev 验证再 prod |
| 直拼版本目录后，旧 gateway（未升级机）读不到 | D2：保留指针文件生成作为兼容层；升级顺序先 gateway 后切读取方式 |
| 投递加 env 层后，历史流水线的老脚本仍写 flat | P1 期间兼容两种布局；P2 再统一 |
| 校验动作误判（网络抖动） | 校验重试 2 次 + 超时明确；校验失败只标记，不自动回滚 |
| 与 pipeline-node-model P1 重复建设 | 本文不实现 SSH 通道，只复用现有 `RemoteDeliveryService` 的投递能力；P1 落地后收敛 |

---

## 8 决策确认（2026-09-24 用户拍板）

| # | 议题 | 结论 |
|---|------|------|
| Q1 | 方案选择 | **B（DB 直读版本目录，去指针化）**；入口指针文件保留生成，仅作旧 gateway 兼容层 |
| Q2 | P0 止血（可见性标注 + 只读校验） | **不单独做**，随 P1 一并落地 |
| Q3 | shell 是否登记为 env-dir 应用 | **是**（D6 生效，纳入同一链路） |
| Q4 | 投递加 env 层后是否双写 flat 副本 | **不双写**；历史 flat 目录保留只读作为回滚锚点，不删除 |
| Q5 | prod 升级顺序 | **先升级 gateway**；但升级后先保持 legacy 读取语义（见 tasks.md 阶段 A），待 env 层产物就位再切新语义 |
| Q6 | 「发布后自动切版本」 | **不做**；维持现状：流水线发布只写「最新发布」记录，**切版本只在「部署」动作执行**（与 `p27` 口径一致） |

> 任务拆解与执行顺序见 [tasks.md](./tasks.md)。
