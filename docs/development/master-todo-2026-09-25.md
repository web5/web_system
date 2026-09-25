# 全局待办总表与任务拆解（2026-09-25）

> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
> **定位**：跨文档待办的**唯一索引与拆解计划**。各主题域的详细做法仍在各自的 follow-ups / tasks 文档里，本文只做「去重编号 + 优先级 + 归属 + 推进批次」，不复制细节。
> **为什么需要这一份**：仓库现有待办散在 7 份文档里（F/T/A/B/P/C/VN 多套编号），彼此有重复与过时；没有一处能回答「现在总共有哪些事、先做哪个」。
> **数据来源**：`docs/development/{mp-account-follow-ups,miniprogram-follow-ups,dev-todo-2026-09-24,console-monitor-followups,optimization-roadmap}.md`、`specs/{kedou-ai-minigram,pipeline-node-model,pipeline-concurrency,rd-process-model}/`、`docs/ui/anchor-backlog.md`、`specs/deploy-console/backend-deploy-effect-tasks.md`。

---

## 0. 仓库快照（2026-09-25 实跑）

| 项 | 值 |
|---|---|
| HEAD / 分支 | `6b8dd86` / `master`（工作区干净，无未提交改动） |
| 本地分支 | 仅 `master`（`rd-process-model/TODO.md` C2 列的 8 个本地未合并分支**已不存在**） |
| 远端分支 | **77 个**（大量 `docs/*`、`feat/*` 未合并，治理项） |
| 被跟踪的 `package-lock.json` | **5 个**（apps/deploy-console、apps/kedou-ai-minigram、servers/deploy-console、servers/system-service、servers/todo-service） |
| 被跟踪的 `.env` | `apps/admin/.env.production`（**T0-1 未做**） |
| CI 工作流 | `auto-pr.yml` / `quality-gate.yml` / `release.yml`（**红线扫描已回归，lint 档仍关闭**——全仓无 ESLint 配置） |

---

## 1. 五条战线（工程全景）

| 战线 | 范围 | 健康度 | 待办数 |
|---|---|---|---|
| **① 小程序应用侧** | `apps/kedou-ai-minigram` | 骨架与意图路由已落码，**验收未取证**；M3 之后未动 | 13 |
| **② 小程序账号能力** | 退出/绑定/合并/邮件/密钥治理 | 代码已合**（PR #182）**，**验证全未做** | 13 |
| **③ dev/prod 基础设施** | 服务上线、凭据、迁移、SSH、.env 同步 | 多个环境事实缺凭据而卡住 | 10 |
| **④ 发布平台** | deploy-console 流水线、部署生效、监控页 | 远程部署生效**从未真机跑过**；并发线零落地 | 21 |
| **⑤ 工程治理 / 仓库卫生** | 红线门禁、评审角色、UI 锚点、lockfile | 机制已建成，**处于观察期** | 16 |

---

## 2. 待办总表（去重后统一编号）

> 编号规则：`战线号-序号`。「拍板」= 必须你决策，否则无法开工。
> 工作量：S ≤ 1h ｜ M ≈ 半天 ｜ L ≥ 1 天

### ① 小程序应用侧（源：`specs/kedou-ai-minigram/tasks.md`）

