# web_system 发布规范

> 适用范围：`local` / `dev` / `prod` 三套环境的代码、数据库、依赖、nginx 的协调发布。
> 责任：发布人（按本文档执行 dev/prod 部署；local 在开发阶段自助）。
> 适用版本：`master` HEAD ≥ `5a74a19`（含 PR #151 域名迁移 + User.preferences 实体）。

---

## 一、三套环境拓扑

| 环境 | 机器 | 部署目录 | 数据库 | 公网域名 | 备注 |
|---|---|---|---|---|---|
| local | macOS 工作机（开发者自己的 MacBook） | `~/web_system_release` | `127.0.0.1:3306` `web_system_deploy` + `web_system` | 无 | 开发用参考库 |
| dev | `175.27.189.123`（ssh alias `kedou-dev`） | `/data/web_system` | `gz-cdb-8y2lp8rt.sql.tencentcdb.com:27241`（prod 服务通过 VPC 内网 `172.16.16.10` 连） | `dev.kedouai.com` | **生产预演** |
| prod | `106.52.176.246`（ssh alias `kedou-prod`） | `/data/web_system` | 同上（dev/prod **共用云库实例**） | `kedouai.com` / `admin.kedouai.com` / `api.kedouai.com` | 正式发布 |

辅助机器：

- **堡垒机** `101.43.117.234`（需 `~/.ssh/id_ed25519_lighthouse`）= `deploy-console` 控制台主机，**没有 release 目录**。dev/prod 发布不依赖堡垒机，只用其 console 做控制面板。
- **SSL 层** `42.194.200.69` = 反向代理机器（admin/api/kedouai → prod `6000`）；端口切换 + 证书都在这里。
- **mac release 目录** `~/web_system_release` = 发布源（git checkout master）。所有 prod 构建从这里开始。

> **dev 与 prod 共用云库实例**（`db.gz-cdb-8y2lp8rt.sql.tencentcdb.com:27241`，root / `gn%!CTvZNP0e4%Lc`）。发布 prod 时**不需要单独数据迁移**，只需要确认 prod 服务进程的 `DB_HOST` 正确。

---

## 二、代码流转

### 2.1 分支命名

| 前缀 | 触发 | 用途 |
|---|---|---|
| `feature/*` | auto-pr workflow 自动建 PR | 新功能 |
| `fix/*` | auto-pr workflow 自动建 PR | bugfix |
| `docs/*` | 手动 `gh pr create` 建 PR | 纯文档/规范/原型调整 |
| `release/*`（保留） | 本地（mac release 目录 checkout master） | 实际"发布中"状态不在分支 |

### 2.2 流程

```
feature/fix → push → auto-pr workflow 建 PR → CI（auto-pr + quality-gate 全绿）→ review → gh pr merge --merge → master 前推
```

master HEAD 即"待发布版本"。发布前必须确认：

- `gh pr view <N> --json state=merged` = `MERGED`
- `git log origin/master -1 --oneline` 含本次 commit

### 2.3 工具

- 本机 mysql 客户端：`export PATH=~/local/mysql-8.4.0-macos14-arm64/bin:$PATH`（密码用 `MYSQL_PWD` 环境变量传，含 `@`/`%!` 等特殊字符）。
- 远程：`ssh kedou-dev` / `ssh kedou-prod` / `ssh 101.43.117.234` / `ssh 42.194.200.69`（无需特别密钥，config 已有别名）。
- 堡垒机 console：`https://dev.kedouai.com/console/`（直接 web 用，监控/发布控制台）。

---

## 三、构建（mac release 目录）

`~/web_system_release` 是发布源，**必须先 git 同步到 master 最新**：

```bash
cd ~/web_system_release
git fetch origin && git merge --ff-only origin/master   # 必须 ff-only；非 ff 拒绝
```

### 3.1 完整构建脚本

