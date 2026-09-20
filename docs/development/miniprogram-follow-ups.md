# 小程序两条线 · 待办与跟进清单

> **来源**：2026-09-17 ~ 09-20 的 AI 协作会话（小程序更名 → 应用侧规划梳理 → 平台侧方案评审）
> **用途**：把会话里的**未决事项与后续动作**集中成一处，逐项跟进；**结论性内容不在本文重复**，只给入口。
> **维护约定**：每完成一项就更新「状态」列并追加变更日志一行；**不要**把已完成内容从表中删除（保留决策轨迹）。
> **状态快照**：2026-09-20

| 项 | 值 |
|---|---|
| 分支 | `feature/kedou-ai-minigram`（本地/远端仍在；相对 master **5 behind / 8 ahead** —— 领先数是 squash 合并造成的假象） |
| PR | **#87 已合并（2026-09-20）**，标题仍只写「三 Tab 骨架方案」，但合并时的分支内容已全部进 master |
| master | `76fd02a`（#103 deploy-console 双域重构收尾…） |
| 已进 master 的产出 | `specs/mp-platform/{design,api-design}.md`、`apps/kedou-ai-minigram/docs/产品规划分析与实现方案-梳理.md`、`migrations/0006_*.sql`、`scripts/modules.json`（key/type=mini-app）、改名遗留全量同步、`coding-best-practices` 第八节 |

---

## 0. 待办总表（一页速览）

| # | 事项 | 状态 | 阻塞 | 归属 |
|---|---|---|---|---|
| **T1** | 执行 `migrations/0006`（小程序模块 key/type 改名） | ⬜ 未执行 | 需你批准 + DB 凭据 | 运维 |
| **T2** | mp-platform M0 源码去向（A 导出 / B 按文档重写） | ⬜ 二选一未定 | **找不到源码**（见 §2.1） | 你拍板 |
| **T3** | 应用侧 5 项产品拍板（tabBar/翻译链路/主题/双份合同页/6 个 agent+合规） | ⬜ 未定 | 需你决策 | 你 |
| **T4** | 应用侧 M0 骨架收口（前端，无后端依赖） | ⬜ 未开工 | T3 的 3 个子项 | 研发 |
| **T5** | mp-platform 4+3 条待确认（M0 并入方式、加密工具落点、库名、分页/二维码/异步提审） | ⬜ 未定 | 部分依赖 T2 | 你 + 研发 |
| **T6** | RAG 语料重灌（改名后 `scripts/self-knowledge/out/dev-guide.md` 已变，库内仍是旧文本） | ⬜ 未做 | 低优先，做完改名收尾更干净 | 研发 |
| **T7** | 分支收尾：合并后新工作从 master 拉分支；`feature/kedou-ai-minigram` 可归档/删除 | ⬜ 未做 | 无 | 你 |
| **T8** | 独立一期：小程序 legacy 页面清理（28 页中 16 页与定位无关） | ⬜ 未排期 | 需评估 `utils/CanvasEngine*`、`Brush.ts` 连带 | 研发 |

---

## 1. 小程序应用侧（`apps/kedou-ai-minigram`）

**规划与分期入口（不重复）**：`apps/kedou-ai-minigram/docs/产品规划分析与实现方案-梳理.md`

### 1.1 待你拍板（5 项，T3）

| # | 问题 | 影响 | 文档给的倾向 |
|---|---|---|---|
| Q1 | tabBar 是否按原型改成 **对话 / 发现 / 我的**（现为 翻译 / 合同评估 / 我的） | 决定 M0 成立与否 | 按原型改，翻译/评估降级为发现页能力卡 |
| Q2 | 翻译链路：**复用 `agent/run`** vs 新增 `/api/translate` | M1 路线 | 复用 `agent/run`（少一套接口与链路） |
| Q3 | 主题：`app.wxss` 已是暗色橙，`app.json` 导航仍是蓝 `#1E6FFF`、未声明 `darkmode` | 全站视觉 | 先定模式，否则暗色原型图标「未来态」 |
| Q4 | `pages/contract/*`（8 页）与 `pages/assess/*`（3 页）保留哪一套 | M2 范围 | 留 assess，contract 仅保留 chat 能力 |
| Q5 | 6 个 agent 的 prompt 谁写；**星座时运合规口径** | M4 硬前置 | 先定合规，prompt 内置免责声明 |