| # | 事项 | 状态 | 归属 | 量 |
|---|---|---|---|---|
| 1-1 | 批次 1/2/5(T5.1–T5.6) **已落码但 V1–V10 未取证**（含 V2 色值偏差：`#C2410C` vs 实际 `#EA580C`） | ⬜ | 研发 | M |
| 1-2 | **T3.1** 合同评估上传/进度接真（`ocr-api` + 真 SSE 进度） | ⬜ | 研发 | L |
| 1-3 | **T3.2** `assess/result` 渲染真实 `ContractReport`（替硬编码） | ⬜ | 研发 | M |
| 1-4 | **T3.3** 双链路收口：`contract/chat` 并入 `assess/result`，`pages/contract/*` 停止演进 | ⬜ | 研发 | M |
| 1-5 | **T4.1** migration 补 `agent_definitions.entry` | ⬜ | 研发 | S |
| 1-6 | **T4.2** C 端只读 `GET /ai/agents`（**字段白名单，绝不返回 systemPrompt**） | ⬜ | 研发 | M |
| 1-7 | **T4.3** 发现页改数据驱动（现写死两张卡） | ⬜ | 研发 | M |
| 1-8 | **T5.7** 前端 `conversationId` 每轮回传（P0 硬约束）+ intent 徽标 | ⬜ | 研发 | M |
| 1-9 | **T5.0①** 定星座/时运**合规口径**（prompt 内置免责声明） | ⛔ **拍板** | 你 | S |
| 1-10 | **T5.0②** 后台配齐 6 个 agent（emotion/baike/horoscope/translate/tool/general）并 publish | ⛔ 依赖 1-9 | 运维 | M |
| 1-11 | 批次 5 的 7 条验收逐条取证（首事件为 intent / 锁定不重分类 / `agent_log.agent_id` 非 auto / P95<400ms 等） | ⬜ | 研发 | M |
| 1-12 | **批次 6** legacy 页面清理（28 → ~12 页，`CanvasEngine*`/`Brush.ts` 连带评估） | ⬜ 依赖 1-4 | 研发 | L |
| 1-13 | **V13** 对话页隐藏 tabBar 后「发现/我的」补偿入口方案 + `tsconfig.json` 修正 + V2 色值对账 | ⛔ **拍板** | 你 | S |

> `agent-translate.sql` 在**其它环境**（dev/prod）执行 —— 归入战线③ · 运维。

### ② 小程序账号能力（源：`docs/development/mp-account-follow-ups.md`，PR #182）

| # | 事项 | 状态 | 归属 | 量 |
|---|---|---|---|---|
| 2-1 | **F1** 本地发布验证（切换 release 目录 + 构建 shared + 四连冒烟） | ⬜ 阻塞 2-2/2-3 | 研发 | M |
| 2-2 | **F3** 合并链路**双账号实测**（13 表迁移 + 3 张唯一键去重 + 凭证重签） | ⬜ 依赖 2-1 | 研发 | L |
| 2-3 | **F2** 真机全流程验证（退出→登录墙→绑手机号→合并→绑邮箱） | ⬜ 依赖 2-1 | 研发 | M |
| 2-4 | **F4** 控制台登记 `INTERNAL_API_KEY`（dev/prod **不同值**，`is_secret=1`） | ⬜ 无前置 | 运维 | S |
| 2-5 | **F5** `fetch-config.sh` 挂到流水线 restart 阶段（**数据变更**） | ⬜ | 运维 | M |
| 2-6 | **F14** `prod.env` 的 `MINI_PROGRAM_SECRET` 与 `OFFICIAL_ACCOUNT_SECRET` **同值疑似填错** | ⬜ **上线前必查** | 你/运维 | S |
| 2-7 | **F7** 小程序 request 合法域名登记 `dev.kedouai.com` | ⬜ 上线前 | 运营 | S |
| 2-8 | **F6** 手机号资源包额度确认/补购（1000 次体验额度三端共用） | ⬜ | 运营 | S |
| 2-9 | **F8** 协议页文案回填 + 生效日期（现为占位） | ⬜ | 运营+法务 | M |
| 2-10 | **F15** internal 调用失败错误细分（未配置/不匹配/对端未配置） | ⬜ **建议 F1 前做** | 研发 | S |
| 2-11 | **F19** 退出未清缓存键（`conv_detail_*`、`LIST_CACHE`、`RESUME_CONV_KEY`、`kd_translate_params`） | ⬜ | 研发 | S |
| 2-12 | **F9–F13** 五项待拍板（退出细节 / 绑定唯一性 / 是否上 unionid / 注销账号 / 发版批次） | ⛔ **拍板** | 你 | S |
| 2-13 | F16 admin 其它假实现排查 · F17 env_config README 漂移 · F18 展示层存量假数据 · **F20 各服务 `.env` 同步脚本缺失**（根因） | ⬜ | 研发/运维 | M |

