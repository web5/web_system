# web_system 发布规范

> 适用范围：`local` / `dev` / `prod` 三套环境的代码、数据库、依赖、nginx 的协调发布。
> 责任：发布人（按本文档执行 dev/prod 部署；local 在开发阶段自助）。
> 适用版本：`master` HEAD ≥ `5a74a19`（含 PR #151 域名迁移 + User.preferences 实体）。

## 〇、占位符约定（**必读**）

本文档不直接出现任何基础设施真实值（机器 IP、SSH 别名、数据库连接串、域名、仓库地址、密钥文件名）。所有具体值在文中以 `<PLACEHOLDER>` 表示，完整映射见团队凭证库（1Password vault `web_system-infra`，条目「发布基础设施占位符」）。

| 占位符 | 含义 | 取值方式 |
|---|---|---|
| `<PROD_HOST>` / `<DEV_HOST>` / `<SSL_PROXY_HOST>` / `<BASTION_HOST>` | 各机器 IP / 域名 | 凭证库 |
| `<SSH_ALIAS_PROD>` 等 | `~/.ssh/config` 里的 ssh 别名 | 凭证库 |
| `<DB_PUBLIC_HOST>` / `<DB_PRIVATE_HOST>` / `<DB_PORT>` | 云库公网域名 / VPC 内网 IP / 端口 | 凭证库 |
| `<DB_USER>` / `<DB_PASSWORD>` | 数据库账号 | 凭证库 |
| `<PROD_DOMAIN>` / `<ADMIN_DOMAIN>` / `<API_DOMAIN>` / `<DEV_DOMAIN>` | 公网生产域名 / admin / api / dev | 凭证库 |
| `<LEGACY_DOMAIN>` | 已失效的历史域名（不解析） | 凭证库 |
| `<PROD_DOMAIN_NS>` | 去掉 TLD 后的域名前缀（如 npm scope） | 凭证库 |
| `<REPO_ORG>` / `<REPO_NAME>` | GitHub org / 仓库名 | 凭证库 |
| `<SSH_KEY_FILE>` | 堡垒机专用私钥文件名 | 凭证库 |
| `<RELEASE_DIR>` | mac release 目录（默认 `~/web_system_release`） | 凭证库 |
| `<DEPLOY_DIR>` | 服务器部署目录（默认 `/data/web_system`） | 凭证库 |
| `<DB_NAME_DEPLOY>` | 云库 deploy 库名（默认值见凭证库） | 凭证库 |
| `<DB_NAME_APP>` | 云库应用库名（默认值见凭证库） | 凭证库 |

执行命令时把占位符**替换为实际值**再复制粘贴。复制整段 bash 但漏改占位符 = 静默失败。

---

## 一、三套环境拓扑

| 环境 | 角色 | 部署目录 | 数据库连接 | 公网入口 |
|---|---|---|---|---|
| local | 开发者 MacBook 上的参考环境 | `<RELEASE_DIR>` | `127.0.0.1:3306` 本地 MySQL | 无 |
| dev | 生产预演（代码、数据、依赖链路全部按 prod 走） | `<DEPLOY_DIR>`（`<DEV_HOST>`） | 云库 `<DB_PUBLIC_HOST>:<DB_PORT>` | `<DEV_DOMAIN>` |
| prod | 正式发布 | `<DEPLOY_DIR>`（`<PROD_HOST>`） | 同云库（dev/prod **共用实例**；prod 服务用 VPC 内网 `<DB_PRIVATE_HOST>` 连，更快） | `<PROD_DOMAIN>` / `<ADMIN_DOMAIN>` / `<API_DOMAIN>` |

辅助机器：

- **堡垒机** `<BASTION_HOST>`（需 `<SSH_KEY_FILE>`）= `deploy-console` 控制台主机，**没有 release 目录**。dev/prod 发布不依赖堡垒机，只用其 console 做控制面板。
- **SSL 层** `<SSL_PROXY_HOST>` = 反向代理机器（admin/api/<PROD_DOMAIN> → prod `6000`）；端口切换 + 证书都在这里。
- **mac release 目录** `<RELEASE_DIR>` = 发布源（git checkout master）。所有 prod 构建从这里开始。

