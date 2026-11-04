# web_system 文档总索引（按问句 → 真源）

> **定位**：本仓库 **257 份活跃 md**（docs 141 + specs 112 + 根 2 + wiki 2，2026-11-04 删桩后实测；80 份史料另存 `archive/`）的**唯一「分」入口**。
> 只放「去哪找」，**不放数值、不放命令全文**。
> 数值与事实以最后一跳的真源为准；本表与真源冲突时，一律以真源为准。
> 维护日期 2026-11-04 · 对应治理任务 `30-任务产物/2026-11-04-web_system文档治理/`

---

## 0 三层跳（AI 检索纪律）

```
问句 ──① 查本表 ──② 打开唯一真源 ──③ 真源内部再进分册
```

- **先查本表再检索**：不要一上来全仓 grep（会命中历史快照，得出过时结论）。
- 🔴 **事实检索必须排除 `archive/`**：80 份历史快照的正文已物理移到 `archive/docs-history/`，
  原位置指针桩已于 2026-11-04 删除（活跃区零副本）。全仓 grep 一律带 `--exclude-dir=archive`；`archive/` 内的旧口径**不是当前事实**。
- **入口层不复制数值**：`CODEBUDDY.md` / `README.md` / `.workbuddy/memory/MEMORY.md` 只放指针；
  端口、路径、命令一旦在入口层出现第二份，就会漂移（本次治理的根因）。
- **在无作废声明的正文里命中下列字样即判定为历史快照**：`PORT=3000`、`apps/admin-web`、
  `pm2 restart all --update-env`、`POST /api/pipelines`（agent 自签 JWT）、`deploy-dev.sh`、
  `scp` 手工部署、`DB_DATABASE=web_system`。这些**不是当前事实**，不得据此动手。
  > 例外：本文 / `README.md` §7.1 出现这些字样是**作废声明与识别规则**
  > （行内代码或表格对照），属正常，不表示文件本身是快照。判据看**有没有作废声明**，
  > 不是看字面上有没有旧值 —— 否则门禁会把「故意留的反例」判成违规（假红）。

---

## 1 按问句路由（主表）

