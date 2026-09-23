# 发布评审判据清单（release-reviewer）

> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
> 定位：`release-reviewer`（S8.1）的判据源——发布/部署/环境/数据变更类改动，逐条过本报告后才可交人放行。
> 关联：`specs/rd-process-model/design.md`（流程与角色）、`docs/development/local-release-runbook.md`（发布操作手册）、`ecosystem.config.cjs`（服务与端口真相源）。

---

## 用法

1. 本清单是**判据源**，不是操作手册：每条给「判据 + 怎么验 + 不通过怎么办」。操作步骤查 `local-release-runbook.md`。
2. 数值一律不抄：**服务与端口以 `ecosystem.config.cjs` 为唯一真相源**，本文只写校验方式。
3. 适用触发面（由 CI R14 机检拦）：`scripts/migrations/*.sql`、`servers/*/.env`、`ecosystem.config.cjs`、`scripts/pipeline/**`、发布相关脚本。
4. 报告落盘 `docs/ui/reviews/` 之外的评审目录，头部两行机器可读：`阻塞: N` / `重要: N`（与 `design-reviewer` 同格式，CI 复用同一解析器）。

---

## A. 运行面：改的东西真的会被加载吗

| # | 判据 | 怎么验 | 不通过怎么办 |
|---|---|---|---|
| A1 | **构建发生在发布目录，不是工作区** | `pm2 describe <app> \| grep -E "script path\|exec cwd"` 看是否指向发布目录 | 工作区构建不会生效；工作区 commit&push → 发布目录 fetch/build |
| A2 | **发布目录 git HEAD 与预期分支一致** | `git -C <发布目录> log --oneline -1`；同时确认无流水线正在跑 | 发布目录被流水线 checkout 到别的分支 = 构建基于错误源码 |
| A3 | **workspace 包走完整 build 脚本** | 涉及 `packages/*` 时确认跑的是 `npm run build`（不只 `npx tsc`） | 只 tsc 只更新 ESM，后端 require 的 cjs 仍是旧的 → 常量/权限码不生效 |
| A4 | **端口占用者 == pm2 当前进程** | `lsof -ti tcp:<port>` 与 `pm2 list` 的 pid 比对 | 孤儿进程占端口 → `kill -9` 后干净重启；仅杀**非 pm2 纳管**的占用者 |
| A5 | **服务已在 `ecosystem.config.cjs` 登记** | grep 服务名 | 不在清单 = 下一个孤儿进程，先登记再发布 |

> A1/A2 是本项目最高频的「改了不生效」根因，且**无任何报错**——必须逐条验，不能凭「我改了」断言。

## B. 配置面：服务拿到的配置是正确来源吗

| # | 判据 | 怎么验 | 不通过怎么办 |
|---|---|---|---|
| B1 | **不用 `pm2 restart --update-env`** | 确认重启命令为 `pm2 delete` + 干净 env `pm2 start`，进程环境只留 PATH/HOME/PORT | `--update-env` 会把执行会话变量固化进 `pm2_env`，而 dotenv 不覆盖已存在的 `process.env` → 服务实际用的是错误来源的配置 |
| B2 | **跨服务密钥一致** | 按服务对取值比对（如 ai-agent ↔ mcp-gateway 的 `MCP_CLIENT_KEY`；mcp-gateway ↔ knowledge-service 的内部密钥） | 不一致直接阻断：表现为 401 / 4010，排查成本极高 |
| B3 | **关键依赖配置非缺失** | 目标服务 `.env` 取关键 URL/KEY 判空 | 缺失会导致能力**静默不注册**（如 MCP 工具未注册），直到运行时报「工具未注册」才暴露 |
| B4 | **占位符密钥未被误判为有效** | grep `REPLACE_` 类占位符 | 日志「初始化成功」常只判非空，占位符能骗过 |
| B5 | **服务自身 `.env` 是唯一配置源** | 确认无外部注入覆盖 | 配置源不唯一 = 环境不可复现 |

## C. 数据面：迁移可逆、跨库正确、顺序对

| # | 判据 | 怎么验 | 不通过怎么办 |
|---|---|---|---|
| C1 | **迁移文件声明目标库** | 文件头须有 `-- @database <db>` 注解 | 未声明则落到默认库 → **跨库误写** |
| C2 | **迁移幂等** | 文件本身 `CREATE TABLE IF NOT EXISTS` 且靠 `schema_migrations` 记账 | 非幂等迁移重跑即事故 |
| C3 | **迁移在应用流程覆盖范围内** | 确认文件扩展名被 `apply-migrations.sh` 扫描（当前只扫 `*.sql`） | ⚠️ 目录内存在 `.mjs` 迁移**不在该流程内**——要么纳入，要么明确其独立执行方式 |
| C4 | **按环境执行** | `scripts/apply-migrations.sh <local\|dev\|prod>`，`DRY_RUN=1` 先演练 | 环境选错 = 写到错误库 |
| C5 | **DB 绑定晚于代码同步** | 改 `agent_definitions.capabilities` / 字典 / 权限码等 DB 绑定前，先确认运行代码已同步到发布目录 | 先绑后用 = 绑定即故障（曾致所有 agent 报「工具未注册」） |
| C6 | **破坏性变更有回滚路径** | 有对应的反向迁移或数据快照 | 无回滚路径的破坏性变更不得放行 |

## D. 前端面：版本指针与产物一致

| # | 判据 | 怎么验 | 不通过怎么办 |
|---|---|---|---|
| D1 | **微前端三步齐全** | 构建 → 拷贝产物到静态目录 → 更新版本表 `current_version` | 缺一步浏览器仍加载旧产物 |
| D2 | **版本表在正确的库** | 确认改的是发布平台库（非业务库）的表 | 改错库 = 静默不生效 |
| D3 | **版本缓存已过期并复核** | 等缓存 TTL 后 `curl <gateway>/__manifest__` 确认 version 已更新 | 未更新则重启 gateway 清内存缓存兜底 |
| D4 | **共享依赖产物存在** | `curl -I <gateway>/static/cdn/<file>` 看 content-type 非 text/html | cdn 目录是构建产物、非 git 跟踪，缺了会导致 shell 白屏且**无报错** |

## E. 特殊通道

| # | 判据 | 怎么验 | 不通过怎么办 |
|---|---|---|---|
| E1 | **deploy-console 自身不走流水线** | 确认走独立发布脚本 | 走流水线会自杀式中断 |
| E2 | **后端发布确实重启** | 确认模块类型字段已写入，restart 守卫生效 | 该字段缺失会导致后端发布不重启（历史未修，影响面需评估后再动） |
| E3 | **变更后有验证动作** | 端口探活 / 健康检查 / 关键链路冒烟，留证据 | 「发布成功」不等于「服务可用」 |

---

## 报告格式（与 design-reviewer 对齐）

```
阻塞: N
重要: N
```

正文每条须含：**反例（情形 → 实际 vs 期望）+ 判据编号（A1…E3）+ 严重级 + 是否阻塞**。
指不到本清单编号的意见 → 降级为「建议」并标注「无判据，属个人偏好」。

commit trailer：`Release: pass` 或 `Release: <报告路径>`；纯微调走 `Micro-exempt: <理由>`。

## 零摩擦边界（不触发评审）

纯文档改动、与发布面无关的脚本微调、业务代码改动（走各自评审）。**作用域严格限定在 §「用法」第 3 条的触发面内。**