> **dev 与 prod 共用云库实例**（连接信息见凭证库；root 账号 `<DB_USER>` / `<DB_PASSWORD>`）。发布 prod 时**不需要单独数据迁移**，只需要确认 prod 服务进程的 `DB_HOST` 正确指向 `<DB_PRIVATE_HOST>`。

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

- 本机 mysql 客户端：`export PATH=~/local/mysql-8.4.0-macos14-arm64/bin:$PATH`（密码用 `MYSQL_PWD` 环境变量传，避免命令行泄漏）。
- 远程：`ssh <SSH_ALIAS_DEV>` / `ssh <SSH_ALIAS_PROD>` / `ssh <SSH_ALIAS_BASTION>` / `ssh <SSH_ALIAS_SSL>`（config 已有别名）。
- 堡垒机 console：`https://<DEV_DOMAIN>/console/`（直接 web 用，监控/发布控制台）。
- 仓库地址：`github.com:<REPO_ORG>/<REPO_NAME>`（clone / fetch / PR URL 一律拼出来，不写死）。

---

## 三、构建（mac release 目录）

`<RELEASE_DIR>` 是发布源，**必须先 git 同步到 master 最新**：

```bash
cd <RELEASE_DIR>
git fetch origin && git merge --ff-only origin/master   # 必须 ff-only；非 ff 拒绝
```

### 3.1 完整构建脚本

```bash
cd <RELEASE_DIR>

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
mysqldump -h<DB_PUBLIC_HOST> -P<DB_PORT> -u<DB_USER> \
  --single-transaction --set-gtid-purged=OFF --default-character-set=utf8mb4 \
  <DB_NAME_DEPLOY> > /tmp/deploy-sync/dev-before-sync-$(date +%Y%m%d-%H%M%S).sql

# 1. 列集合对比（每张表都要做）
for T in deploy_pipelines deploy_pipeline_steps deploy_pipeline_tasks ...; do
  L=$(... 列名集合 local ...)
  D=$(... 列名集合 dev ...)
  diff <(echo $L) <(echo $D) || echo "[$T] 列集差"
done

# 2. 导出本地（必须 -c，否则按位置插入必报错）
mysqldump -c -h127.0.0.1 -P3306 -u<DB_USER> \
  --no-create-info --replace --single-transaction --set-gtid-purged=OFF \
  <DB_NAME_DEPLOY> \
  deploy_pipelines deploy_pipeline_steps deploy_pipeline_tasks deploy_pipeline_actions \
  deploy_pipeline_step_commands deploy_pipeline_vars deploy_module_stage_commands \
  deploy_modules deploy_tool_catalog \
  > /tmp/deploy-sync/local-pipeline-sync.sql

# 3. 导入 dev
mysql -h<DB_PUBLIC_HOST> -P<DB_PORT> -u<DB_USER> \
  --default-character-set=utf8mb4 <DB_NAME_DEPLOY> < /tmp/deploy-sync/local-pipeline-sync.sql

# 4. 校正环境归属（本地 dev 模板 env='local'，dev 视图看不到）
mysql ... -e "UPDATE deploy_pipelines SET env=NULL WHERE env='local';"

# 5. 清孤儿命令
mysql ... -e "DELETE FROM deploy_pipeline_step_commands WHERE template_id NOT IN (SELECT id FROM deploy_pipelines);"

# 6. collation 统一（dev 库 38 张表必须全 utf8mb4_0900_ai_ci，否则跨表 JOIN 报 ERROR 1267）
mysql ... -e "ALTER TABLE ... CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci; ALTER DATABASE <DB_NAME_DEPLOY> CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
```

### 4.2 dev → prod

