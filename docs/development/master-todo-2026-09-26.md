# 全局待办总表与优先级重排（2026-09-26）

> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
> **定位**：取代 `master-todo-2026-09-25.md`，成为跨文档待办的**唯一索引**。本文在 09-25 版基础上做了三件事：
> ① 把 2026-09-26 本轮**已落地的实现**入账（§0）；② **修正 09-25 版里被实测推翻的环境事实**（§1）；③ 按「线上可用性 → 下一次发布不再翻车 → 数据面 → 平台能力 → 产品纵深 → 治理」重排**全部任务的优先级**（§2）。
> **数据来源**：`docs/development/{master-todo-2026-09-25,mp-account-follow-ups,miniprogram-follow-ups,dev-todo-2026-09-24,console-monitor-followups,optimization-roadmap,a1-prod-git-migration-2026-09-26,a3-dev-sync-2026-09-26}.md`、`specs/{kedou-ai-minigram,pipeline-node-model,pipeline-concurrency,rd-process-model}/`、`specs/deploy-console/backend-deploy-effect-tasks.md`、`docs/ui/anchor-backlog.md`、2026-09-26 全天 SSH 实测。

---

## 0. 本轮已落地实现（2026-09-26，prod/dev 实测）

> 这一节是「今天到底做成了什么」的台账。原待办编号列用于回溯 09-25 版。

| # | 实现 | 落地内容 | 证据 | 原编号 | 状态 |
|---|---|---|---|---|---|
| I1 | **prod 转 git 仓库** | `/data/web_system_git`（clone 自 GitHub public），全量切换运行目录；旧 `/data/web_system` 完整保留作回退 | `git pull --ff-only` 端到端两次通过，tracked 脏 = 0，HEAD `d9889ff` | ③-A1 / 新增 | ✅ |
| I2 | **静态资源外置** | prod 静态根 `/data/web_system_static/public`，`STATIC_PUBLIC_ROOT` 写入**根 `.env.production`**（ecosystem 注入） | 仓库内 `98f29b6` 命中、外置 `d9889ff` 命中；`git pull` 不再受构建产物阻塞 | 新增（A1-L1） | ✅ |
| I3 | **gateway 兜底路径治理** | `sendIndex` 兜底改走 `PUBLIC_ROOT`（原硬编码 `join(__dirname,'..','public')`） | 分支 `fix/gateway-static-root-fallback` @ `08557c5`，**待开 PR** | 新增 | 🟡 待合入 |
| I4 | **dev 拉齐 master** | dev 工作区 HEAD → `d9889ff` | `a3-dev-sync-2026-09-26.md` | ③ / 新增 | ✅ |
| I5 | **两端 portal/admin 打通** | 修正 `deploy_deployments.current_version`（dev 改 `dev/d9889ff`；prod 改 `d9889ff`，原 `98f29b6` 落后一个月） | `/`、`/admin/`、模块 JS 均 200 | 4-3 部分 | ✅（仅 2/12 模块） |
| I6 | **发现并修复双段目录契约** | 产物内 public 资源恒走 `/static/modules/<key>/default/<commit>/`，与 manifest 的 env 段是两套；投递必须**双目录** | 两端补 `default/d9889ff` 后 logo 恢复 | 新增（根因） | ✅ 已修，未入流水线 |
| I7 | **ai-agent(6010) 首次上线** | prod 建 `servers/ai-agent/.env` + 构建 + pm2 启动 | 9 服务 online，接口 502→200（4010 = 未登录正常拦截） | ③ / 新增 | 🟡 依赖临时软链 |
| I8 | **prod 内部互调地址纠错** | 根 `.env.production` 的 `AUTH_SERVICE_URL/USER_SERVICE_URL` `3001/3002` → `6001/6002`（照抄 `.env.example` 本机端口所致） | 「上游服务不可用」与登录二维码消失均恢复 | 新增（事故） | ✅ |
| I9 | **dev portal 构建与资源补齐** | 补 `apps/portal/node_modules/@web-system/{ui,types}` 软链；`servers/gateway/public` 补 logo/qrcode/avatars | portal 构建通过、资源 200 | 新增 | 🟡 软链待固化 |
| I10 | **配置真相源与端口事实修正** | 确认 dev/prod **都是 6000 系**；配置优先级 = 根 `.env.production`（ecosystem 注入）> 服务 `.env` | 推翻 `local-release-runbook.md §1.1`「prod 用 3000 系」 | 文档债 | 🟡 待回写 runbook |