| 你要问的 | 唯一真源 | 路径 / 命令 |
|---|---|---|
| **怎么发布 / 上线 / 让代码在 dev·prod 生效** | `web-system-deploy` skill | `~/skills/web-system-deploy/SKILL.md`（§怎么选调用方式）；🔴 **后端 10 服务与前端 `admin`/`portal` 都走同一 MCP 流水线**（2026-11-04 订正）：后端推荐 `publish.sh`（封装 prod 闸门），前端常用 tools/call，`deploy-console` 自身永远手动；预演 `bash ~/skills/web-system-deploy/scripts/publish.sh plan dev <svc>` |
| **开发维护知识库全貌 / 怎么保证 AI 不跑偏** | 知识库拓扑总图 | [`知识库拓扑.md`](./知识库拓扑.md)（五层载体 / 注入链 / 门禁 / 禁止路径 / 冲突优先级 / 已知缺口）；图片版 `architecture/知识库拓扑.svg`，由 `scripts/gen-kb-topology.mjs` 生成，**禁手改 SVG** |
| 回滚 / 灰度 / 查线上版本 / 发布后验证 | 同上 | `publish.sh rollback\|status <svc>`；判据只看 `verify_release` 的 `verdict` |
| 发布通道为什么这么分 / 平台侧语义 | 工程总入口 | `README.md` §7.1 |
| **架构与部署现状总览** | 系统平台架构与部署总览 | [`architecture/system-overview.md`](./architecture/system-overview.md) |
| 架构图 / 流程图（生成物） | 同上 §图示入口 | `architecture/*-diagrams.html`；**改图改脚本重跑，禁手改 SVG/HTML** |
| 端口 / 服务清单 / pm2 进程名 | 工程总入口 | `README.md` §5；完整三环境矩阵见 `architecture/system-overview.md` §3 |
| 目录结构 / 产品矩阵 / 技术栈 | 工程总入口 | `README.md` §1 §2 §3 §6 |
| 环境变量怎么配 / 有哪些变量 | 工程总入口 + 变量清单 | `README.md` §4.5；[`development/dev-env-config-inventory.md`](./development/dev-env-config-inventory.md) |
| 数据库是哪个库 / dev·prod 区别 | 协作指令速查 §4 工程红线 | [`协作指令速查.md`](./协作指令速查.md)；代码与配置为准 |
| 数据库迁移怎么跑 | `apply-migrations.sh` | `bash scripts/apply-migrations.sh dev\|prod\|local`（`DRY_RUN=1` 预演）；说明见 [`development-guide.md`](./development-guide.md) |
| 本地起服务 / 验证 / 换机器从零启动 | 本地开发指南 | [`development/local-dev-guide.md`](./development/local-dev-guide.md)、[`development/local-dev-setup.md`](./development/local-dev-setup.md) |
| 本地微前端产物手工更新（仅调试） | 工程总入口 | `README.md` §7.2 四步铁律（**不是线上发布入口**） |
| 小程序出码 / 预览码 / 体验版 | 小程序发布手册 | [`miniprogram/release-runbook.md`](./miniprogram/release-runbook.md) |
| **红线 / 动作门 / commit trailer** | 协作指令速查 | [`协作指令速查.md`](./协作指令速查.md) |
| UI 门 / D2 设计评审 / 原型先行 | AI 常驻总入口 | `.codebuddy/CODEBUDDY.md` §2.5；判据 `ui/design-system.md` |
| 发布评审清单（A 运行 / B 配置 / C 数据…） | 发布评审清单 | [`development/release-review-checklist.md`](./development/release-review-checklist.md) |
| 契约变更 / MCP 工具 / SSE 事件 | 接口契约 | [`api/contracts.md`](./api/contracts.md) |
| 新增对外接口评审 | 代码评审清单 | [`development/code-review-checklist.md`](./development/code-review-checklist.md) |
| CI 红线 R1–R16 / 红线扫描 | 规则与扫描器 | `.codebuddy/rules/`；`bash scripts/redline/scan-rules.sh diff <range>`（本地约 11min，须后台跑，优先看 CI 结果） |
| 质量门禁总纲 | 门禁文档 | [`development/质量门禁总纲.md`](./development/质量门禁总纲.md) |
| 脚本怎么用 / 脚本清单 | 工程总入口 + scripts 目录 | `README.md` §4；`scripts/`（按 `scripts/` 内 README 与文件头注释） |
| 健康巡检结果能否作上线判据 | ⚠️ **暂不能** | `scripts/health-check.sh`、`scripts/verify/verify-backend.sh` 的 prod 分支仍探测 3000 系，与「dev/prod 均 6000 系」冲突；**结果勿作上线判据**，核对派研发部见台账 #8436 |
| Agent / AI 子系统 / 下一步改什么 | 架构专题 | `architecture/agent-system-design.md`、`architecture/agent-evolution-roadmap.md` |
| 多 Agent 编排 / 消息清单 | 架构专题 | `architecture/multi-agent-design.md`、`architecture/agent-message-schedule.md` |
| MCP 服务间鉴权 | 架构专题 | [`architecture/MCP服务间鉴权.md`](./architecture/MCP服务间鉴权.md) |
| 事故复盘 / 排障速查 | 事故文档 | `development/事故复盘-*.md`、`development/排障速查-*.md` |
| 部署通道的**历史**设计决策 | 规格定稿 | `specs/<主题>/design.md`（**设计定稿 ≠ 已上线**，须查落地状态） |
| 流水线 / 发布平台设计与边界 | 专题文档 | [`development/deploy-pipeline-dev.md`](./development/deploy-pipeline-dev.md)、`operations/pipeline-boundary-scripts.md` |
| 文档本身怎么写 / 命名规范 | 文档约定 | `.codebuddy/rules/doc-conventions/RULE.mdc` |
| **长期记忆 / 跨会话判据** | 记忆索引（≤4KB） | `.workbuddy/memory/MEMORY.md`；全文归档 `.workbuddy/memory/topics/` |
| 发布平台设计态 / 目标态 | 设计稿 | `architecture/release-system-design.md`（**数据模型章节已过时**）、`architecture/aiops-console-target-architecture.md` |
| ~~已废弃拓扑~~ | **已删除（2026-11-04）** | `architecture/kedou-network-architecture.md` 旧正文只在 git；改看 `system-overview.md` §9 |
| 产品 / UI / 图示 / 运营专题 | 分目录 | `products/`、`ui/`、`drawing/`、`posts/`、`admin/`、`miniprogram/`、`operations/` —— 按目录名检索，含历史快照 |