**不迁移数据**。只需确认 prod 服务进程的 `DB_HOST=<DB_PRIVATE_HOST>`（VPC 内网，比公网域名快）。

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

反面（本规范制定时）：prod 漏跑 `ALTER TABLE users ADD COLUMN preferences json NULL` → admin 登录报 `Unknown column 'User.preferences' in 'field list'`。

### 4.4 不要同步的内容

| 表 | 原因 |
|---|---|
| `deploy_environments` | local prod `public_url` 已是 `<PROD_DOMAIN>`，dev 是 `<LEGACY_DOMAIN>`，覆盖会改坏 dev 库 |
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
  rsync -az --delete <RELEASE_DIR>/servers/$svc/dist/ \
    <SSH_ALIAS_PROD>:<DEPLOY_DIR>/servers/$svc/dist/
done

# workspace 包：dist + package.json（name 字段必须新；types/dist/cjs 必须有）
for pkg in agent-core agent-message kedou-agent mcp-core shared shell-loader types; do
  rsync -az <RELEASE_DIR>/packages/$pkg/dist/ \
    <SSH_ALIAS_PROD>:<DEPLOY_DIR>/packages/$pkg/dist/
  rsync -az <RELEASE_DIR>/packages/$pkg/package.json \
    <SSH_ALIAS_PROD>:<DEPLOY_DIR>/packages/$pkg/package.json
done
```

### 5.3 prod 端重装依赖

```bash
ssh <SSH_ALIAS_PROD> 'cd <DEPLOY_DIR> && CI=true pnpm install --prefer-offline --no-frozen-lockfile --shamefully-hoist'
```

> **`--shamefully-hoist` 必加**。pnpm 9 默认 isolated，body-parser 等 transitive 不会暴露到 root node_modules → 服务 require 时 MODULE_NOT_FOUND。
>
> `--no-frozen-lockfile`：prod lockfile 是旧的，与 mac 不一致。允许 lockfile 重建。

### 5.4 同步 `.pnpm` 内 workspace 副本（**最隐蔽的坑**）

pnpm 用 `.pnpm/@web-system+shared@file+packages+shared_<hash>` 这样的虚拟 store 目录。**rsync 改了 `packages/shared/dist/`，`@web-system+shared*/node_modules/@web-system/shared/dist` 是独立副本，不会自动更新**：

```bash
ssh <SSH_ALIAS_PROD> '
for pkg in shared types agent-core agent-message kedou-agent mcp-core shell-loader; do
  for d in <DEPLOY_DIR>/node_modules/.pnpm/@web-system+${pkg}@*/node_modules/@web-system/$pkg; do
    [ -d "$d" ] && rm -rf "$d/dist" && cp -r <DEPLOY_DIR>/packages/$pkg/dist "$d/dist" && echo "synced: $d"
  done
done
'
```

不补这步：`require('@web-system/shared')` 解析到旧副本，缺 `SERVICE_URL_DEFAULTS` → 服务启动时报 `Cannot read properties of undefined (reading 'auth')`。

### 5.5 手动补 pnpm 漏装的包

ws / adm-zip 等偶尔 pnpm 不装。从 mac release rsync：

```bash
for pkg in ws adm-zip; do
  rsync -az <RELEASE_DIR>/node_modules/$pkg/ <SSH_ALIAS_PROD>:<DEPLOY_DIR>/node_modules/$pkg/