**净结果**：prod = git 仓库 + 9 服务全绿（restarts 0，已 `pm2 save`）；dev/prod 的 portal 与 admin 均跑最新产物；502 与 logo 裂图两类线上可见故障已清。

---

## 1. 环境事实修正（09-25 版中已过时、会误导的描述）

| 项 | 09-25 版描述 | 2026-09-26 实测 |
|---|---|---|
| prod 运行目录 | `/data/web_system` | **`/data/web_system_git`**（旧目录保留作回退） |
| prod 是否 git | 否（卡住轨道 B） | **是**，origin = GitHub public 可读，`git pull` 畅通 |
| prod 服务数 / 端口 | 8 个 | **9 个**（+ai-agent@6010），**全 6000 系**；`upload-service`(6008) 有 dist 未启动 |
| prod 静态资源 | 仓库内 `servers/gateway/public`（tracked 102 个） | **外置** `/data/web_system_static/public` |
| dev/prod 部署库 | 未区分 | dev → `gz-cdb-8y2lp8rt.sql.tencentcdb.com:27241 / web_system_deploy`；prod → `172.16.16.10:3306 / web_system`（**两套，别查错**） |
| 版本记录格式 | 未记录 | dev = `<env>/<commit>`；prod = `<commit>`；**public 资源恒用 `default/<commit>` 段** |
| pm2 生效方式 | — | 改根 `.env.production` 必须 **`delete` + `start`**（`restart` 不注入新 env） |
| NODE_ENV | prod 未显式设 | ecosystem 注入 `production` → `synchronize:false`（新表须手工迁移） |

---

## 2. 全部任务 · 优先级重排（P0 → P3）

> 编号沿用 09-25 版（`战线-序号`），本轮新增项编为 `N1..N10`。
> 工作量：S ≤ 1h ｜ M ≈ 半天 ｜ L ≥ 1 天 ｜ XL ≥ 3 天
> **判级依据**：线上可见故障 / 会重复翻车 > 数据不可逆风险 > 平台能力 > 产品纵深 > 治理与文档。

### P0 —— 线上可用 + 「下一次发布不再翻车」（本周内，做完才可称发布链路可信）

| 序 | # | 事项 | 归属 | 量 | 前置/备注 |
|---|---|---|---|---|---|
| 1 | **3-1** | **prod `upload-service`(6008) 上线**：有 dist 缺 `.env`（PORT/DB/JWT_SECRET/INTERNAL_API_KEY/存储根） | 你+运维 | M | 现 `/api/upload*` 全 502；⛔ 需你给存储根与密钥值 |
| 2 | **N1** | **流水线 build/upload/版本切换接入**，**必须覆盖 `default/<commit>` 双目录投递** | 研发 | L | 不做 = 每次发前端都静默 404（今日已踩）；原 4-1 的实质内容 |
| 3 | **N2** | **ai-agent 的 `body-parser` 正式进 `package.json`**（现为 `.pnpm` 临时软链，重装/换机即挂） | 研发 | S | 零风险，建议与 3-1 同批 |
| 4 | **N3** | **dev portal 依赖声明固化**：`@web-system/{ui,types}` 补进 `apps/portal/package.json`（替代手工软链） | 研发 | S | 同理，软链是隐患 |
| 5 | **I3** | **开 PR 合入 `fix/gateway-static-root-fallback`**（`08557c5`，已推送；环境无 `gh`，需手动开） | 你 | S | 不合入则外置后兜底分支仍指向仓库空目录 |
| 6 | **N4** | **prod 24h 稳定性观察**：9 服务 `restarts` 保持 0、`pm2 save` 已固化；upload 上线后重跑一轮 | 运维 | S | 观察期内不动其它变更 |
| 7 | **2-6** | **F14 核对 prod.env 的 `MINI_PROGRAM_SECRET` 与 `OFFICIAL_ACCOUNT_SECRET` 疑似同值** | 你+运维 | S | 上线前必查，成本极低后果高 |
| 8 | **N5** | **回写 `local-release-runbook.md`**：§1.1 端口事实修正 + 配置三层真相源 + `delete`+`start` 手法 | 研发 | S | 防止下一个人再照抄 `.env.example` 踩 3001/3002 |