```bash
cd ~/web_system_release

# 1. workspace 依赖（lockfile 已就绪通常 3-5s 增量）
pnpm install --prefer-offline

# 2. packages/types 必须先 build（所有服务的 devDep）
(cd packages/types && npm run build)   # 输出 dist/cjs/index.js（main 指向这）

# 3. 8 个服务的 nest build（并行）
for svc in gateway auth-service user-service ai-service system-service todo-service content-hub mcp-gateway; do
  (cd servers/$svc && pnpm build > /tmp/build-$svc.log 2>&1) &
done
wait

# 4. 验证：每个服务 dist/main.js 存在 + mtime 是今天
for svc in gateway auth-service user-service ai-service system-service todo-service content-hub mcp-gateway; do
  ls -la servers/$svc/dist/main.js | awk -v s=$svc '{print s, $6, $7, $8, $9}'
done
```

### 3.2 关键约束

- **types 必须先 build**：server 代码 `import from '@web-system/types'`，编译时 main 解析到 `dist/cjs/index.js`。types 缺失 → server dist 报 `Cannot find module '@web-system/types'`。
- **types/package.json 的 `exports` 字段**：CJS require 需要 `"require": "./dist/cjs/index.js"`；ESM import 需要 `"import": "./dist/index.js"`。少了任一项 → runtime 报错。
- **每个服务 dist/main.js 是 entry**；只要它存在就足以触发 require 链路；具体模块错位会在 runtime 报错，不在 build 时。

---

## 四、数据库同步

### 4.1 local → dev（生产预演）

dev 库与 local 库**字段集合应该一致**（dev 是新版实体 synchronize 漂移过）。同步流程：

```bash
# 0. 备份 dev（必做）
mysqldump -hgz-cdb-8y2lp8rt.sql.tencentcdb.com -P27241 -uroot \
  --single-transaction --set-gtid-purged=OFF --default-character-set=utf8mb4 \
  web_system_deploy > /tmp/deploy-sync/dev-before-sync-$(date +%Y%m%d-%H%M%S).sql

# 1. 列集合对比（每张表都要做）
for T in deploy_pipelines deploy_pipeline_steps deploy_pipeline_tasks ...; do
  L=$(... 列名集合 local ...)
  D=$(... 列名集合 dev ...)
  diff <(echo $L) <(echo $D) || echo "[$T] 列集差"
done

# 2. 导出本地（必须 -c，否则按位置插入必报错）
mysqldump -c -h127.0.0.1 -P3306 -uroot \
  --no-create-info --replace --single-transaction --set-gtid-purged=OFF \
  web_system_deploy \
  deploy_pipelines deploy_pipeline_steps deploy_pipeline_tasks deploy_pipeline_actions \
  deploy_pipeline_step_commands deploy_pipeline_vars deploy_module_stage_commands \
  deploy_modules deploy_tool_catalog \
  > /tmp/deploy-sync/local-pipeline-sync.sql

# 3. 导入 dev
mysql -hgz-cdb-8y2lp8rt.sql.tencentcdb.com -P27241 -uroot \
  --default-character-set=utf8mb4 web_system_deploy < /tmp/deploy-sync/local-pipeline-sync.sql

# 4. 校正环境归属（本地 dev 模板 env='local'，dev 视图看不到）
mysql ... -e "UPDATE deploy_pipelines SET env=NULL WHERE env='local';"

# 5. 清孤儿命令
mysql ... -e "DELETE FROM deploy_pipeline_step_commands WHERE template_id NOT IN (SELECT id FROM deploy_pipelines);"

# 6. collation 统一（dev 库 38 张表必须全 utf8mb4_0900_ai_ci，否则跨表 JOIN 报 ERROR 1267）
mysql ... -e "ALTER TABLE ... CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci; ALTER DATABASE web_system_deploy CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
```

### 4.2 dev → prod

**不迁移数据**。只需确认 prod 服务进程的 `DB_HOST=172.16.16.10`（VPC 内网，比公网域名快）。