> 🔴 **本表只登记「当前事实」的真源，不给存档史料建索引**。
> 问「当时为什么这么定 / 2026-09 怎么发布」属**考古**，不在路由范围：史料不承载当前事实，
> 不列路径、不给链接；只有人显式指定路径时才可追溯，AI 不得据此判断线上现状。
> 发布类问句一律走本表第 1 行（skill），**不要顺着旧手册往下找**。

---

## 2 目录职责与边界

| 目录 | 职责 | 承载当前事实？ |
|---|---|---|
| `README.md` | 工程事实总入口（结构 / 端口 / 启动 / 发布路由 / 文档地图） | ✅ 是 |
| `docs/INDEX.md`（本文） | 257 份活跃文档的路由表 | ✅ 是（只路由，不复制） |
| **`archive/docs-history/`** | **80 份历史快照正文**（2026-11-04 物理归档，按原相对路径） | ❌ **不承载当前事实**；事实检索必排除 |
| `docs/architecture/` | 架构现状总览 + 生成物图 + AI 域专题 | ✅ 是（`system-overview.md` 为准） |
| `docs/development/` `docs/api/` `docs/ui/` | 常青规范、判据清单、开发手册 | ✅ 是（标日期的 `*review*` / `*plan*` 除外） |
| `docs/协作指令速查.md` | 红线与动作门速查卡（只索引不复制数值） | ✅ 是 |
| `.codebuddy/CODEBUDDY.md` | AI 常驻加载的**规则与入口**（不含工程事实） | ✅ 是 |
| `.workbuddy/memory/MEMORY.md` | 跨会话长期记忆（≤4KB 索引式） | ✅ 是（判据 + 指针） |
| `specs/*/design.md` | 新机制的设计定稿 | ⚠️ **设计态**，不等于已落地 |
| `specs/*/tasks.md`、`docs/plans/`、`docs/reviews/` | 当时的计划 / 评审 / 验收记录 | ❌ **历史快照**：正文已移 `archive/docs-history/`，**原位置桩已删**（2026-11-04 用户拍板） |
| `.workbuddy/memory/2026-*.md` | 每日工作日志（append-only） | ❌ **历史快照**，只作考古与追溯；**不进 archive**（移走会破坏记忆注入链） |
| `.workbuddy/memory/topics/` | 长期记忆全文归档（压缩前的真源） | ⚠️ 索引指向的深水区，含历史段落，读时看章节日期 |
| `docs/operations/` | 常青运维手册 + 2026-10 验收快照 | ⚠️ 混合：带日期的验收/演练记录与 `release-pipeline.md`、`release-checklist.md` 已移 archive，原位桩已删 |
| `docs/admin/` `products/` `ui/` `drawing/` `posts/` `miniprogram/` | 产品 / UI / 图示 / 运营专题 | ⚠️ 含历史快照，数值以 `README.md` 与对应真源为准 |
| `docs/**/HANDOFF.md`、`handover-*.md`、`session-handover-*.md`（共 8 份） | 交接快照 | ❌ 正文已移 archive，原位桩已删；最新状态以 `specs/deploy-console-domain-split/progress.md` 与代码为准 |
| `docs/plans/` `docs/reviews/` `docs/development/release-reviews/` `reports/` | 计划 / 评审 / 报告快照 | ❌ 整目录正文已移 archive，原位桩已删 |
| `specs/**/design.md`（41 份）、`api-design.md`（16 份） | 设计定稿 | ⚠️ **设计态，无「已落地/未落地」状态戳**；属规格不是史料，**不进 archive**；不得当线上现状 |
| `wiki/` `raw/` | 外部素材原文与编译知识（README §资产构成） | 与工程事实无关；`wiki/index.md` 已补边界指针（2026-11-04） |
| ~~`architecture/kedou-network-architecture.md`~~ | **已删除（2026-11-04）** | ❌ 旧正文只在 git；勿引用、勿建链接；改看 `system-overview.md` §9 |
| ~~`DEPLOYMENT.md`~~ | **已删除（2026-11-04）** | ❌ 旧正文只在 git `84667dee`；不得引用、不得建链接 |
| `SECURITY.md` | 安全披露 | ✅ 是（2026-11-04 由未填写的默认模板补齐） |