> P0 的判级理由：1 是唯一仍在线上报错的能力；2 是今天四小时的坑，不固化会复发；3/4 是临时措施的脆弱点；5/8 是让正确事实沉淀下来。

### P1 —— 数据面治本 + 平台能力（P0 之后 1–2 周）

| 序 | # | 事项 | 归属 | 量 | 前置/备注 |
|---|---|---|---|---|---|
| 1 | **2-13** | **F20 各服务 `.env` 同步脚本**（根因修复） | 研发/运维 | M | 今日两起事故（端口错配、漏配）都由它兜住 |
| 2 | **4-6** | **关 deploy-console 的 `synchronize`（TODO-1 治本）** + **4-10** 补 `deploy_approvals` 两列迁移 | ⛔ 你+研发 | M | dev 云库 `scope/managed_by` 被 DROP 的真因；选 A 才治本 |
| 3 | **N6** | **dev 静态资源同样外置**（dev 仍 serve 仓库内 public，`git pull` 会被覆盖） | 运维 | M | L7b；与 prod 对齐后仓库才真正干净 |
| 4 | **N7** | **L7 仓库卫生**：`git rm --cached` 102 个 tracked `public/**` + `.gitignore`（83 materials 保留） | 研发 | S | 依赖 N6 先落 |
| 5 | **4-16 / 4-3** | **先定并发改造排期**，再决定 `PUBLISH_PATH` 怎么改（二者冲突，否则白做一轮） | ⛔ 你+研发 | XL | 4-3「其余 10 个模块投递验证」挂在此处 |
| 6 | **2-1 → 2-2 → 2-3** | 账号线：F1 本地发布验证 → F3 双账号合并实测 → F2 真机全流程（**先做 2-10 F15 错误细分**） | 研发 | L | 唯一前置链，卡整条账号线 |
| 7 | **2-4 / 2-10** | F4 登记 `INTERNAL_API_KEY`（dev/prod 不同值）+ F15 internal 失败细分 | 运维/研发 | S | 零依赖，可插队 |
| 8 | **5-1 / 5-12 / 5-13** | 零风险治理三件套：状态回填 / 清 5 个 `package-lock.json` / `apps/admin/.env.production` 移出库 | 研发 | S | 半天内可完成 |
| 9 | **4-7 / 4-8** | dev 控制台 `CONSOLE_INSTANCE=dev` + 两份库跑 `deploy_hosts` 迁移校验 | 运维 | S | 运维动作，可随时插队 |
| 10 | **3-2** | 边缘机 `42.194.200.69` 主机登记（⛔ 缺 SSH 用户/密钥/根目录） | ⛔ 你+运维 | S | 卡 nginx 路由登记 |
| 11 | **3-10** | 其它环境执行 `agent-translate.sql` + `migrations/0006` | 运维 | S | 数据面，需变更窗口 |
| 12 | **N8** | **发布前置检查清单**（端口 6000 系 / 三段路径 / env 注入方式）写进 runbook 并挂流水线前置 | 运维 | S | 与 N5 同源，可合并 |

### P2 —— 产品纵深与 UI 批次（稳定后）

| 序 | # | 事项 | 归属 | 量 | 前置 |
|---|---|---|---|---|---|
| 1 | **1-9 / 1-13** | ⛔ **拍板**：星座时运合规口径 + V13 隐藏 tabBar 补偿入口 + tsconfig/色值对账 | 你 | S | 硬前置，卡 1-10/1-11 |
| 2 | **1-2 → 1-4** | 合同评估接真（ocr-api + SSE 进度）→ 结果渲染 → 双链路收口 | 研发 | L | 无后端阻塞 |
| 3 | **1-5 ~ 1-8、1-11** | 发现页数据驱动、C 端只读 agent 列表、conversationId 回传、批次 5 验收取证 | 研发 | M | 依赖 1-9 |
| 4 | **1-12** | 批次 6 legacy 页面清理（28 → ~12） | 研发 | L | 依赖 1-4 |
| 5 | **4-5 / 4-9 / 4-11 / 4-15** | deploy-console 四个 UI 批次（回滚端点 / 监控诊断横幅 / awaiting-approval / 画布） | 研发 | L | **每批独立过 UI 动作门**，建议合并一次过门 |
| 6 | **4-12 / 4-13 / 4-14** | 节点边界变更（⛔ 含 AI 验证接入时机）+ `normalizeNodes` 三 platform + 变量管理 | ⛔ 你+研发 | L | 流水线形态决策 |
| 7 | **3-5** | B1 剩余 7 个服务接入统一认证助手 | 研发 | L | 无阻塞 |
| 8 | **3-6 / 3-8** | B2 删 user-service 上传端点（依赖 3-4）· B4 ai-service `uploads/` 归属 | 研发 | M | 依赖 D6 拍板 |
| 9 | **5-10 / 5-11** | 锚点回填 B1a→B1b→B2→B3→B4 | 研发 | XL | 先 warn 观察一轮再升 strict |
| 10 | **1-1 / 1-10** | 批次 1/2/5 的 V1–V10 取证 + 后台 6 个 agent 配齐发布 | 研发/运维 | M | 依赖 1-9 |

