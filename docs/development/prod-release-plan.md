# prod 首次发布方案（一次性成功清单）

> 目标：把「发布 prod」从"试错"变成"照单执行"。
> 前置阅读：`from-zero-init-data.md`（初始化数据）、`local-release-runbook.md`（本机发布目录机制）。
> 状态：**方案稿**。文中标注「待核实」的项需在 prod 现场确认后回填。

---

## 一、结论先说（三个事实）

1. **prod 已在发布平台登记**：`deploy_servers.prod-default = 106.52.176.246 / root / ~/.ssh/id_ed25519_servers / /data/web_system`；`deploy_environments.prod.public_url = https://kedouai.com`。
2. **prod 从未通过流水线发布过**：`deploy_deployments` 中 `env_id='prod'` **零记录**（local/dev 有）。
3. **当前流水线无法把后端服务发布到远程 prod**。原因（已读码确认）：
   - `runStageCommand()` 的 cwd 固定为 `this.releaseWorkspace`（**deploy-console 所在机**的发布目录），代码里**没有 remote 分支** → `restart`/`verify` 阶段永远操作**console 所在机的 pm2**；
   - `target=remote` 只作用于 **upload** 步骤：`RemoteDeliveryService` 把前端 `dist` tar/scp 到远端静态目录；**版本指针仍写 console 所在库** → prod 的 gateway 读 prod 自己的库 → 前端也不会切版本。

⇒ **"用 dev.kedouai.com/console 发布 prod"当前不可行**（点了也只影响 dev 本机，prod 毫发无损）。要落地见第二节路径选择。

---

## 二、四条可行路径

| 路径 | 做法 | 优点 | 代价 / 风险 |
|---|---|---|---|
| **A（推荐长期方案）** | 在 **prod 机上部署一套 deploy-console**（与其它服务同机），之后所有 prod 发布都走 prod 自己的 console | 全链路同机，`restart/verify` 天然作用于 prod；与 dev 形态一致；有审计与版本表联动 | prod 需要完整构建环境（node/pnpm/源码）；console 的 DB 指向 prod 库 |
| B | 扩展流水线：阶段命令支持**远程执行**（ssh 到目标机跑命令） | 一套 console 统管多环境 | 需改 deploy-console 代码（远程执行通道 + 私钥管理 + 超时/回滚），改动大 |
| C | 给 **dev 的 console** 加"远端执行"能力（SSH 驱动 prod 的部署脚本） | 复用现有 console 与 UI | 同 B；且 dev 机持有 prod 私钥，安全边界变差 |
| **D（应急 / 首次 bootstrap）** | 在 prod 上手工执行：`git pull` → 构建 → `scripts/pipeline/restart-backend.sh` 重启；前端按"四步铁律"投递 | **零代码改动，今天就能用**；与流水线 restart 语义完全一致 | 无 UI / 无审计 / 版本表不自动联动（需手工写 `deploy_deployments`） |

> 实务建议：**首次用 D 把 prod 拉起来**，随后落 A；B/C 只在"一 console 管多环境"成为刚需时再做。

---

## 三、首次 prod 部署前置条件清单

按依赖顺序，逐项打勾（缺一项就大概率"发不成功"）：

### 1. 网络与入口
- [ ] DNS：`kedouai.com` / `portal.kedouai.com` 指向网关机（**待核实**：平台记录的是 106.52.176.246，需与线上实际解析比对）
- [ ] nginx 反代配置 + HTTPS 证书
- [ ] 安全组放行 443 / 22

### 2. 主机运行时
- [ ] Node 20 / pnpm 9 / pm2 / nginx / redis（可选）/ mysql-client
- [ ] `/data/web_system`（git clone，checkout `master`）

### 3. 数据库（最容易漏）
- [ ] prod MySQL（`scripts/.env.deploy` 记录：内网 `172.16.16.10`，经跳板）
- [ ] 三个库存在：`web_system` / `web_system_deploy` / `web_system_knowledge`
- [ ] **`./scripts/apply-migrations.sh prod`**（生产 `synchronize=false`，漏跑 → 进程 online 但端口不监听）
- [ ] `mcp_api_keys` / `mcp_key_codes` 手工建表（`servers/mcp-gateway/sql/mcp_keys_tables.sql`）
- [ ] `web_system_deploy` 由 deploy-console 首次启动自动建表