### 1.2 已知的三个断点（开工前先对齐预期：是"接真"不是"新建"）

1. 骨架未按原型收敛（tabBar / 导航主题 / 首页形态）；
2. 翻译链路空实现（`pages/translate/index/index.ts` 的 `const res = null`）；
3. 后端意图路由**零行代码**（`agent_definitions` 无展示列、无 C 端清单接口、`agent_conversations` 无 `agent_id`、seed 里也没有路由要的 6 个 agent）。

> M0–M4 的分期、改动文件、验收判据见梳理文档 §5，此处不再展开。

---

## 2. 小程序研发管理平台（mp-platform）

**设计与契约入口**：`specs/mp-platform/design.md`（6 项决策 D1–D7）＋ `specs/mp-platform/api-design.md`

### 2.1 T2 · M0 源码去向（当前最大阻塞）

文档声称 M0 已完成（配套资产 `/workspace/mp-platform`，"构建与加解密验证已通过"），但**该目录在下列位置均不存在**（2026-09-17 实测）：

| 位置 | 结果 |
|---|---|
| 本机 | 无 `/workspace`；全盘 4 层搜索只有 `specs/mp-platform`（文档） |
| Cloud Studio 沙箱 | 账号下 0 个部署 |
| kedou-dev `175.27.189.123` | `/workspace` 只有 `daily-paper` |
| kedou-prod `106.52.176.246` | `/workspace` 为空 |
| 堡垒机 `101.43.117.234` | 无密钥权限 |

**两条路（择一）**：

- **A 导出原码**：在那个会话的文件面板里把 `/workspace/mp-platform` 导出 zip → 拖进工作区。→ 我做代码审查 → 并入 `servers/mp-platform`（改造 package.json/tsconfig 接 `file:../../packages/shared`、补 `.env.example`、ecosystem 端口 6100、模块与库登记）→ 接 CI → 出「文档声称 vs 代码实际」对账。
- **B 按文档重写 M0**（AI 倾向此项）：范围 = 5 个实现文件（`crypto.service` / `ticket.service` / `component-token.service` / `authorizer.service` / `event.controller`）+ 7 张表 DDL + `verify:crypto` 边界测试。收益：在仓、可 review、可上 CI，消除"影子资产"；代价：原"已实测通过"结论作废，需重跑验证。

### 2.2 T5 · 待确认（4 + 3 条）

| 来源 | 问题 | 建议 |
|---|---|---|
| design §7-Q1 | M0 源码如何并入（搬目录 / 重新初始化 / cherry-pick） | 整目录搬入 + 全量代码审查 |
| design §7-Q2 | 字段级加密工具落在哪 | 随 `packages/platform-kit` 抽（与审计/通知同处），别塞 shared |
| design §7-Q3 | 是否需要「人工放行提审」审批关卡（复用 console `approval`） | 一期不设；有外部协作方再加 |
| design §7-Q4 | 库名 `mp_platform` vs `web_system_mp` | M0 已建库则不动，否则同族命名 |
| api §7-Q1 | `GET /pipelines/:id/qrcode` 返回 `image/png` 还是 `{url}` | M1 前定死 |
| api §7-Q2 | 列表响应 `{items,total,page,pageSize}` vs 裸数组 | 同上 |
| api §7-Q3 | 提审类接口单次超时（微信偶发 >30s）是否改「异步任务 + 轮询步骤」 | 同上 |