### P3 —— 长期技术债与治理（有余力再做）

| 序 | # | 事项 | 归属 | 量 |
|---|---|---|---|---|
| 1 | **5-14** | 远端 77 个分支治理（逐个判断归档/删除，**不宜批量**） | ⛔ 你+运维 | M |
| 2 | **5-15** | ai-service / ai-agent 的 agent 定义管理收敛到一处（两份 `agent-def-sync` 正在漂移） | 研发 | L |
| 3 | **5-16** | `ecosystem.config.js` 与 `.cjs` 双文件漂移 · docker-compose 补齐或删 · 头像去重 | 研发 | M |
| 4 | **5-9** | quality-gate 的 lint 档恢复（全仓无 ESLint flat config，需先补最小规则集） | 研发 | M |
| 5 | **5-3 / 5-6** | ⛔ R13/R14/R15 是否升 error + 存量豁免；S1–S6 结构守护是否补 | ⛔ 你+研发 | M |
| 6 | **5-4 / 5-5 / 5-7** | `.mjs` 迁移不在 `apply-migrations.sh` 内 · `feature/kedou-ai-minigram` 死分支 · SSE/MCP 契约面 | 研发 | S |
| 7 | **5-8** | `docs/posts/ai-agent-gate.md` 泛化项目名 + 补背景后对外发布 | 你 | M |
| 8 | **3-7** | 回收 dev `/tmp/modules-legacy-20260924/`（108M，备份已存在） | 运维 | S |
| 9 | **2-7 / 2-8 / 2-9** | 合法域名登记 · 手机号资源包额度 · 协议页文案回填 | 运营 | S/M |

---

## 3. 建议执行顺序（未来两周）

| 天 | 动作 | 产出判据 |
|---|---|---|
| D+0（今晚） | 观察窗口开启：记录 prod 9 服务 `restarts` 基线 | 基线 = 0 |
| D+1 | P0-5 开 PR 并合入 → **P0-3/N3** 依赖声明进 package.json → **P0-8/N5** 回写 runbook | 3 个 PR 全部 merged；runbook 端口事实已修正 |
| D+1~2 | **P0-1** upload-service 上线（⛔ 需你给值）+ **P0-6** 观察重跑 | `/api/upload*` 200；restarts 仍 0 |
| D+2~4 | **P0-2/N1** 流水线 build/upload/版本切换 + 双目录投递（核心工作量） | 一次真实发布端到端跑通且资源 200 |
| D+5~7 | **P1-1** `.env` 同步脚本 → **P1-8** 零风险治理三件套 → **P1-9** 迁移校验 | 漏配类事故有兜底 |
| D+8~14 | **P1-2** 关 synchronize（⛔ 拍板后）→ **P1-3/N6** dev 外置 → **P1-4/N7** 仓库卫生 | dev 云库字段不再被 DROP；仓库 tracked 产物归零 |
| 之后 | P1-5 并发排期拍板 → P2 产品纵深（依赖 D 系列拍板） | 按拍板结果推进 |

---

## 4. 需要你拍板的清单（更新到 2026-09-26）