### 4.3 schema 漂移管理（**必修**）

prod `NODE_ENV=production`，TypeORM `synchronize: false`。**新加列不会自动**。

发布前必走（漏了 → 500 错误）：

```bash
# 1. 扫实体注释找 DDL 提示
grep -rnE "ADD COLUMN|生产环境 synchronize|手工 DDL" packages/shared/src/entities/ packages/*/src/

# 2. dev 先 ALTER（验证 OK）
# 3. prod 后 ALTER（同一条 DDL）
# 4. 服务 restart 加载新 entity
```

反面（2026-09-24）：prod 漏跑 `ALTER TABLE users ADD COLUMN preferences json NULL` → admin 登录报 `Unknown column 'User.preferences' in 'field list'`。

### 4.4 不要同步的内容

| 表 | 原因 |
|---|---|
| `deploy_environments` | local prod public_url 已是 `kedouai.com`，dev 是 `portal.kedouai.com`，覆盖会改坏 dev 库 |
| `deploy_servers` | SSH 连接细节，与代码无关 |
| `config_items`（已有对应 env） | dev 已有自己的 dev 版，密文与 local 一致说明主密钥同源；直接覆盖可能改坏运行中配置 |
| `deploy_pipeline_runs` / `deploy_versions` / `deploy_deployments` / `deploy_release_locks` | 运行时数据 |
| `deploy_release_events`（已删模板的） | 幂等留痕，删了反而失去重复投递保护 |

---

## 五、prod 部署窗口（5-15 分钟停机）

### 5.1 前置检查

- [ ] master HEAD 含本次发布 PR（已 merge）
- [ ] mac release `git fetch + ff-merge + pnpm install + types build + 8 服务 nest build` 全 exit 0
- [ ] 扫实体注释 DDL → dev + prod ALTER 已完成
- [ ] 备份 dev 云库 + prod `ecosystem.config.js` + SSL 层 nginx conf
- [ ] 腾讯云安全组已放通 prod `6000-6007`（来自 SSL 层 + 公网）
- [ ] 业务侧已通知停机窗口

### 5.2 投递 dist + packages

```bash
# 8 服务 dist
for svc in gateway auth-service user-service ai-service system-service todo-service content-hub mcp-gateway; do
  rsync -az --delete ~/web_system_release/servers/$svc/dist/ \
    kedou-prod:/data/web_system/servers/$svc/dist/
done

# workspace 包：dist + package.json（name 字段必须新；types/dist/cjs 必须有）
for pkg in agent-core agent-message kedou-agent mcp-core shared shell-loader types; do
  rsync -az ~/web_system_release/packages/$pkg/dist/ \
    kedou-prod:/data/web_system/packages/$pkg/dist/
  rsync -az ~/web_system_release/packages/$pkg/package.json \
    kedou-prod:/data/web_system/packages/$pkg/package.json
done
```

### 5.3 prod 端重装依赖

```bash
ssh kedou-prod 'cd /data/web_system && CI=true pnpm install --prefer-offline --no-frozen-lockfile --shamefully-hoist'
```

> **`--shamefully-hoist` 必加**。pnpm 9 默认 isolated，body-parser 等 transitive 不会暴露到 root node_modules → 服务 require 时 MODULE_NOT_FOUND。
>
> `--no-frozen-lockfile`：prod lockfile 是 8/29 的，与 mac 不一致。允许 lockfile 重建。

### 5.4 同步 `.pnpm` 内 workspace 副本（**最隐蔽的坑**）

pnpm 用 `.pnpm/@web-system+shared@file+packages+shared_<hash>` 这样的虚拟 store 目录。**rsync 改了 `packages/shared/dist/`，`@web-system+shared*/node_modules/@web-system/shared/dist` 是独立副本，不会自动更新**：