### 4. 配置
- [ ] `/data/web_system/.env.production`（根）+ 各服务 `servers/<svc>/.env`
- [ ] 必填**非空**：`JWT_SECRET`（空则进程直接 exit）、`DB_*`、`REDIS_URL`、`CORS_ORIGINS`（禁 `*`）、`PUBLIC_URL`
- [ ] 第三方密钥：微信（小程序/公众号）、`IMAGE_GEN_API_KEY`、`FINNEWS_SERVICE_KEY`、`MCP_CLIENT_KEY`、`KNOWLEDGE_INTERNAL_API_KEY`
- [ ] deploy-console：`PROD_SERVER` / `PROD_USER` / `PROD_KEY`（remote 投递用；`.env.example` 有键名）
- [ ] 变量完整清单的权威来源：**`ecosystem.config.js`（生产版）** —— 12 个服务的 pm2 env 全在里面

### 5. 构建
- [ ] 共享包：`@web-system/shared` / `types` / `mcp-core` / **`@kedouai/agent-core`**（ai-service 依赖，勿漏）
- [ ] 后端：各服务 `npx nest build`（有 `nest-cli.json` 用 nest build，否则 `tsc`）
- [ ] 前端：`RELEASE_TAG=<hash> MF_FORMAT=system npx vite build --mode mf`（shell/portal/admin）
- [ ] CDN：`node scripts/build-externals.mjs`

### 6. 进程与静态产物
- [ ] `pm2 start ecosystem.config.js` → `pm2 save` → `pm2 startup`
- [ ] 前端产物落 `servers/gateway/public/static/modules/<key>/<version>/`
- [ ] 版本表 `deploy_deployments`（**prod 库**）写入 `current_version`

### 7. 初始数据
见 `from-zero-init-data.md`：admin 用户、权限同步、agent 定义、mcp 模块（自动 seed）；`deploy_environments` / `deploy_modules` / 模板 / 阶段命令（console 启动自动）。
- [ ] `deploy_servers.prod-default` 的 host/密钥与现网一致

### 8. 验证
- [ ] `./scripts/health-check.sh prod`（端口 + MCP initialize + **AI 链路 knowledge_list 探活**）
- [ ] admin 登录、`GET /__manifest__` 版本正确、前端能加载

---

## 四、执行顺序（路径 D：首次 bootstrap）

```bash
# ① prod 机上：拉代码与依赖
cd /data/web_system && git fetch --all && git checkout master && git pull --ff-only
pnpm install --frozen-lockfile

# ② 共享包（顺序：包 → 服务）
pnpm --filter @web-system/shared build && pnpm --filter @web-system/types build \
  && pnpm --filter @web-system/mcp-core build && pnpm --filter @kedouai/agent-core build

# ③ 数据库迁移（生产必须）
./scripts/apply-migrations.sh prod
mysql < servers/mcp-gateway/sql/mcp_keys_tables.sql     # 手工建 MCP API Key 表

# ④ 后端构建
for s in gateway auth-service user-service ai-service system-service todo-service \
         mcp-gateway content-hub upload-service knowledge-service ai-agent deploy-console; do
  (cd servers/$s && ( [ -f nest-cli.json ] && npx nest build || npx tsc -p tsconfig.json ))
done

# ⑤ 前端构建 + CDN
RELEASE_TAG=$(git rev-parse --short HEAD) MF_FORMAT=system node node_modules/vite/bin/vite.js build --mode mf   # 各 app 目录下执行
node scripts/build-externals.mjs

# ⑥ 启动（干净环境，避免历史 pm2_env 污染）
for spec in "gateway:6000" "auth-service:6001" ... ; do
  RELEASE_DIR=/data/web_system MODULE_KEY=<k> MODULE_DIR=<dir> MODULE_TYPE=backend PORT=<p> \
    bash scripts/pipeline/restart-backend.sh
done
pm2 save

# ⑦ 初始数据
cd servers/auth-service && ADMIN_INIT_PASSWORD='xxx' pnpm seed
node /data/web_system/scripts/seed-dev-deployment.mjs   # 如走微前端动态版本

# ⑧ 验证
./scripts/health-check.sh prod
```

