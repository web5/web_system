# CI/CD 方案 · 结合现有发布能力的设计

> 类型：design.md
> 日期：2026-09-08
> 关联：`specs/release-platform/design.md`（发布平台现状）· `docs/development/local-release-runbook.md`（运维现状）· `docs/development/ai-native-sdlc-ci-deployment.md`（CI 现状）
> 定位：本文件是 CI/CD 的单一事实源，只描述**目标态与落地路径**，不重复发布平台内部设计。

---

## 一、结论先行

**核心判断：我们不缺 CD 引擎，缺的是 CI 与 CD 之间的那一段。**

`deploy-console`（Beehive）经过 S0–S8 已经是一个**能力完整的 CD 引擎**：步骤编排、审批门禁、灰度、回滚、通知、度量、审计、配置注入、发布锁、取消、MCP 接入。
而 CI 侧只有门禁（`quality-gate` 红线 + 改动包 build/test），**不产出任何制品**。
两端之间没有触发通道——人 push 完，还要手动打开控制台点「发布」。

所以方案不是"重写一套 CI/CD"，而是：

```
补三段管线            +        复用现有全部 CD 能力
① CI 门禁（已有，补强）          ① 九阶段编排（已有）
② CI 构建产物（新增）    ----->   ② 版本/指针语义（已有，不 shell 化）
③ 触发通道（新增）               ③ 审批/灰度/回滚/通知/度量（已有）
```

**最大的杠杆**：S1 已把各阶段命令**数据化**到 `deploy_module_stage_commands`、S8 已把步骤**注册表化**。
因此本期 CI/CD 演进中，「构建方式从"目标机现编"改成"拉取制品"」**只需改 DB 里的步骤命令，不必改一行流水线代码**——这是之前重构留下的红利，必须吃满。

---

## 二、现状盘点

### 2.1 已有能力（可直接复用）

| 层 | 能力 | 载体 | 状态 |
|---|---|---|---|
| CI 门禁 | 红线扫描 R1~R5 | `scripts/redline/scan-rules.sh` + pre-commit(`.githooks`) + `quality-gate.yml` | 可用 |
| CI 门禁 | 改动包 build/test | `scripts/ci/changed-packages.sh` | 可用；**lint 档未挂载**（子包缺 ESLint flat config） |
| CI 协作 | 自动建 PR | `auto-pr.yml` | 可用 |
| CI 治理 | 数字人行为变更评测门禁 | `kit-gate.yml` | 可用 |
| CD 引擎 | 九阶段流水线（步骤注册表驱动） | `servers/deploy-console/src/pipeline/` | 可用，已评审 |
| CD 引擎 | 阶段/步骤命令数据化 | `deploy_module_stage_commands` | 可用（改命令即改行为） |
| CD 引擎 | 版本写入 + 指针切换 | `registry/release-registry.service.ts` | 可用，语义真相源 |
| CD 引擎 | 产物存储 / 远程投递 | `artifact-store` / `remote-delivery`(tar·scp·ssh) | 可用 |
| CD 引擎 | 探活 | `probe/http-probe` + `pm2/pm2-probe` | 可用 |
| CD 引擎 | 并发锁 / 取消 / 自动回滚 | `release-lock` + `pipeline.service` | 可用 |
| CD 治理 | 审批门禁 / 审计 diff / 通知 / 度量 | `approval`/`audit`/`notification`/`metrics` | 可用 |
| CD 接入 | MCP 工具（publish_pipeline 等 9 个） | `mcp-gateway:6006` + `servers/deploy-console/src/mcp/` | 可用 |
| 运行时 | gateway manifest + 灰度解析 | `gateway` `__manifest__`、`resolveCanary` | 可用 |
| 运行时 | 配置中心（三级作用域 + 密钥加密） | `config/` | 可用 |

### 2.2 结构性缺口（这是"走不顺"的根因）