| # | 待拍板项 | 出处 | 影响面 | 紧急度 |
|---|---|---|---|---|
| **D4'** | **prod upload-service 的 PORT/密钥/存储根取值**（现 502，唯一线上报错能力） | P0-1 / 3-1 | 卡上传功能 | 🔴 高 |
| **D13** | **是否把「流水线双目录投递」列为发布前置红线**（不做则每次前端发布静默 404） | P0-2 / N1 | 发布可信度 | 🔴 高 |
| D1 | F9–F13 五项（退出细节 / 绑定唯一性 / unionid / 注销 / 发版批次） | 2-12 | 账号上线范围 | 🟡 中 |
| D2 | 批次 5 合规口径（星座/时运）+ 6 个 agent 由谁写 prompt | 1-9 | 卡发现页与翻译链路 | 🟡 中 |
| D3 | V13 隐藏 tabBar 补偿入口 + tsconfig + V2 色值对账 | 1-13 | 小程序交互一致性 | 🟡 中 |
| D6 | A3 三条迁移（执行 or 记账跳过）+ A4 prod 是否跑上传迁移 | 3-3/3-4 | 数据面，错记不可逆 | 🟡 中 |
| D9 | deploy-console `synchronize` 处置 A/B/C（**选 A 才治本**） | 4-6 | dev 云库结构性风险 | 🟡 中 |
| D10 | 节点边界变更与 AI 验证接入时机 | 4-13 | 流水线形态 | 🟢 低 |
| D5 | 边缘机 `42.194.200.69` SSH 凭据 | 3-2 | nginx 主机登记 | 🟢 低 |
| D8 | 小程序发布私钥 / `PUBLISH_PATH` 怎么改（与并发改造冲突） | 4-4 / 4-16 | 小程序发布链路 | 🟢 低 |
| D11 | R13/R14/R15 是否升 error + 存量豁免；S1–S6 是否补 | 5-3/5-6 | 门禁强度 | 🟢 低 |
| D12 | 77 个远端分支归档口径 | 5-14 | 仓库治理 | 🟢 低 |

> 09-25 版的 D7（远端部署生效真机变更窗口）**已解除**：prod 已是 git 仓库且本轮已完成真机切换，窗口不再是阻塞项。

---

## 5. 文档自身的债（随 P0-8 一并处理）

| 问题 | 文件 |
|---|---|
| §1.1「prod 用 3000 系」是**错的**，prod/dev 均为 6000 系；缺「配置三层真相源」与「`delete`+`start`」说明 | `docs/development/local-release-runbook.md` |
| 复选框陈旧：批次 1/2/5 已落码仍为 `- [ ]`；§0「seed 只有 5 个 agent」实测为 7 个 | `specs/kedou-ai-minigram/tasks.md` |
| design §4/§7 状态仍标「阻塞/待拍板」，实际全部已合 | `specs/rd-process-model/design.md` |
| §8 待确认 Q3/Q4/Q6/Q8/Q9/Q10 已在 design §10 决策，未回填 | `specs/pipeline-concurrency/requirements.md` |
| 前端路径 `views/ModuleDetail.vue` 已不命中（疑随域拆分迁移） | `specs/deploy-console/backend-deploy-effect-tasks.md` |
| 缺「public 资源恒走 `default/<commit>` 段」这条契约（今日根因） | `scripts/build-module.mjs` / `vite-micro-frontend.mjs` 周边文档（**建议新增**） |

---

## 6. 关联索引

| 主题域详情 | 入口 |
|---|---|
| prod 转 git 执行记录 + 10 条踩坑 + 影子启动手法 | `docs/development/a1-prod-git-migration-2026-09-26.md` |
| dev 拉齐记录 | `docs/development/a3-dev-sync-2026-09-26.md` |
| dev/prod 双轨方案 | `docs/development/dev-prod-release-plan-2026-09-25.md` |
| 发布基础设施阻塞清单 | `docs/development/release-infra-review-2026-09-25.md` |
| 上一版总表（已被本文取代） | `docs/development/master-todo-2026-09-25.md` |
| 小程序账号能力 | `docs/development/mp-account-follow-ups.md` |
| 小程序应用侧 | `specs/kedou-ai-minigram/tasks.md`、`docs/development/miniprogram-follow-ups.md` |
| dev/prod 基础设施 | `docs/development/dev-todo-2026-09-24.md` |
| 发布平台 / 部署生效 | `specs/deploy-console/backend-deploy-effect-tasks.md` |
| 服务监控治理 | `docs/development/console-monitor-followups.md` |
| 工程门禁机制 | `specs/rd-process-model/TODO.md` |
| UI 锚点回填 | `docs/ui/anchor-backlog.md` |