```bash
ssh kedou-prod '
for pkg in shared types agent-core agent-message kedou-agent mcp-core shell-loader; do
  for d in /data/web_system/node_modules/.pnpm/@web-system+${pkg}@*/node_modules/@web-system/$pkg; do
    [ -d "$d" ] && rm -rf "$d/dist" && cp -r /data/web_system/packages/$pkg/dist "$d/dist" && echo "synced: $d"
  done
done
'
```

不补这步：`require('@web-system/shared')` 解析到旧副本，缺 `SERVICE_URL_DEFAULTS` → 服务启动时报 `Cannot read properties of undefined (reading 'auth')`。

### 5.5 手动补 pnpm 漏装的包

ws / adm-zip 等偶尔 pnpm 不装。从 mac rsync：

```bash
for pkg in ws adm-zip; do
  rsync -az ~/web_system_release/node_modules/$pkg/ kedou-prod:/data/web_system/node_modules/$pkg/
done
```

### 5.6 workspace 包名兼容软链

历史上 `packages/agent-core/package.json` name 是 `@kedou/agent-core`，新版改为 `@kedouai/agent-core`。ai-service 代码引用的是新名 → 必须建软链：

```bash
ssh kedou-prod '
mkdir -p /data/web_system/node_modules/@kedouai
ln -sfn /data/web_system/packages/agent-core /data/web_system/node_modules/@kedouai/agent-core
'
```

> 验：`cd /data/web_system && node -e "require('@kedouai/agent-core'); console.log('OK')"` 应该打印 `OK`。

### 5.7 服务 `.env` 补丁

每个服务 .env 必须含代码里 `REQUIRED_SERVICE_URLS_IN_PROD` 声明的 URL，否则 Bootstrap 抛「生产环境缺少必需的服务地址」。

当前 known list（按代码扫描结果维护）：

- `system-service`：`AUTH_SERVICE_URL=http://127.0.0.1:6001`

> **prod 端口由 `ecosystem.config.js` 的 env 块控制，不是 `.env` 的 PORT**。pm2 start 时 dotenv 不覆盖已存在的 env。`.env` 加 `PORT=6000` 是无效的。

### 5.8 ecosystem.config.js 端口切 600x

dev/prod 端口约定都是 `6000-6007`：

```bash
ssh kedou-prod '
cd /data/web_system
cp ecosystem.config.js ecosystem.config.js.bak-$(date +%Y%m%d)-pre600x

# 改 PORT（每个服务一行）
sed -i "s|        PORT: 3000,|        PORT: 6000,|g;
        s|        PORT: 3001,|        PORT: 6001,|g;
        s|        PORT: 3002,|        PORT: 6002,|g;
        s|        PORT: 3003,|        PORT: 6003,|g;
        s|        PORT: 3004,|        PORT: 6004,|g;
        s|        PORT: 3005,|        PORT: 6005,|g" ecosystem.config.js

# 改 gateway 找后端服务的 URL + PUBLIC_URL
sed -i "s|http://127.0.0.1:3001|http://127.0.0.1:6001|g;
        s|http://127.0.0.1:3002|http://127.0.0.1:6002|g;
        s|http://127.0.0.1:3003|http://127.0.0.1:6003|g;
        s|http://127.0.0.1:3004|http://127.0.0.1:6004|g;
        s|http://localhost:3000|http://localhost:6000|g" ecosystem.config.js

# 重启（pm2 reload 逐个 stop+start；mcp-gateway/content-hub 端口已是 600x，不受影响）
pm2 reload ecosystem.config.js
pm2 save
'
```

### 5.9 SSL 层 nginx + 安全组

SSL 层 `42.194.200.69`（不是 prod 机器）：