### ③ dev/prod 基础设施（源：`docs/development/dev-todo-2026-09-24.md` + handover）

| # | 事项 | 状态 | 归属 | 量 |
|---|---|---|---|---|
| 3-1 | **A1** prod `upload-service` 上线（**卡住 A8 上 prod**；缺 PORT/INTERNAL_API_KEY/JWT_SECRET/存储根） | ⛔ **需你给值** | 你+运维 | M |
| 3-2 | **A2** nginx/边缘机 `42.194.200.69` 主机登记（缺 SSH 用户/密钥/根目录） | ⛔ **需你给凭据** | 你+运维 | S |
| 3-3 | **A3** 迁移待定 3 条评审（`0008`/`0010`/`0012`）→ 执行 or 记账跳过 | ⛔ **拍板** | 你 | S |
| 3-4 | **A4** prod 侧是否跑 `migrate-uploads.mjs`（dev 已跑） | ⛔ 依赖决策 | 你+运维 | S |
| 3-5 | **B1** 剩余 7 个服务接入统一认证助手（`unified-auth.ts`） | ⬜ | 研发 | L |
| 3-6 | **B2** 删 user-service 上传端点与 static serve（前置 3-4；保留 bianbian 只读兜底） | ⬜ 依赖 3-4 | 研发 | M |
| 3-7 | **B3** 回收 dev `/tmp/modules-legacy-20260924/`（108M，备份已存在） | ⬜ 观察期后 | 运维 | S |
| 3-8 | **B4** 确认 ai-service `uploads/` 残留是否并入统一根 | ⬜ | 运维 | S |
| 3-9 | **A5** `deploy_env_service_routes` 在 dev/prod 是否登记 | ⬜ | 你+运维 | S |
| 3-10 | 其它环境执行 `agent-translate.sql` + `migrations/0006`（小程序改名） | ⬜ | 运维 | S |

### ④ 发布平台（源：`specs/deploy-console/backend-deploy-effect-tasks.md`、`specs/pipeline-node-model/tasks.md`、`console-monitor-followups.md`）

| # | 事项 | 状态 | 归属 | 量 |
|---|---|---|---|---|
| 4-1 | **T1** 远端部署生效**从未真机执行**（会改 dev/prod 的 `dist` 并重启 pm2） | ⛔ **需确认变更窗口** | 你+运维 | M |
| 4-2 | **T1-V1~V4** 远端成功路径/失败回滚判据取证 + 补 mock `ssh2` 单测 | ⬜ | 研发 | M |
| 4-3 | **T3** 其余 **10 个后台模块**投递路径逐个验证（admin/mcp-gateway/ai-agent/portal/shell 已 ✅） | ⬜ | 运维 | L |
| 4-4 | **T3-kedou** `kedou-ai-minigram` 缺小程序私钥已停用；`PUBLISH_PATH` 大概率要改 | ⛔ **需私钥** | 你+运维 | S |
| 4-5 | **T2-UI** 模块详情「回滚」按钮切到 `rollback-version` 端点（**UI → 先过动作门**；文件可能已随域拆分迁移，需先定位） | ⬜ | 研发 | S |
| 4-6 | **TODO-1** dev 云库 `scope`/`managed_by` 被 DROP/重置 —— 治本 = 关 deploy-console 的 `synchronize` | ⛔ **需选方案 A/B/C** | 你+研发 | M |
| 4-7 | **0.6** dev 控制台 `.env` 写 `CONSOLE_INSTANCE=dev`（缺即启动 FATAL） | ⬜ | 运维 | S |
| 4-8 | **迁移校验** `SELECT name,scope,managed_by FROM deploy_hosts`（**两份库都要**，应用后复核） | ⬜ | 运维 | S |
| 4-9 | **3.5 / 6 / 7** 监控页诊断横幅 + 页签按 `/monitor/envs` + PM2 按主机分组 + DiagnoseCenter 同源 | ⬜ **UI → 先过动作门** | 研发 | L |
| 4-10 | §6.2 关 `synchronize` 时补 `deploy_approvals` 两列迁移 SQL | ⬜ 与 4-6 联动 | 研发 | S |
| 4-11 | §6.3-1 控制台 UI 适配 `awaiting-approval`（状态色 + 审批按钮） | ⬜ UI | 研发 | M |
| 4-12 | §6.3-2 `normalizeNodes` 强制三 platform 节点 → 纯 `shell+approval` 模板无法创建 | ⬜ | 研发 | M |
| 4-13 | §6.3-3 节点边界变更（投递+写版本合并为「发布」节点，切指针移出） | ⛔ 含 AI 验证接入时机决策 | 你+研发 | L |
| 4-14 | §1 P2 变量管理（`scope=template` 配置中心 + 管理页） | ⬜ | 研发 | L |
| 4-15 | §1 P3 前端画布 `PipelineEdit.vue` | ⬜ UI | 研发 | L |
| 4-16 | **并发发布整条线 V1–V13 + T0 快照**（`scripts/migrations/p29`、`ResourceLockService` 等**零落地**） | ⬜ | 研发 | XL |
| 4-17 | T10 runbook 补「并发期间禁止手工 `publish-*.sh`」+ 回滚两步 | ⬜ | 运维 | S |