done
```

### 5.6 workspace 包名兼容软链

历史上 `packages/agent-core/package.json` name 是 `@kedou/agent-core`，新版改为 `@<PROD_DOMAIN_NS>/agent-core`。ai-service 代码引用的是新名 → 必须建软链：

```bash
ssh <SSH_ALIAS_PROD> '
mkdir -p <DEPLOY_DIR>/node_modules/@<PROD_DOMAIN_NS>
ln -sfn <DEPLOY_DIR>/packages/agent-core <DEPLOY_DIR>/node_modules/@<PROD_DOMAIN_NS>/agent-core
'
```

> 验：`cd <DEPLOY_DIR> && node -e "require('@<PROD_DOMAIN_NS>/agent-core'); console.log('OK')"` 应该打印 `OK`。

### 5.7 服务 `.env` 补丁

每个服务 .env 必须含代码里 `REQUIRED_SERVICE_URLS_IN_PROD` 声明的 URL，否则 Bootstrap 抛「生产环境缺少必需的服务地址」。

当前 known list（按代码扫描结果维护，详见 [required-service-urls.md](./required-service-urls.md)）：

- `system-service`：`AUTH_SERVICE_URL=http://127.0.0.1:6001`

> **prod 端口由 `ecosystem.config.js` 的 env 块控制，不是 `.env` 的 PORT**。pm2 start 时 dotenv 不覆盖已存在的 env。`.env` 加 `PORT=6000` 是无效的。

### 5.8 ecosystem.config.js 端口切 600x

dev/prod 端口约定都是 `6000-6007`：

```bash
ssh <SSH_ALIAS_PROD> '
cd <DEPLOY_DIR>
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

SSL 层 `<SSL_PROXY_HOST>`（不是 prod 机器）：

```bash
ssh <SSH_ALIAS_SSL> '
sudo cp /etc/nginx/conf.d/admin.conf{,.bak-$(date +%Y%m%d)-600x}
sudo cp /etc/nginx/conf.d/api.conf{,.bak-$(date +%Y%m%d)-600x}
sudo cp /etc/nginx/conf.d/default.conf{,.bak-$(date +%Y%m%d)-600x}
sudo sed -i "s|http://<PROD_HOST>:3000|http://<PROD_HOST>:6000|g" \
  /etc/nginx/conf.d/{admin,api,default}.conf
sudo nginx -t && sudo systemctl reload nginx
sudo nginx -T 2>/dev/null | grep "proxy_pass http://<PROD_HOST>" | head -5
'
```

腾讯云控制台 → 安全组 → prod 机器（`<PROD_HOST>`）入站放通 `TCP 6000-6007`（来自 `<SSL_PROXY_HOST>` + 公网）。

### 5.10 验证

```bash
# 8 服务都监听 6000-6007
ssh <SSH_ALIAS_PROD> 'sudo ss -lntp | grep -i node'

# 公网健康检查
curl -sk -o /dev/null -w "prod   %{http_code} %{time_total}s\n" https://<PROD_DOMAIN>/api/health
curl -sk -o /dev/null -w "admin  %{http_code} %{time_total}s\n" https://<ADMIN_DOMAIN>/

# 业务核心
curl -sk -X POST https://<PROD_DOMAIN>/api/ai/chat \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"ping"}]}' -o /dev/null -w "ai chat %{http_code}\n"

# pm2 持久化
ssh <SSH_ALIAS_PROD> 'pm2 save'
```

---

## 五.A npm 依赖管理（**本节是本规范的核心**）

> 本节回答一个问题：**为什么 mac release 构建产物 rsync 到 prod 后，仍要跑 `pnpm install`？为什么还要补 .pnpm 副本、补 ws/adm-zip、还要 shamefully-hoist？** 把这套机制讲透，下次发布才能举一反三。

### 5.A.1 monorepo + pnpm isolated + 多机部署的依赖漂移根因

```
<RELEASE_DIR> (mac)
├── packages/{shared,agent-core,...}/   ← workspace 包源码
├── servers/{gateway,...}/           ← 服务源码（依赖 workspace 包）
├── pnpm-lock.yaml                   ← 锁定依赖图
└── node_modules/
    ├── .pnpm/                       ← 虚拟 store（所有依赖的实体副本）
    │   ├── @web-system+shared@file+packages+shared_<hash>/node_modules/@web-system/shared/
    │   ├── body-parser@1.20.3/node_modules/body-parser/
    │   └── ...
    ├── @web-system/shared -> ../../packages/shared (软链)
    ├── @web-system/agent-core -> ../../packages/agent-core
    └── ws/                           ← hoist 后的根副本（如果启用 shamefully-hoist）