### 2.3 已定的关键决策（回顾用，勿再讨论）

D1 并入 monorepo（`servers/mp-platform` + `apps/mp-admin` 微前端子模块）· D2 审计/告警/通知复用（**各写各库**，微信提审 ≠ 平台审批）· D3 不引入 `tenant_id`（内部业务线平台，`mp_app.owner` 占位）· D4 不新增 `mp:*` 权限域（复用 IAM `system=deploy`）· D5 密钥统一各服务 `.env` · D6 前端走微前端子模块 · D7 自有小程序发布复用 M4。

---

## 3. 仓库 / 改名遗留（T1、T6）

| # | 事项 | 具体动作 |
|---|---|---|
| T1 | 执行模块改名迁移 | 目标库 **`web_system_deploy`**（dev 与堡垒机共用同一云实例）：`mysqldump` 备份 → `mysql -u <user> -p web_system_deploy < migrations/0006_rename_mini_contract_to_kedou_ai_minigram.sql` → 复核校验 SQL（文件末尾注释）→ restart `web-deploy-console` + `web-gateway` 清缓存 |
| T6 | RAG 语料重灌 | 改名改了 `scripts/self-knowledge/out/dev-guide.md`，但库内 chunks 仍是旧文本（ingest 按 checksum 幂等，**不会自动重试**）：先 `DELETE FROM web_system_knowledge.knowledge_docs;` 再 `node scripts/self-knowledge/load.mjs`，验证 `ok(ready, chunks=N)` |

**注意（不要误改的历史件）**：`migrations/0005_*.sql`、`scripts/migrations/p5-pipeline-shell-approval-3env.mjs` 里的 `mini-contract` 是历史记录，保持原样；模块**类型枚举** `mini-app`（`common/dto.ts`、`deploy-module.entity.ts`、`deploy-module-stage-command.entity.ts` 的 `DEFAULT_BUILD_TEMPLATE` 键名）是既有契约，也不要改。

---

## 4. 已完成清单（对照，避免重复劳动）

| 完成项 | 落地位置 |
|---|---|
| 小程序更名 `mini-contract` → `kedou-ai-minigram` + 三 Tab 骨架页 | commit `c10f2af`（已进 master） |
| 改名遗留全量同步（rush.json / modules.json / .gitignore / pnpm-lock / CI / 30+ 文档 / 4 个截图脚本去本机绝对路径） | commit `cb30802` |
| 应用侧现状实测 + 6 处文档纠错 + M0–M4 分期 | `apps/kedou-ai-minigram/docs/产品规划分析与实现方案-梳理.md` |
| mp-platform 设计稿 + 接口契约（6 项决策固化） | `specs/mp-platform/{design,api-design}.md` |
| 错值修正：`DEFAULT_BUILD_TEMPLATE['mini-app']` → `node scripts/upload.js`；模块 `type` → `mini-app` | 已进 master |
| 工程铁律沉淀：TypeORM 1.x `CURRENT_TIMESTAMP(6)` 冲突 / `SnakeNamingStrategy` / DDL 不指定 COLLATE / 凭证字段级加密 | `.codebuddy/references/coding-best-practices.md` §八 |

---

## 5. 下一步建议顺序

1. **T2 定去向**（A 导出还是 B 重写）—— 它卡着 mp-platform 全线的 P0 前置；
2. **T3 拍板 Q1/Q2/Q3** —— 拍完即可开 **T4**（前端骨架收口，不需要后端）；
3. **T1 执行迁移**（5 分钟的事，批准即可，顺手把改名彻底收尾）；
4. T6 / T7 / T8 按余力排。

---

## 变更日志

| 日期 | 变更 |
|---|---|
| 2026-09-20 | 初版：从 09-17~09-20 会话沉淀 8 项待办（T1–T8）、mp-platform 决策与待确认清单、M0 源码排查结论、已完成对照表 |