---

## 五、已知坑（prod 专属）

| 坑 | 说明 | 处置 |
|---|---|---|
| 环境端口记录不一致 | `deploy_environments.prod.ports` 仍是 **3000 系列**，而 `ecosystem.config.js` 用 **6000 系列** | 发布/探活前先更新环境配置，否则 URL 与探活全错 |
| `PROD_SERVER` 未配 | `RemoteDeliveryService.resolveTarget` 直接抛「未配置 prod 服务器地址」 | 在 deploy-console `.env` 补 `PROD_SERVER/PROD_USER` |
| 生产 `synchronize=false` | 新表不会自建 | 每次升级前先 `apply-migrations.sh prod` |
| `JWT_SECRET` 为空 | ecosystem 启动校验直接 `process.exit(1)` | 配置阶段就校验非空 |
| prod 发布需 `confirm=true` | `PipelineController.submit` 对 prod 强制 | 控制台勾选确认 / API 带 `confirm:true` |
| 前端指针写错库 | 必须写 **prod 的 `web_system_deploy`**，不是 console 所在库 | 路径 A/D 才不会有这个问题 |
| pm2 环境污染 | `restart --update-env` 会把会话变量固化进 pm2_env | 统一用 `scripts/pipeline/restart-backend.sh`（已内置干净环境重建） |

---

## 六、待现场核实（当前离线状态无法确认）

1. prod 主机现状：是否已部署过、`pm2 list`、`/data/web_system` 代码版本、`.env.production` 是否就绪；
2. `portal.kedouai.com` / `kedouai.com` 的**实际解析 IP** 与平台记录（106.52.176.246）是否一致；
3. prod 上是否已存在 deploy-console（决定能否走路径 A）；
4. prod 到 DB（172.16.16.10）的连通方式与凭据；
5. prod 的 `deploy_servers` 记录与实际 SSH 密钥是否匹配（`~/.ssh/id_ed25519_servers`）。

---

## 七、实现（本分支已落地）

| 能力 | 脚本 | 说明 |
|---|---|---|
| 一键初始化（三环境） | `scripts/bootstrap.sh --env <local\|dev\|prod>` | 依赖 → 共享包 → 建库 → 迁移 → 后端构建 → **干净环境启动** → seed → 验证；`--dry-run` 全预演、`--no-start` 只做数据层 |
| verify 阶段脚本化 | `scripts/pipeline/verify-backend.sh` | pm2 online 轮询 + 端口 TCP + **AI 链路**（401 → 网关密钥、4010 → 内部密钥） |
| restart 支持首次纳管 | `scripts/pipeline/restart-backend.sh`（`PM2_ALLOW_NEW=1`） | 同一脚本既能重启也能首次拉起；默认仍严格，避免 typo 创建进程 |
| 清单防漂移 | `scripts/modules.json`（服务清单）、`ecosystem.config.cjs`（端口真相源） | `bootstrap.sh` / `local-up.sh` 均从此读取，不再手写清单 |

prod 首次执行（**在 prod 机上**）：
```bash
ssh <prod>
cd /data/web_system && git fetch --all && git checkout master && git pull --ff-only
DRY_RUN=1 ./scripts/bootstrap.sh --env prod            # 先预演
./scripts/bootstrap.sh --env prod --admin-password '<强密码>' --with-front
```

仍需**环境侧**完成（非代码，见附录六）：
1. `deploy_environments.prod.ports` 从 3000 系列改为 6000 系列；
2. deploy-console 配 `PROD_SERVER` / `PROD_USER` / `PROD_KEY`；
3. prod 的 `.env.production` 与各服务 `.env` 就位（变量清单见 `ecosystem.config.js`）。

## 变更日志

- 2026-09-13 首版：确认"流水线无法发布后端到远程 prod"，给出 A/B/C/D 四路径与首次 bootstrap 清单。
- 2026-09-13 补第七节：落地 `bootstrap.sh` / `verify-backend.sh` / restart 首次纳管 / 清单防漂移。