```

发布到 prod 时 4 种东西要同步，**任一缺失就报错**：

| 东西 | 方式 | 为什么必须 |
|---|---|---|
| 8 个服务的 `dist/` | `rsync` | src/ 变了，prod 跑旧代码 |
| workspace 包的 `dist/` + `package.json` | `rsync` | src/ 变了 |
| workspace 包的 `.pnpm/.../@web-system/<pkg>/dist/` 副本 | `cp -r` | **mac 软链指向 `packages/`，prod 解析到 `.pnpm` 内的副本** |
| 第三方依赖（body-parser、ws 等）+ lockfile | `pnpm install` + `shamefully-hoist` | mac 的 `node_modules/` 不要整体 rsync（符号链接会断），要在 prod 重装 |

**根因**：mac 与 prod 是**两台独立的机器**，没有共享文件系统。monorepo workspace 在 mac 上是软链 → 在 prod 上必须落成真实副本。

### 5.A.2 pnpm config 与 `.npmrc`（统一规则）

发布依赖的关键开关：

```ini
# <RELEASE_DIR>/.npmrc
shamefully-hoist=true          # 把所有依赖 hoist 到 root node_modules（解决 transitive require 问题）
strict-peer-dependencies=false # peer dep 不严格匹配（nest 生态普遍宽松）
auto-install-peers=true        # peer 自动装
node-linker=isolated            # 默认；shamefully-hoist 是 isolated 的"豁免开关"
```

**`.npmrc` 必须随仓库 commit**：mac 与 prod 都要用同一份，否则 prod install 行为不一致。

```bash
# 发布前验证
git status .npmrc    # 必须 clean
cat .npmrc | grep -E '^(shamefully-hoist|strict-peer|auto-install-peers)'
```

### 5.A.3 lockfile 同步策略

`pnpm-lock.yaml` 是依赖图的唯一确定性来源。**mac 与 prod 必须一致**。

```bash
# 发布前同步 lockfile
rsync -az <RELEASE_DIR>/pnpm-lock.yaml <SSH_ALIAS_PROD>:<DEPLOY_DIR>/pnpm-lock.yaml

# 在 prod install
ssh <SSH_ALIAS_PROD> 'cd <DEPLOY_DIR> && pnpm install --frozen-lockfile --shamefully-hoist'
```

> `--frozen-lockfile` 比 `--no-frozen-lockfile` 严格：lockfile 与 `package.json` 不一致就报错，强迫你回到 mac 修。
>
> 例外场景：mac release 本身就漂了（比如临时改了 `package.json` 但没改 lockfile），用 `--no-frozen-lockfile` 重建并 commit 回仓库。

### 5.A.4 `pnpm deploy`（更系统的替代方案）

替代 5.3 + 5.4 + 5.5 + 5.6 的"手动软链/副本"组合：

```bash
# 在 mac 上：把服务打包成 standalone（含所有依赖的 resolved 副本）
cd <RELEASE_DIR>/servers/gateway
pnpm deploy --filter @web-system/gateway /tmp/deploy-gateway --prod