| # | 缺口 | 后果 |
|---|---|---|
| G1 | **CI 与 CD 断链**：GitHub Actions 只做检查，不触发部署 | 人肉点发布；忘记发 / 发错分支 / 发错版本 |
| G2 | **CD 执行者跑在开发者笔记本上**：`deploy-console` + 发布目录 `~/web_system_release` + pm2 全在本机 | 关机/休眠/换网即断；本机 PATH、fnm、node_modules 状态污染构建结果；**构建环境不可复现** |
| G3 | **无制品**：每次发布在目标机 `git pull` 后现场构建 | 产物与 commit 无强绑定；同一 commit 两次构建结果可能不同；回滚依赖磁盘残留目录（清理策略保留 5 个，超出即无法回滚） |
| G4 | **无 schema 迁移门禁**：生产靠 TypeORM `synchronize` | 结构变更无法评审、无法回滚，是生产级风险 |
| G5 | **旧链路双轨**：`scripts/deploy.sh`（无 micro-frontend 分支、更新错库）+ 前端「发布中心」入口仍在 | 两个发布入口，新旧语义打架，用户不知道该用哪个 |
| G6 | **无环境晋升流水线**：dev→prod 靠人工重提 | 无法保证"prod 发的就是 dev 验过的那个产物" |
| G7 | **无部署后冒烟**：verify 只探活端口/HTTP 200 | 服务起来了但功能坏了不会拦住 |
| G8 | **运行时形态与仓库声明不一致**：实际 pm2 跑发布目录，仓库 `docker-compose.prod.yml` 描述的是 4 个容器 |  newcomers 按 compose 部署必然错 |

---

## 三、目标架构

```
        GitHub（唯一入口）
             │
   ┌─────────┴──────────┐
   │ push/PR            │ push master / tag
   ▼                    ▼
┌────────────┐    ┌──────────────┐
│ ci.yml     │    │ release.yml  │
│ 红线+build │    │ 构建制品      │
│ +test+lint │    │ 上传制品库    │
└────────────┘    └──────┬───────┘
                         │ 制品坐标（module + version=commit + url + digest）
                         ▼
                  ┌──────────────┐
                  │ 触发通道      │  HMAC 签名 + 幂等键
                  │ deploy-console│  POST /api/hooks/release
                  └──────┬───────┘
                         ▼
        ┌────────────────────────────────────┐
        │ Beehive 流水线（现有，几乎不改）      │
        │ check → pull* → build* → upload     │
        │ → version → pointer → verify        │
        │ → cleanup                           │
        │  * 有制品时：pull=仅对齐元数据,      │
        │    build=跳过, upload=下载+解包     │
        └────────────────────────────────────┘
                         │
                  gateway manifest 切指针 / 灰度
```

**三条铁律（对齐发布平台既有决策，不推翻）**

1. `version` / `pointer` 仍是发布语义真相源，**永不 shell 化、永不由 CI 直接写库**——CI 只交付"制品 + 发布意图"，指针必须由 Beehive 切。
2. 制品坐标里的 `version` 必须等于**源码 commit 短哈希**，与现状 `CHECK` 阶段语义一致（杜绝"版本标签与代码内容不一致"这个历史高危坑）。
3. 触发通道**只递参数不递代码**：CI 不 SSH 到目标机执行任何命令，控制权始终在 Beehive（保留锁、审批、审计、回滚）。

---

## 四、分期落地

### P0 · 打通断链（1～2 天，改动最小，收益最大）

目标：`push master → 自动发 dev`，不依赖开发者本机在线。

| # | 事项 | 落地 |
|---|---|---|
| P0-1 | 新增触发端点 | `deploy-console`：`POST /api/hooks/release`。校验 `X-Hub-Signature-256`（HMAC-SHA256，密钥 `RELEASE_HOOK_SECRET`）+ 时间戳防重放 + `delivery_id` 幂等。内部**复用 `PipelineService.submit`**，与控制台/MCP 同一入口 |
| P0-2 | 幂等表 | `deploy_release_events(delivery_id UNIQUE, payload, status, pipeline_id)`；重复投递直接返回首次结果 |
| P0-3 | 新增 `ci.yml` | 合并现有 `quality-gate` 的红线 + changed-packages，并**挂上 lint**（先补各子包 `eslint.config.*`，或明确 lint 只对新包生效） |
| P0-4 | 新增 `release.yml` | 触发：`push master` + `workflow_dispatch`。步骤：解析改动模块（复用 `scripts/ci/changed-packages.sh` 的产物）→ 对每个受影响模块调用触发端点（dev）→ 轮询 `GET /api/pipelines/:id` 至终态 → 失败则 job 红 |
| P0-5 | 审计落点 | 触发来源记 `operator = ci`（**禁止**落到 `mcp/anonymous/unknown`；现状 MCP 侧已有 ownerId 规范，CI 侧对齐新增 `ci:<workflow>` 形态） |

**不改变**：构建仍在目标机（发布目录）现场执行。P0 只解决"谁来按按钮、按钮在哪按"。

### P1 · 制品化（核心，解决 G2/G3/G6）

