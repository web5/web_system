# dev / prod 发布落地方案

> 日期：2026-09-25
> 数据来源：**SSH 实测**（DEV `ubuntu@175.27.189.123`、PROD `root@106.52.176.246`，远端目录均为 `/data/web_system`），非文档推测。
> 配套：《本地开发发布与发布平台基础设施梳理》`docs/development/release-infra-review-2026-09-25.md`

---

## 〇、结论先行

**dev / prod 不是「跑不起来」，而是「一直在跑、但没人管得动」。**

| 判定 | 结论 |
|---|---|
| 网络 | ✅ dev / prod SSH 均通（`.env.deploy` 已配 `DEV_SERVER` / `PROD_SERVER`） |
| 服务进程 | ✅ dev 13 个 pm2 全部 online；prod 8 个 online |
| 代码同步 | ❌ dev 落后 **27 个 PR**（`4ea6d64` vs 本地 `6b8dd86`）；prod **不是 git 仓库**，无法 pull/回滚 |
| 服务齐全度 | ⚠️ prod 缺 4 个服务：`deploy-console` / `upload-service` / `ai-agent` / `knowledge-service` |
| 健康度 | ⚠️ prod `gateway` restarts=578、`ai-service` restarts=1002（崩溃循环特征） |
| 平台流水线 | ❌ dev/prod 通道从未真机验证（这是另一条线的缺口，不影响「跑起来」） |

所以：**别重写，别推倒。** 走「先对齐、再收口」的双轨。

---

## 一、实测现状台账

### 1.1 两端进程与端口

| 服务 | DEV 端口 | DEV pm2 名 | PROD 端口 | PROD pm2 名 | PROD 状态 |
|---|---|---|---|---|---|
| gateway | 6000 | `web-gateway` | 6000 | `gateway` | ⚠️ restarts 578 |
| auth-service | 6001 | `web-auth` | 6001 | `auth-service` | ✅ |
| user-service | 6002 | `web-user` | 6002 | `user-service` | ✅ |
| ai-service | 6003 | `web-ai` | 6003 | `ai-service` | ⚠️ restarts 1002 |
| system-service | 6004 | `web-system` | 6004 | `system-service` | ✅ |
| todo-service | 6005 | `web-todo` | 6005 | `todo-service` | ✅ |
| mcp-gateway | 6006 | `web-mcp-gateway` | 6006 | `mcp-gateway` | ✅ |
| content-hub | 6007 | `web-content-hub` | 6007 | `content-hub` | ✅ |
| upload-service | 6008 | `web-upload` | — | — | ❌ dist 有 / .env 无 |
| ai-agent | 6010 | `web-ai-agent` | — | — | ❌ 未起 |
| knowledge-service | 6011 | `web-knowledge` | — | — | ❌ 未起 |
| deploy-console | 6200 | `web-deploy-console` | — | — | ❌ dist 无 / .env 无 |

### 1.2 三个必须纠正的文档级错误事实

| # | 文档里的说法 | 实测 | 影响 |
|---|---|---|---|
| E1 | 「prod 用 3000 系端口」（`local-release-runbook.md` §1.1 端口矩阵） | **prod 也是 6000 系**（6000–6007） | 端口矩阵整张表是错的，据此配 prod 会配出连不上的服务 |
| E2 | 「prod 缺 3 个服务端口待确认」（Q1） | 已自动回答：沿用 6000 系，补 **6008 / 6010 / 6011 / 6200** | 卡点消解，不再是阻塞 |
| E3 | 「dev/prod 发布曾 SVN 失败 / 跑不起来」 | dev 13 进程 online；传统脚本通道（`deploy-dev.sh`）一直在用 | 判断重了：服务是活的，缺的是**同步与齐全度** |

### 1.3 pm2 命名不一致（新发现）

- dev 用长名 `web-gateway` / `web-deploy-console`（与仓库 `ecosystem.config.cjs` 一致）
- prod 用短名 `gateway` / `auth-service`（来自远端旧版 `ecosystem.config.js`）
- 远端还有多个备份文件漂移：`ecosystem.config.js.bak-20260821` / `.bak-20260924-pre600x` / `.bak-mcp-20260815`

→ `publish-deploy-console.sh:139` 的 pm2 候选链就是为这个不一致打的补丁。**根因是两端用了不同的 ecosystem 文件**。

---

## 二、方案：双轨并行

```
轨道 A（止血 · 本周）  把 dev / prod 拉齐                ← 今天就能做，不需要新功能
轨道 B（正道 · 后续）  发布平台流水线收口 dev / prod      ← M0→M3，让发布可追溯、可回滚
```

**为什么必须 A 先于 B**：轨道 B（流水线远端发布）依赖「远端有正确代码 + 依赖 + 端口 + pm2 名」。
现在 prod 连 git 仓库都不是，直接上流水线必然失败。

---

## 三、轨道 A：基线对齐（建议本周，分 5 步）