---

## 3 冲突时以谁为准（优先级从高到低）

1. **运行时事实**：代码、配置、`ecosystem.*.cjs`、数据库实况（实测 > 文档）
2. **能力入口**：`~/skills/web-system-deploy/SKILL.md`（发布类问题）
3. **工程事实**：`README.md` → `docs/architecture/system-overview.md`
4. **专题规范**：`docs/development/**`、`docs/api/**`、判据清单
5. **设计定稿**：`specs/*/design.md`（须核对是否已落地）
6. **历史快照**：`archive/docs-history/**`、日志 —— **仅用于解释「当时为什么」，不用于「现在是什么」**

> 🔴 同一主题出现互斥结论时，**必须有一行显式覆盖声明**（写在新结论旁），
> 不能指望读者读到后面那条。2026-11-04 的事故就是旧条目排在 §2、订正排在 §11 导致的。

---

## 4 准入与维护（防再次膨胀）

- **新建任何 md**：必须在本表 §1 登记一行「问句 → 真源」，否则视为未入库。
- **废弃文档分两类，活跃区一律不留副本**（2026-11-04 用户两次拍板）：① 有史料价值 → 正文逐字节进 `archive/docs-history/`，**原位桩已删除**（80 份，见下条）；② 无史料价值、纯为防断链的废弃入口文件（`DEPLOYMENT.md`、`kedou-network-architecture.md`）→ **直接删除文件**，同步清理全部活跃引用，旧正文只在 git。
- **史料一律进 `archive/docs-history/`**：判据 = `docs/INDEX.md` §2 标 ❌ 的目录/命名模式
  （plans / reviews / release-reviews / 带日期验收 / `*review*` / `*todo*` / `*handover*` / `tasks.md` / HANDOFF）。
  流程固定两步：① 改前全文备份 → ② 正文 `cp -p` 进 archive（**不改写**，保留史料原貌），**原位置直接删除**。
  🔴 删桩后 48 处历史链接失效属预期后果，清单见 `30-任务产物/2026-11-04-web_system文档治理/史料桩删除后断链清单.txt`，交人复核；入口层不在此清单内，AI 当前事实路由不受影响。
  `specs/*/design.md` 是规格不是史料，不在此列；`.workbuddy/memory/2026-*.md` 属记忆系统，也不移。
- **入口层禁出现「第二份」数值**：工程事实**唯一收口** `README.md`（其 §5 端口表、§4.5 env 示例、§7.2 命令是**授权真源**）；
  `CODEBUDDY.md` / `MEMORY.md` / 本表出现**同样的**数值或命令全文才算违规（会漂移）。
  判据是「同一事实有没有第二份」，不是「入口层有没有数值」。
- **记忆层上限**：`.workbuddy/memory/MEMORY.md` ≤ 4KB；超出时按「先写真源、再改索引」压缩，
  并按《记忆索引化验收规范》做**问句反查 + 跨注入域覆盖**验收，不能只验文件存在。