> ⚠️ **冲突提示**：4-3（改 `PUBLISH_PATH`）与 4-16 V13（彻底删除 `PUBLISH_PATH`）矛盾 —— **先定并发改造排期，再决定 4-3 怎么改**，否则白做一轮。

### ⑤ 工程治理 / 仓库卫生（源：`specs/rd-process-model/TODO.md`、`docs/ui/anchor-backlog.md`、`optimization-roadmap.md`）

| # | 事项 | 状态 | 归属 | 量 |
|---|---|---|---|---|
| 5-1 | **A1** `rd-process-model/design.md` §4/§7 状态回填（现仍标「阻塞/待拍板」，实际全部已合，会误导接手者） | ⬜ 零风险 | 研发 | S |
| 5-2 | **A2** 四个评审门 warning 观察期数据收集（1–2 周，含 `Micro-exempt`/`UI_GATE=off` 使用频次） | 🔄 | 研发 | — |
| 5-3 | **A3** R13/R14/R15 升 error（依赖 5-2 + 存量 commit 豁免策略） | ⬜ | 你+研发 | M |
| 5-4 | **A5-1** `.mjs` 迁移不在 `apply-migrations.sh` 流程内（**真缺口**：不会被应用也不被 R13 覆盖） | ⬜ | 研发 | S |
| 5-5 | **A5-2** `feature/kedou-ai-minigram` 的 `'start'` 疑似死分支待确认 | ⬜ | 研发 | S |
| 5-6 | **A5-3** S1–S6 结构守护是否随机制回归（S7 已由 R12 承接） | ⬜ | 你+研发 | S |
| 5-7 | §7.3 SSE 事件 / MCP 工具仍未明确纳入 R13 契约面 | ⬜ | 研发 | S |
| 5-8 | **A6** `docs/posts/ai-agent-gate.md` 泛化项目名 + 补背景，对外发布 | ⬜ | 你 | M |
| 5-9 | quality-gate 的 **lint 档恢复**（全仓无 ESLint flat config，需先补最小规则集） | ⬜ | 研发 | M |
| 5-10 | **锚点回填 B1a/B1b**（deploy-console 38 + admin 26 `.vue`，可并行一个观察轮） | ⬜ | 研发 | L |
| 5-11 | 锚点回填 **B2**（portal 35）→ **B3**（小程序主包 8）→ **B4**（分包 20 + ui 2） | ⬜ 串行 | 研发 | XL |
| 5-12 | 清 5 个 `package-lock.json`（pnpm workspace 混 npm 破坏一致性） | ⬜ | 研发 | S |
| 5-13 | `apps/admin/.env.production` 移出版本库（`.gitignore` 对已跟踪文件不生效） | ⬜ | 研发 | S |
| 5-14 | **远端 77 个分支治理**（逐个判断归档/删除，**不宜批量**） | ⬜ | 你+运维 | M |
| 5-15 | T1-1 ai-service / ai-agent 的 agent 定义管理收敛到一处（两份 `agent-def-sync` 正在漂移） | ⬜ | 研发 | L |
| 5-16 | T1-3 `ecosystem.config.js` 与 `.cjs` 双文件漂移 · T1-4 docker-compose 补齐或删除 · T2-4 头像去重 | ⬜ | 研发 | M |