```bash
ssh 42.194.200.69 '
sudo cp /etc/nginx/conf.d/admin.conf{,.bak-$(date +%Y%m%d)-600x}
sudo cp /etc/nginx/conf.d/api.conf{,.bak-$(date +%Y%m%d)-600x}
sudo cp /etc/nginx/conf.d/default.conf{,.bak-$(date +%Y%m%d)-600x}
sudo sed -i "s|http://106.52.176.246:3000|http://106.52.176.246:6000|g" \
  /etc/nginx/conf.d/{admin,api,default}.conf
sudo nginx -t && sudo systemctl reload nginx
sudo nginx -T 2>/dev/null | grep "proxy_pass http://106" | head -5
'
```

腾讯云控制台 → 安全组 → prod 机器（`106.52.176.246`）入站放通 `TCP 6000-6007`（来自 `42.194.200.69` + 公网）。

### 5.10 验证

```bash
# 8 服务都监听 6000-6007
ssh kedou-prod 'sudo ss -lntp | grep -i node'

# 公网健康检查
curl -sk -o /dev/null -w "kedouai %{http_code} %{time_total}s\n" https://kedouai.com/api/health
curl -sk -o /dev/null -w "admin   %{http_code} %{time_total}s\n" https://admin.kedouai.com/

# 业务核心
curl -sk -X POST https://kedouai.com/api/ai/chat \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"ping"}]}' -o /dev/null -w "ai chat %{http_code}\n"

# pm2 持久化
ssh kedou-prod 'pm2 save'
```

---

## 六、健康检查的真正路径

`deploy-console` 的 `monitor.healthCheck` **走 SSH 到目标机**后 `curl http://127.0.0.1:<port>`，**不是公网直连**：