# 然后 rsync 到 prod（一次到位：服务 dist + node_modules 全在 /tmp/deploy-gateway 下）
rsync -az --delete /tmp/deploy-gateway/ <SSH_ALIAS_PROD>:<DEPLOY_DIR>/services/gateway/
```

`pnpm deploy` 的优点：

- 一次性解决 workspace 副本、transitive hoist、devDep 剔除
- 不依赖 `--shamefully-hoist`（因为是 standalone 目录，没有 root/子包的隔离问题）
- 不需要 5.6 的兼容软链（pack 时 name 已规整）

**何时不用 `pnpm deploy`**：

- monorepo 服务数 > 5（每个服务 deploy 一次太慢）
- 服务有特殊的启动脚本（如 pm2 fork 模式）
- 不熟悉 pnpm deploy 的副作用（参见 [pnpm deploy docs](https://pnpm.io/cli/deploy)）

> 本规范保留手写脚本作为基线方案；`pnpm deploy` 作为"长期优化"项。

### 5.A.5 第三方依赖漏装的发现方法

**症状**：`Cannot find module 'xxx'`、`MODULE_NOT_FOUND`

**系统化排查**（按顺序）：

```bash
# 1. mac 上看是否声明
grep -rn "require\(['\"]xxx" <RELEASE_DIR>/servers <RELEASE_DIR>/packages --include='*.ts'
# 或
pnpm why xxx                  # 看 xxx 是否在依赖图里

# 2. prod 上看是否真有装
ssh <SSH_ALIAS_PROD> 'ls <DEPLOY_DIR>/node_modules/xxx <DEPLOY_DIR>/node_modules/.pnpm/xxx* 2>&1'

# 3. mac 与 prod 对比依赖清单
ssh <SSH_ALIAS_PROD> 'cd <DEPLOY_DIR> && pnpm list --depth 99 --json' > /tmp/prod-deps.json
pnpm list --depth 99 --json > /tmp/mac-deps.json
diff <(jq -r '.[].dependencies | keys[]' /tmp/prod-deps.json | sort -u) \
     <(jq -r '.[].dependencies | keys[]' /tmp/mac-deps.json  | sort -u)

# 4. 漏的包：从 mac rsync（不要试图在 prod 装，可能引入 lockfile 漂移）
rsync -az <RELEASE_DIR>/node_modules/xxx/ <SSH_ALIAS_PROD>:<DEPLOY_DIR>/node_modules/xxx/
```

### 5.A.6 发布前依赖健康检查（新增）

发布前在 mac 跑一次 dry-run：

```bash
cd <RELEASE_DIR>

# 1. 审计（必须有审查流程处理 high/critical）
pnpm audit --prod
pnpm outdated

# 2. mac dry-run：模拟 prod 启动顺序，把每个服务的 require 链路跑一遍
for svc in gateway auth-service user-service ai-service system-service todo-service content-hub mcp-gateway; do
  (cd servers/$svc && NODE_ENV=production node -e "
    require('./dist/main.js');
    setTimeout(() => { console.log('[$svc] dry-run OK'); process.exit(0); }, 2000);
  " > /tmp/dryrun-$svc.log 2>&1) &
done
wait
grep -E 'Error|MODULE_NOT_FOUND' /tmp/dryrun-*.log || echo "all services require chain OK"
```

**dry-run 抓得到的问题**：

- 漏装的第三方依赖
- workspace 包名不匹配（如 5.6 的软链）
- service URL 缺值（5.7）
- entity 字段缺（4.3）

> dry-run 是 mock，不会真连数据库 / 启端口，但 require 链路 + Bootstrap 阶段的检查能跑。

### 5.A.7 长期方案（CI 自动发布）

把发布流水线化，避免手动 rsync + 手动 pnpm install：

```yaml
# .github/workflows/release-prod.yml（草案）
on:
  workflow_dispatch:
    inputs:
      confirm:
        description: 'Type "RELEASE" to confirm'
        required: true
jobs:
  release:
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile --shamefully-hoist
      - run: pnpm -r --filter './packages/*' build
      - run: pnpm -r --filter './servers/*' build
      - name: rsync to prod
        uses: appleboy/scp-action@master
        with:
          host: ${{ secrets.PROD_HOST }}
          username: ${{ secrets.PROD_SSH_USER }}
          key: ${{ secrets.PROD_SSH_KEY }}
          source: "servers/*/dist,packages/*/dist,packages/*/package.json,pnpm-lock.yaml,.npmrc"
          target: "<DEPLOY_DIR>/"
          strip_components: 0
      - name: prod install + reload
        uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.PROD_HOST }}
          username: ${{ secrets.PROD_SSH_USER }}
          key: ${{ secrets.PROD_SSH_KEY }}
          script: |
            cd <DEPLOY_DIR>
            pnpm install --frozen-lockfile --shamefully-hoist
            for pkg in shared types agent-core ...; do
              for d in node_modules/.pnpm/@web-system+${pkg}@*/node_modules/@web-system/$pkg; do
                [ -d "$d" ] && cp -r packages/$pkg/dist "$d/dist"
              done
            done
            pm2 reload ecosystem.config.js
            pm2 save