---

## 3. 任务拆解 · 三批次推进计划

### 批次 W1 —— 清阻塞 + 零风险的验收取证（本周）

**目标：把所有「代码已合但从没验过」的线向前推一格，同时清掉不需要任何决策的卫生项。**

| 顺序 | 任务 | 为什么先做 |
|---|---|---|
| 1 | **2-4 F4 登记密钥** + **2-8 确认资源包额度** | 零依赖零风险，可立即并行开跑 |
| 2 | **2-1 F1 本地发布验证**（先做 **2-10 F15 错误细分**，否则排查被拖慢） | 它是 2-2/2-3 的唯一前置，卡整条账号线 |
| 3 | **2-2 F3 合并链路双账号实测** | 风险最高的一块（13 表迁移 + 去重 + 重签），早测早暴露 |
| 4 | **2-3 F2 真机验证** | 依赖 2-1 通过 |
| 5 | **2-6 F14 prod.env 双 secret 同值核对** | 上线前必查，成本极低但后果高 |
| 6 | **5-1 A1 状态回填** + **5-12 清 lockfile** + **5-13 .env 移出版本库** | 半天以内的纯治理动作，消除误导与隐患 |
| 7 | **4-8 迁移校验 SQL**（两份库都跑） + **4-7 CONSOLE_INSTANCE** | 运维动作，不依赖原型，可随时插队 |
| 8 | 启动 **5-2 观察期数据收集**（不需要写码，只需要记录） | 它是 5-3 的前置，越早开始越好 |

> W1 结束时应该能回答：**小程序账号这批代码到底能不能上**。答案是「能」，才轮到 W2 里的同学 brokers 上线前置。

### 批次 W2 —— 上线前置 + 线上实操（F 之后一到两周）

| 顺序 | 任务 | 依赖 |
|---|---|---|
| 1 | **4-1 远端部署生效真机执行**（先确认变更窗口）+ **4-2 取证与单测** | 你确认窗口 |
| 2 | **4-3 其余 10 个后台模块投递路径验证** | ⚠️ 先与 4-16 的排期对齐（PUBLISH_PATH 冲突） |
| 3 | **2-7 F7 合法域名** + **2-9 F8 协议页文案** + **2-5 F5** | 上线前置三件套 |
| 4 | **3-1 A1 prod upload-service 上线** → **3-4 A4** → **3-6 B2** | 一条链，逐个放行 |
| 5 | **2-13 F20 各服务 `.env` 同步脚本**（根因修复，做完杜绝「2 个服务漏配」复发） | 无 |
| 6 | **4-6 TODO-1 治本（关 synchronize）** + **4-10 补迁移 SQL** | ⛔ 需你选 A/B/C |

### 批次 W3 —— 产品纵深与平台能力（稳定后）

| 顺序 | 任务 | 说明 |
|---|---|---|
| 1 | **1-2~1-4** 合同评估链路接真 + 双链路收口 | 依赖 ≤ 无后端阻塞 |
| 2 | **1-5~1-8、1-11** 发现页数据驱动 + 批次 5 验收取证 | 依赖 **1-9 合规口径**（硬前置） |
| 3 | **1-12 批次 6 legacy 清理** | 依赖 1-4 |
| 4 | **4-5 / 4-9 / 4-11 / 4-15** 四个 deploy-console UI 批次 | 每批都要独立过 UI 动作门，建议合并一次过门 |
| 5 | **5-10 / 5-11 锚点回填** B1a→B1b→B2→B3→B4 | 按已拍板的批次顺序，先 warn 观察一轮再升 strict |
| 6 | **4-16 并发发布**（XL，独立立项） | 依赖 4-17 runbook 先行 |
| 7 | **5-15 ai 服务收敛** · **5-16 配置与素材治理** | 长期技术债 |