```typescript
// servers/deploy-console/src/monitor/monitor.service.ts:215-219
const url = service.address.includes('://') ? service.address : `http://${service.address}`;
const command = `curl -s -o /dev/null -w "%{http_code}:%{time_total}" --connect-timeout 3 ${url}/ || echo "000:0"`;
const output = await this.execSsh(sshConfig, command);  // ← SSH 到目标机执行
```

所以：

- prod 服务 `address` 必须填 `127.0.0.1:<port>`（目标机回环）
- 不要写公网域名+内部端口（`kedouai.com:6003` 这种）。SSL 层不转发内部端口，prod 机上 curl 公网域名+内部端口**不通过**
- dev 同理：`127.0.0.1:<port>`

---

## 七、回滚预案

发布前必做：

| 类型 | 备份位置 |
|---|---|
| dev 云库整库 | `/tmp/deploy-sync/dev-before-sync-YYYYMMDD-HHMMSS.sql` |
| mac release dist（旧版本） | `git checkout master@{1}` 重新 build 后再 rsync |
| prod `ecosystem.config.js` | `ecosystem.config.js.bak-YYYYMMDD-preXXX` |
| prod nginx conf（SSL 层） | `/etc/nginx/conf.d/*.bak-YYYYMMDD-XXX` |
| prod 数据库（发布前） | `mysqldump --single-transaction` 整库 |

按紧急程度选：

```bash
# 1. 服务回滚（最快：ecosystem + pm2 reload）
ssh kedou-prod 'cd /data/web_system && mv ecosystem.config.js.bad ecosystem.config.js && pm2 reload ecosystem.config.js'

# 2. SSL nginx 回滚（秒级）
ssh 42.194.200.69 'sudo cp /etc/nginx/conf.d/admin.conf.bak-XXX /etc/nginx/conf.d/admin.conf && sudo systemctl reload nginx'

# 3. dist 回滚（用旧 commit 重新构建 + rsync）
git checkout <old-commit>
for svc in ...; do (cd servers/$svc && pnpm build); done
for svc in ...; do rsync -az servers/$svc/dist/ kedou-prod:/data/web_system/servers/$svc/dist/; done
ssh kedou-prod 'pm2 restart all'

# 4. 数据库回滚（最重：会冲掉发布期间数据）
mysql -h... web_system_deploy < /tmp/deploy-sync/dev-before-sync-XXX.sql
```

---

## 八、发布检查清单（执行单）

详见 [release-checklist.md](./release-checklist.md)。

---

## 九、故障排查

| 现象 | 排查方向 |
|---|---|
| `Cannot find module 'xxx'` | pnpm install 漏装 / 没 hoist → 重跑 `pnpm install --shamefully-hoist`，缺包 mac rsync |
| `Cannot read 'auth' of undefined` | `.pnpm` 内 shared 副本未更新 → `cp -r packages/shared/dist .pnpm/...shared/dist` |
| `Cannot find module '@kedouai/agent-core'` | workspace 包名兼容 → 建软链 `node_modules/@kedouai/agent-core → packages/agent-core` |
| `生产环境缺少必需的服务地址：AUTH_SERVICE_URL` | 服务 .env 漏 → 追加 SERVICE_URL + restart |
| `Unknown column 'xxx' in 'field list'` | 实体注释 DDL 没跑 → ALTER + restart |
| 公网 502 | nginx 指向错 / 安全组未放通 / 服务监听在 127.0.0.1 |
| pm2 reload 后服务仍 3000 端口 | `ecosystem.config.js` 没改 / reload 没生效 |
| 跨表 JOIN 报 `ERROR 1267 Illegal mix of collations` | 库表 collation 不一致 → ALTER TABLE CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci + ALTER DATABASE |
| 服务启动后立刻退（重启循环） | 看 `pm2 logs <svc>` 第一条 ERROR，多半是 MODULE_NOT_FOUND 或 SERVICE_URL 缺 |

---

## 附录 A：本规范制定时的踩坑时间线（2026-09-23~24）

1. **dev 流水线配置不是最新**：local → dev 同步。
   - dev 表列顺序与 local 不一致（dev 是新版实体 synchronize 重排过）→ mysqldump 必须带 `-c`
   - 22 张表 collation `utf8mb4_unicode_ci` + 16 张 `utf8mb4_0900_ai_ci`，跨表 JOIN 报 ERROR 1267 → 统一 38 张 0900_ai_ci
   - 7 条 dev 临时流水线「默认 #N」+ 6 条孤儿 step_commands → 删除
2. **`portal.kedouai.com` 失效**：16 条 `public_url` + 5 条 `address` + 1 条 `ports` + `sites.host` 全部替换；SSL nginx-proxy.conf 证书路径保留只加失效警告。
3. **prod 端口漂移**：prod 跑的是 29 天前的旧构建（pm2 uptime 29D），旧版默认 PORT=3000。ecosystem 切 600x + reload + SSL nginx 改 + 安全组放通。
4. **prod 依赖落后 29 天**：
   - body-parser 没装（nest 10+ 间接 require）→ `pnpm install --shamefully-hoist`
   - ws/adm-zip 没装 → mac rsync
   - `.pnpm` 内 shared 副本没更新 → `cp -r packages/shared/dist .pnpm/...shared/dist`
   - `packages/agent-core` name 是 `@kedou/agent-core`（旧），mac 是 `@kedouai/agent-core`（新）→ 软链
   - system-service 缺 `AUTH_SERVICE_URL` → 补 .env
5. **prod `User.preferences` 列缺失**：实体注释里的 DDL 提示没扫 → admin 登录 500。

## 附录 B：相关文件索引

- `docs/architecture/release-system-design.md` — 部署平台架构设计（"做什么"）
- `docs/operations/release-pipeline.md`（本文档）— 发布规范（"怎么做"）
- `docs/operations/release-checklist.md` — 发布执行单（"逐项打勾"）
- `scripts/migrations/p2-ports-to-addresses.mjs` — 已迁移过的 P2 脚本参考
- `nginx-proxy.conf` / `nginx-server.conf` / `local.nginx.conf` — 反向代理模板
- `servers/deploy-console/src/monitor/monitor.service.ts` — 健康检查实现
- `servers/deploy-console/src/envs/envs.service.ts` — 内置 prod 站点 seed