```

> CI 发布**前置依赖**：① GitHub Secrets 配齐 `<SSH_KEY>` 等；② prod 机器接受 GitHub Actions IP 段；③ 每次发布前 dry-run CI（避免阻塞 master）。

**当前状态**：手动发布为主。CI 发布作为 P1 优化项，跟后续依赖治理一起做。

---

## 六、健康检查的真正路径

`deploy-console` 的 `monitor.healthCheck` **走 SSH 到目标机**后 `curl http://127.0.0.1:<port>`，**不是公网直连**：

```typescript
// servers/deploy-console/src/monitor/monitor.service.ts
const url = service.address.includes('://') ? service.address : `http://${service.address}`;
const command = `curl -s -o /dev/null -w "%{http_code}:%{time_total}" --connect-timeout 3 ${url}/ || echo "000:0"`;
const output = await this.execSsh(sshConfig, command);  // ← SSH 到目标机执行
```

所以：

- prod 服务 `address` 必须填 `127.0.0.1:<port>`（目标机回环）
- 不要写公网域名+内部端口（`<PROD_DOMAIN>:6003` 这种）。SSL 层不转发内部端口，prod 机上 curl 公网域名+内部端口**不通过**
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
ssh <SSH_ALIAS_PROD> 'cd <DEPLOY_DIR> && mv ecosystem.config.js.bad ecosystem.config.js && pm2 reload ecosystem.config.js'

# 2. SSL nginx 回滚（秒级）
ssh <SSH_ALIAS_SSL> 'sudo cp /etc/nginx/conf.d/admin.conf.bak-XXX /etc/nginx/conf.d/admin.conf && sudo systemctl reload nginx'

# 3. dist 回滚（用旧 commit 重新构建 + rsync）
git checkout <old-commit>
for svc in ...; do (cd servers/$svc && pnpm build); done
for svc in ...; do rsync -az servers/$svc/dist/ <SSH_ALIAS_PROD>:<DEPLOY_DIR>/servers/$svc/dist/; done
ssh <SSH_ALIAS_PROD> 'pm2 restart all'

# 4. 数据库回滚（最重：会冲掉发布期间数据）
mysql -h<DB_PUBLIC_HOST> -P<DB_PORT> -u<DB_USER> <DB_NAME_DEPLOY> < /tmp/deploy-sync/dev-before-sync-XXX.sql
```

---

## 八、发布检查清单（执行单）

详见 [release-checklist.md](./release-checklist.md)。

---

## 九、故障排查