- **压缩验收**：按高频问句逐条反查（怎么发布 / 怎么回滚 / 怎么验真机 / 端口多少），
  每条要能在两处注入通道都命中指针。

---

## 5 本次治理（2026-11-04）

起因：记忆压缩后 AI 找不到发布入口，转而 reverse-engineer 出自签 JWT 打 `/api/pipelines`（403），
根因是「能力入口没进任何注入通道」+「废弃文档正文未删 + 入口层仍教旧通道」。

处置：`README.md` §7.1 改为按模块路由并加禁自签 JWT 红线；§9 收口到本表（数字按 208/125 实测校正）；
> 🔴 10:20 订正：上句「按模块路由」是**当时动作的历史记录**，不是当前口径。用户拍板「后端 / 前端都支持 MCP，
> console 手动发布」后，§7.1 与 §9 已改为「统一 MCP 通道；A / B 是调用方式不是模块二分」，以 L34 为准。
`DEPLOYMENT.md` 320 行与 `kedou-network-architecture.md` 过时正文移除改纯指针（备份与 git 可恢复）；
> 🔴 10:57 订正：上句「改纯指针」是**当时动作的历史记录**。`DEPLOYMENT.md` 已于 2026-11-04 由用户拍板**删除**（备份见治理 `backup/`，git `84667dee` 可恢复），活跃区引用已同步清理；当前处置以 §4 两类规则为准。
> 🔴 11:28 订正：`kedou-network-architecture.md` 同样**已删除**；80 份原位桩也已由用户拍板删除。当前活跃区无任何空壳指针/桩。
长期记忆 `MEMORY.md` 26735B → **3971B** 索引化，全文先逐字节落 `topics/` 再压缩；
活跃手册 `local-dev-guide.md`「prod 走 3000 系」、`local-release-runbook.md` / `development-guide.md` 的
`POST /api/pipelines` 示例加显式覆盖声明；`deploy-dev.sh` 补 DEPRECATED 头；
`package.json` 三个 `pub:*` 旧通道入口改指向 skill；5 个零引用死脚本移出仓库（已备份）；
历史快照目录（8 份交接文档、operations/plans/reviews、specs 设计态）统一收编进 §2 边界表；
修复 `prod-release-plan.md` 三处断链、`SECURITY.md` 未填写模板、`wiki/` 空壳。

> ⚠️ **历史快照里的 60+ 行旧口径不逐条改写** —— 它们是当时的评审/迁移记录，改了反而破坏史料；
> 治理手段是「标注边界 + 入口层零残留 + 验收命令」，不是全文替换。

## 6 续：史料物理归档（2026-11-04 09:45，用户拍板）

用户要求「史料放到存档目录」—— 上面 §2 只靠**声明**隔离不够：快照与真源同目录同级混放，
全仓 grep 必然捞到旧事实。本轮改为**物理隔离**：

- **80 份 / 915173 B** 史料正文移入 `archive/docs-history/`（保持原相对路径，逐字节未改动，
  改前全文备份在 `30-任务产物/2026-11-04-web_system文档治理/backup/史料归档前/`）；
- 原位置当时覆盖为**纯指针桩**（80 份，含「已归档 / 不承载当前事实 / 去哪找真源」），80 条链接逐条验通；🔴 **11:28 订正**：桩已由用户拍板全部删除，本句为当时动作的历史记录，当前判据见 §4 与《记忆索引化验收规范》R6。
- `docs/` `specs/` 的常青真源（41 份 `design.md`、判据清单、本地开发手册、事故排障速查）**一律不动**；
- 事实检索判据升级：`grep -R --exclude-dir=archive`（已写入 §0、§3 与《记忆索引化验收规范》§5）。

> 归档后非 archive 区仍含旧口径的 4 份活跃文档（`architecture/技术架构.md`、
> `architecture/micro-frontend-technical-design.md`、`development/whistle-local-dev.md`、`admin-dev.md`）
> 属**待订正**，不是史料；本轮已补**顶部显式覆盖声明**，逐行订正派研发部（台账 #8435）。