目标：构建在 GitHub Actions 里跑一次，产物与 commit 强绑定，目标机只做投递。

| # | 事项 | 落地 |
|---|---|---|
| P1-1 | 制品库 | 后端服务 → **GHCR 镜像**（tag = commit）；前端微前端 → **tar.gz 上传 GitHub Release Asset**（路径 `modules/<key>/<commit>.tar.gz`，内含 `dist/`） |
| P1-2 | 流水线接收制品 | 提交参数增 `artifact: { url, digest, kind }`。落在 `deploy_pipelines` 新列（可空，兼容历史） |
| P1-3 | 改步骤命令（**改 DB，不改代码**） | backend `build` → `docker pull ghcr.io/...:<commit>`；`upload` → 解包/标记镜像 + `pm2 restart`；frontend `build` → `curl -L <asset> \| tar xz`；`upload` → 解包到产物目录。用现有 `MODULE_TYPE` 变量分支 |
| P1-4 | 复用产物路径打通 | 现有 `check` 阶段已有 `reuseArtifact`（磁盘已有该版本产物则跳过 build/upload）。P1 后把"制品库已存在"纳入同一判定，语义统一 |
| P1-5 | 保留策略 | 现状"磁盘保留 5 版"改为"**制品库保留 30 天/最近 20 版 + 磁盘保留 5 版**"。回滚不再依赖磁盘残留（解 G3） |
| P1-6 | 后端运行时 | 短期仍 pm2（最小改动）；镜像里打 `dist/`，`upload` 步骤解包到发布目录后 `pm2 restart`。长期见 P2 |

### P2 · 环境晋升与自愈（治理收口）

| # | 事项 |
|---|---|
| P2-1 | **环境晋升**：prod 发布只能选"已在 dev 验证过的 version"（由 `list_releases` 提供候选），禁止 prod 现场构建新产物（解 G6） |
| P2-2 | **Schema 迁移门禁**：关闭生产 `synchronize`；`migrations/` 目录正规化（命名 `<ts>-<desc>.sql`，up/down 成对），CI 检查"改了 entity 必须有对应迁移文件"，由流水线 `check` 阶段在部署前执行（解 G4） |
| P2-3 | **部署后冒烟**：verify 从"端口 200"升级为"关键路由断言"（`__manifest__`、`/health`、login 探活）。失败沿用现有 verify 失败自动回滚（解 G7） |
| P2-4 | **旧链路下线**：删除前端「发布中心」入口，统一到「发布流水线」（解 G5） | ✅ **2026-09-08 已完成（部分）**：前端菜单 / 路由 / `DeployCenter.vue` 已删除，`deployApi` 中 9 个已无引用的旧动作方法（build/deploy/rollback/publishVersion/tasks/task/releases/currentVersions/versions）已清理，前端类型检查通过。**未删 `scripts/deploy.sh`** —— `scripts/publish.sh` 仍调用它、`DeployService` 回滚探活依赖其任务模型，已改为头部标注 DEPRECATED（含两个已知缺陷说明），待 publish.sh 迁移到流水线后连同 `/api/deploy/*` 旧动作接口一并删除。 |
| P2-5 | **运行时声明收口**：`docker-compose.prod.yml` 要么补全为真实形态（全部服务），要么标注 deprecated 并给出 pm2 真相（解 G8） |

---

## 五、与现有能力的结合点（复用 / 改造 / 新建）

| 能力 | 判定 | 说明 |
|---|---|---|
| 九阶段流水线 + 步骤注册表 | **复用** | 唯一执行引擎，CI 不绕过它 |
| `version`/`pointer` 语义 | **复用且加固** | CI 永不直写版本表（历史踩过"写错库"坑） |
| 步骤命令数据化 | **复用** | P1 构建方式改造 = 改 DB 命令，零代码 |
| 发布锁（原子抢占） | **复用** | CI 并发触发同样受锁保护，天然幂等 |
| 审批门禁 | **复用** | prod 仍走审批；CI 提交只进入 `pending-approval` |
| 灰度 / 回滚 / 通知 / 度量 / 审计 | **复用** | 无需改造，实例表加列即可 |
| MCP `publish_pipeline` | **复用** | AI/CLI 侧入口保持；CI 走 HTTP 钩子（更便于 HMAC 鉴权） |
| `remote-delivery`(tar/scp/ssh) | **改造** | 从"本机打包推远程"转为"目标机从制品库拉取"，职责变轻 |
| `quality-gate.yml` | **改造** | 并入 `ci.yml`，补 lint |
| `scripts/deploy.sh` + 发布中心页 | **废弃** | P2-4 |
| 触发端点 / 幂等表 / 制品管线 | **新建** | 本期唯一新增代码面 |