| 现象 | 排查方向 |
|---|---|
| `Cannot find module 'xxx'` | pnpm install 漏装 / 没 hoist → 重跑 `pnpm install --shamefully-hoist`，缺包 mac rsync（参见 5.A.5） |
| `Cannot read 'auth' of undefined` | `.pnpm` 内 shared 副本未更新 → `cp -r packages/shared/dist .pnpm/...shared/dist`（5.4） |
| `Cannot find module '@<PROD_DOMAIN_NS>/agent-core'` | workspace 包名兼容 → 建软链 `node_modules/@<PROD_DOMAIN_NS>/agent-core → packages/agent-core`（5.6） |
| `生产环境缺少必需的服务地址：AUTH_SERVICE_URL` | 服务 .env 漏 → 追加 SERVICE_URL + restart（5.7） |
| `Unknown column 'xxx' in 'field list'` | 实体注释 DDL 没跑 → ALTER + restart（4.3） |
| 公网 502 | nginx 指向错 / 安全组未放通 / 服务监听在 127.0.0.1 |
| pm2 reload 后服务仍 3000 端口 | `ecosystem.config.js` 没改 / reload 没生效 |
| 跨表 JOIN 报 `ERROR 1267 Illegal mix of collations` | 库表 collation 不一致 → ALTER TABLE CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci + ALTER DATABASE |
| 服务启动后立刻退（重启循环） | 看 `pm2 logs <svc>` 第一条 ERROR，多半是 MODULE_NOT_FOUND 或 SERVICE_URL 缺 |
| `dry-run` 报错但服务能起来 | dry-run 用的是 `dist/main.js` 静态 require；开了 lazy load 可能只在使用时才 require。建议 `node -e "require('./dist/main'); setTimeout(() => process.exit(0), 2000)"` 加等待 |

---

## 附录 A：本规范制定时的踩坑时间线

1. **dev 流水线配置不是最新**：local → dev 同步。
   - dev 表列顺序与 local 不一致（dev 是新版实体 synchronize 重排过）→ mysqldump 必须带 `-c`
   - 22 张表 collation `utf8mb4_unicode_ci` + 16 张 `utf8mb4_0900_ai_ci`，跨表 JOIN 报 ERROR 1267 → 统一 38 张 0900_ai_ci
   - 7 条 dev 临时流水线「默认 #N」+ 6 条孤儿 step_commands → 删除
2. **`<LEGACY_DOMAIN>` 失效**：16 条 `public_url` + 5 条 `address` + 1 条 `ports` + `sites.host` 全部替换；SSL nginx-proxy.conf 证书路径保留只加失效警告。
3. **prod 端口漂移**：prod 跑的是 29 天前的旧构建（pm2 uptime 29D），旧版默认 PORT=3000。ecosystem 切 600x + reload + SSL nginx 改 + 安全组放通。
4. **prod 依赖落后 29 天**（详见 §五.A）：
   - body-parser 没装（nest 10+ 间接 require）→ `pnpm install --shamefully-hoist`
   - ws/adm-zip 没装 → mac rsync
   - `.pnpm` 内 shared 副本没更新 → `cp -r packages/shared/dist .pnpm/...shared/dist`
   - `packages/agent-core` name 是旧 scope，mac 是新 scope → 软链
   - system-service 缺 `AUTH_SERVICE_URL` → 补 .env
5. **prod `User.preferences` 列缺失**：实体注释里的 DDL 提示没扫 → admin 登录 500。

## 附录 B：相关文件索引

- `docs/architecture/release-system-design.md` — 部署平台架构设计（"做什么"）
- `docs/operations/release-pipeline.md`（本文档）— 发布规范（"怎么做"）
- `docs/operations/release-checklist.md` — 发布执行单（"逐项打勾"）
- `docs/operations/required-service-urls.md` — 各服务 `.env` 必须声明的 URL 清单
- `scripts/migrations/p2-ports-to-addresses.mjs` — 已迁移过的 P2 脚本参考
- `nginx-proxy.conf` / `nginx-server.conf` / `local.nginx.conf` — 反向代理模板
- `servers/deploy-console/src/monitor/monitor.service.ts` — 健康检查实现
- `servers/deploy-console/src/envs/envs.service.ts` — 内置 prod 站点 seed
- 凭证库 1Password `web_system-infra` — 实际值映射（IP / 域名 / SSH 别名 / 凭证）

## 附录 C：占位符 ↔ 实际值映射

> **本附录故意留空**。所有实际值（机器 IP、SSH 别名、数据库连接、域名、密码、密钥路径）统一在 1Password vault `web_system-infra` 的「发布基础设施占位符」条目里维护。**不要把实际值 commit 到仓库任何文件**（包括注释、backup、changelog）。

完整占位符清单：见 §〇。