| 步骤 | 动作 | 是否需要停机 | 验收 |
|---|---|---|---|
| **A1** | **prod 转 git 仓库**（最大阻塞）。方案：新目录 `git clone` 完整仓库 → 移植 `servers/*/.env` 与 `node_modules` → 切换符号链接/目录 → 逐个 `pm2 restart` | 需要（分钟级） | prod 能 `git log -1` 且服务全 online |
| **A2** | 统一 ecosystem：两端都用仓库 `ecosystem.config.cjs`（`web-*` 命名），旧 `.js` 与三个 `.bak-*` 归档 | 否（下随增量） | `pm2 list` 两端命名一致 |
| **A3** | dev 拉代码到 `6b8dd86`（当前落后 27 PR），跑一次全量构建 + 重启 + 端口探活 | 否 | dev HEAD == 本地 HEAD，13 进程 online |
| **A4** | prod 补齐 4 个服务：`upload-service`（补 .env）、`ai-agent`、`knowledge-service`、`deploy-console`（dist + .env，需 JWT_SECRET） | 逐个放行 | prod 12 进程 online |
| **A5** | 排查崩溃循环：`gateway`(578) / `ai-service`(1002)；清理 dev 的 `dist.bak-*` 残留 | 否 | restarts 稳定不增长 |

**A1 的两个选项（需你选）**：
- **A1-a 稳妥**：`/data/web_system` 改名备份 → `git clone` 到新目录 → 逐个迁移 `.env` → 验证后删备份（可秒级回退）
- **A1-b 激进**：原地 `git init` + `remote add` + `fetch` + `reset --hard`（与本地工作副本合并有冲突风险，不建议）

推荐 **A1-a**。

---

## 四、轨道 B：发布流水线收口（依赖 A 完成）

沿用 `release-infra-review-2026-09-25.md` §3 的 M0→M3，但顺序调整为：

| 阶段 | 内容 | 状态 |
|---|---|---|
| **M0** | 数据登记 + 已知 bug 修复 | 🔄 **本次已修 6 项**（见 §5） |
| **M1** | dev 最小闭环试点：拿 `system-service` 走一次完整流水线（pull→build→upload→restart→version→pointer→verify） | ⬜ 待 A3 完成后 |
| **M2** | prod 逐个放行（先 gateway 再其余） | ⬜ 待 A4 |
| **M3** | 结构性改造：远程执行通道收敛、四条远端通道统一地址源、旁路脚本纳管、环境模型二选一 | ⬜ |

**M0 已完成的 6 项修复**（本次改动，待评审后提交）：

| # | 文件 | 问题 | 修法 |
|---|---|---|---|
| 1 | `migrations/0014_deploy_host_scope.sql` | 缺 `-- @database` 头 → 落到默认 `web_system`（错库） | 补 `@database web_system_deploy` |
| 2 | `migrations/0009_pipeline_vars_and_template_env.sql` | 同上（deploy_pipeline_* 属 deploy-console 库） | 补头 |
| 3 | `migrations/0010_pipeline_task_states.sql` | 同上（deploy_pipeline_runs） | 补头 |
| 4 | `servers/deploy-console/src/services/services.service.ts:151` | 播种读 `m.pm`（实际字段 `pm2`）→ `pm2Name` 恒 null，远端重启找不到进程名 | 改 `m.pm2` |
| 5 | `scripts/pipeline/fetch-config.sh` | 要 `DEPLOY_ENV_ID`，平台实际注入 `DEPLOY_ENV` → 恒 skip，远端重启型发布的配置下发链路是断的 | 兼容两者（`DEPLOY_ENV_ID ?? DEPLOY_ENV`） |
| 6 | `scripts/release-deploy-console.sh:93` | 调不支持的 `--skip-sync` → exit 2，console 封装链路从来不能用 | 改 `--from-release --branch <b>`，并加分支名防注入校验 |

**遗留（本次未改，需专项）**：

- `migrations/0002_upload_gateway_admin_tables.sql` **跨库混合**（`audit_logs`/`gateway_routes`/`upload_files` 属 `web_system`，`deploy_tasks`/`deploy_versions` 属 `web_system_deploy`）→ 单靠 `@database` 头修不了，需拆文件
- `scripts/migrations/**` 下 26 个 `.mjs` + 3 个 `.sql` **不在 `apply-migrations.sh` 扫描范围**（扫描的是根 `migrations/*.sql`）→ dev/prod 执行过哪些迁移无法从仓库判定

---

## 五、需要你拍板的 4 项

| # | 决策 | 选项 | 建议 |
|---|---|---|---|
| **Q1** | prod 转 git 仓库（A1） | a 新目录 clone 迁移 / b 原地 init | **A1-a** |
| **Q2** | pm2 命名统一到哪种 | 全部 `web-*`（对齐仓库）/ 保留短名 | **`web-*`**（仓库是真相源） |
| **Q3** | 变更窗口 | 何时动 prod（A1 需分钟级停机） | 给一个低峰时段 |
| **Q4** | 轨道顺序 | 先做满 A 再动 B / A1+A2 后即插 B 试点 | **A 全部完成后再 B**（B 依赖正确基线） |

---

## 六、立即可做、零风险的一件事

**A3 的 dev 拉齐**（dev 不是生产环境，落后 27 个 PR 本身也是隐患）。等你一句话我就能跑：

```bash
ssh ubuntu@175.27.189.123 'cd /data/web_system && git fetch origin master && git merge --ff-only origin/master'
# → 全量构建 → pm2 restart 全部 → 逐端口探活
```