---

## 4. 需要你拍板的清单（不拍就动不了）

| # | 待拍板项 | 出处 | 影响面 |
|---|---|---|---|
| D1 | F9–F13 五项（退出细节 / 绑定唯一性口径 / 是否上 unionid / 注销账号 / 发版批次） | 2-12 | 账号上线范围 |
| D2 | 批次 5 的 **合规口径**（星座/时运）+ 6 个 agent 由谁写 prompt | 1-9 | 卡发现页与翻译链路 |
| D3 | V13 隐藏 tabBar 后的补偿入口 + `tsconfig` 修正 + V2 色值对账 | 1-13 | 小程序交互一致性 |
| D4 | A1 prod upload-service 的 PORT/密钥/存储根 | 3-1 | 卡 A8 上 prod |
| D5 | A2 边缘机 `42.194.200.69` 的 SSH 凭据 | 3-2 | 卡 nginx 主机登记 |
| D6 | A3 三条迁移（执行 or 记账跳过）+ A4 prod 是否跑上传迁移 | 3-3/3-4 | 数据面，错记不可逆 |
| D7 | 远端部署生效的**真机变更窗口** | 4-1 | 影响线上 |
| D8 | 小程序发布私钥是否提供 / `PUBLISH_PATH` 怎么改 | 4-4 | 卡小程序发布链路 |
| D9 | deploy-console `synchronize` 处置 A/B/C | 4-6 | 结构性风险，选 A 才治本 |
| D10 | 节点边界变更与 AI 验证接入时机 | 4-13 | 流水线形态 |
| D11 | R13/R14/R15 是否升 error + 存量豁免策略；S1–S6 是否补 | 5-3/5-6 | 门禁强度 |
| D12 | 77 个远端分支的归档口径 | 5-14 | 仓库治理 |

---

## 5. 文档自身的债（建议随 W1 一并处理）

| 问题 | 文件 |
|---|---|
| 复选框大规模陈旧：批次 1/2/5 已落码但全为 `- [ ]`；§0「seed 只有 5 个 agent」已被实测更正（实际 7 个） | `specs/kedou-ai-minigram/tasks.md` |
| design §7 的 §7.2 Q2/Q5、§7.3 待办实际已执行完，未结案回填 | `specs/rd-process-model/design.md` |
| §8 待确认 Q3/Q4/Q6/Q8/Q9/Q10 已在 design §10 全部决策，requirements 未回填 | `specs/pipeline-concurrency/requirements.md` |
| 前端文件路径 `views/ModuleDetail.vue` 在仓库已不命中（疑随域拆分迁移） | `specs/deploy-console/backend-deploy-effect-tasks.md` |
| §6「后续」三项已被 P1-handoff + backend-deploy-effect 取代，属纯指针 | `specs/pipeline-node-model/tasks.md` |
| P0 中 T0-3（CI）已建成、**T0-1/T0-4 仍未做**；端口/服务数等描述与现状不符 | `docs/development/optimization-roadmap.md`（2026-08-28） |

---

## 6. 关联索引

| 主题域详情 | 入口 |
|---|---|
| 小程序账号能力 | `docs/development/mp-account-follow-ups.md` |
| 小程序应用侧 | `specs/kedou-ai-minigram/tasks.md`、`docs/development/miniprogram-follow-ups.md` |
| dev/prod 基础设施 | `docs/development/dev-todo-2026-09-24.md` |
| 发布平台 / 部署生效 | `specs/deploy-console/backend-deploy-effect-tasks.md` |
| 服务监控治理 | `docs/development/console-monitor-followups.md` |
| 工程门禁机制 | `specs/rd-process-model/TODO.md` |
| UI 锚点回填 | `docs/ui/anchor-backlog.md` |
</content>
</invoke>