---

## 六、关键决策与权衡

| # | 决策 | 备选 | 理由 |
|---|---|---|---|
| D1 | **不引入外部 CD 工具**（ArgoCD/Jenkins），继续以 Beehive 为唯一引擎 | 引入 ArgoCD | 现有引擎已覆盖审批/灰度/回滚/审计，且与"版本指针"语义深度耦合；外挂工具要重建这套语义，收益为负 |
| D2 | **CI 不 SSH 到目标机** | Actions 直接 ssh 部署 | 绕过锁/审批/审计/回滚就等于废掉半年建设；且密钥放 CI 风险高 |
| D3 | **短期不容器化全部服务** | 全量 Docker/K8s | 现状 pm2 + 发布目录已稳定运行；容器化是独立大改，与 CI/CD 打通解耦，避免一次改太多 |
| D4 | **制品库用 GHCR + Release Asset，不自建** | 自建 MinIO/Nexus | 团队规模小，GitHub 生态内闭环，零运维 |
| D5 | **version = commit 短哈希** | 语义化版本号 | 与 gateway manifest、现有产物目录命名、回滚语义完全一致，无迁移成本 |
| D6 | **触发端点与 MCP 共用 `submit`** | 为 CI 单开执行路径 | 单一执行入口 = 锁/审批/审计/度量自动一致 |
| D7 | **self-hosted runner 作为可选加速** | 必须用 GitHub 托管 runner | 若构建耗时过长，可在目标机挂 self-hosted runner 做**构建缓存**；但触发链路不变（仍经 Beehive），避免回到"执行者在本机"的老问题 |

---

## 七、风险与缓解

| 风险 | 缓解 |
|---|---|
| 钩子端点暴露在公网被伪造触发 | HMAC 签名 + 时间戳窗口 + `delivery_id` 幂等 + 来源 IP 段可选白名单；端点不返回任何敏感信息 |
| GHCR 拉取需要凭据 | 目标机一次性 `docker login`，凭据进配置中心（现有密钥 AES 加密），不进仓库 |
| P1 后构建失败排查变远（在云端不在本机） | Actions 日志按模块归档；失败时流水线日志保留最后 200 行并链接回 run url |
| 前端 tar 产物与 `vite build --mode mf` 的 `RELEASE_TAG` 耦合 | 构建时统一注入 `RELEASE_TAG=$GITHUB_SHA::7`，与现状一致 |
| 制品库清理误删正在运行的版本 | 清理前查询 `deploy_deployments` 当前指针 + 灰度规则引用版本，命中即跳过（复用现有 cleanup 逻辑的判定） |
| 一次改动触发多模块并发发布 | 发布锁已按 module×env 互斥；CI 侧串行提交并在同一 job 内聚合结果 |

---

## 八、验收（EARS 式）

- **P0**：当 push 到 master 时，`release.yml` 应在 2 分钟内为每个受影响模块创建一条流水线；当流水线失败时，GitHub job 应为红且 PR/commit 状态可回溯。
- **P0**：当同一 `delivery_id` 重复投递时，应返回首次结果且不产生第二条流水线。
- **P1**：当发布同一 commit 两次时，第二次应命中制品复用，跳过构建，总时长较首次下降。
- **P1**：当磁盘产物已被清理（仅剩 <5 版）时，回滚到 30 天内的任意历史版本仍应成功。
- **P2**：当 entity 变更但无迁移文件时，CI 应失败。
- **P2**：当 prod 发布所选版本未在 dev 验证过时，应被拒绝。
- **全程**：当任意部署动作发生时，审计日志 `operator` 应可追溯到具体来源（`ci:<workflow>` / 用户 / MCP ownerId），不得为 `anonymous`/`unknown`。

---

## 九、建议的下一步

1. 先做 **P0**（1～2 天）：`ci.yml` + `release.yml` + 触发端点，立刻消除"人肉点发布"。
2. P0 稳定一周后做 **P1**：制品化，把构建从开发者机器搬走。
3. **P2-4（下线旧发布中心）可在 P0 后立刻做**，与主线无依赖，直接减少"两个入口"的困惑。

> 本方案不改动发布平台的既有语义与决策；凡与 `specs/release-platform/design.md` 冲突处，以该文件为准并回改本文。
