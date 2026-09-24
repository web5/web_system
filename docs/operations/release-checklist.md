# 发布检查清单（执行单）

> 速查版：每条都要勾选。完整规范见 [release-pipeline.md](./release-pipeline.md)。
> **占位符**：所有 `<PLACEHOLDER>` 见 1Password vault `web_system-infra`。

---

## A. 发布前（必查）

- [ ] **master HEAD 含本次 PR**：`gh pr view <N> --json state=merged` = `MERGED`
- [ ] **mac release 同步**：`cd <RELEASE_DIR> && git fetch && git merge --ff-only origin/master`
- [ ] **mac release 安装依赖**：`pnpm install --prefer-offline`（exit 0）
- [ ] **mac release types build**：`(cd packages/types && npm run build)`，`packages/types/dist/cjs/index.js` mtime 是今天
- [ ] **mac release 8 服务 build**：8 个 `servers/<svc>/dist/main.js` mtime 都是今天，build log 无 ERROR
- [ ] **mac release 发布前 dry-run**（5.A.6）：8 服务 `node -e "require('./dist/main')"` 全 OK，无 `MODULE_NOT_FOUND`
  - dry-run 判读：DB 连接类报错是「没带 env」的预期噪音；**`TypeError` / `Cannot find module` 才是真问题**（见 C 段「.pnpm 副本」与 2026-09-24 事故）
- [ ] **确认目标机的 env 来源**：`pm2 jlist | grep -E 'NODE_ENV|PORT'` 有值 → 环境变量在 **ecosystem 的 env 块**，重启必须走 E 段；服务的 `.env` 未必自足
- [ ] **扫实体注释 DDL**：`grep -rnE "ADD COLUMN|生产环境 synchronize|手工 DDL" packages/`
- [ ] **dev 库已 ALTER**（从实体注释里捞出的 DDL）
- [ ] **prod 库已 ALTER**（同一条 DDL）
- [ ] **备份 dev 库**：`/tmp/deploy-sync/dev-before-sync-YYYYMMDD-HHMMSS.sql`
- [ ] **备份 prod ecosystem**：`ecosystem.config.js.bak-YYYYMMDD-preXXX`
- [ ] **备份 SSL nginx**：`/etc/nginx/conf.d/*.bak-YYYYMMDD-XXX`
- [ ] **腾讯云安全组**放通 prod `6000-6007`（来自 `<SSL_PROXY_HOST>` + 公网）
- [ ] **业务侧已通知停机窗口**

---

## B. 投递（5.2）

- [ ] 8 服务 dist：`rsync -az --delete <RELEASE_DIR>/servers/<svc>/dist/ <SSH_ALIAS_PROD>:<DEPLOY_DIR>/servers/<svc>/dist/`
- [ ] workspace 包：`rsync -az <RELEASE_DIR>/packages/{shared,types,agent-core,...}/dist/` 与 `package.json`
- [ ] lockfile：`rsync -az <RELEASE_DIR>/pnpm-lock.yaml <SSH_ALIAS_PROD>:<DEPLOY_DIR>/pnpm-lock.yaml`
- [ ] `.npmrc`：`rsync -az <RELEASE_DIR>/.npmrc <SSH_ALIAS_PROD>:<DEPLOY_DIR>/.npmrc`

---

## C. prod 端依赖（5.3-5.6，最易出错）

- [ ] `pnpm install --prefer-offline --no-frozen-lockfile --shamefully-hoist`（必须带 `--shamefully-hoist`，见 5.A.2）
- [ ] 同步 `.pnpm` 内 workspace 包副本（`shared`/`types`/`agent-core`/...，见 5.4）
- [ ] **逐个服务核对 shared 的真实解析路径**（某些服务软链到 `.pnpm` 实体副本，只同步 `packages/shared/dist` 不够）：
  ```bash
  for d in <svc1> <svc2> ...; do t=$(readlink -f <DEPLOY_DIR>/servers/$d/node_modules/@<PROD_DOMAIN_NS>/shared); \
    echo "$d -> $t"; grep -q '<新导出的符号>' $t/dist/index.js && echo OK || echo '缺新符号 ✗'; done
  ```
  缺符号时把新 dist 同步进该 `.pnpm` 副本（或改软链指向 `packages/shared`）。
  症状：`TypeError: (0, shared_1.<Symbol>) is not a function`。
- [ ] 手动补 pnpm 漏装的包（`ws`/`adm-zip`/...）从 mac rsync（见 5.5）
- [ ] workspace 包名兼容软链：`<DEPLOY_DIR>/node_modules/@<PROD_DOMAIN_NS>/agent-core → packages/agent-core`（见 5.6）
- [ ] 验：`cd <DEPLOY_DIR> && node -e "require('@<PROD_DOMAIN_NS>/agent-core'); console.log('OK')"` 打印 `OK`

---

## D. 服务 .env 补丁（5.7）

- [ ] 扫描 `REQUIRED_SERVICE_URLS_IN_PROD` 声明的 URL 全部填齐（清单见 [required-service-urls.md](./required-service-urls.md)）
- [ ] 当前 known：system-service 需 `AUTH_SERVICE_URL=http://127.0.0.1:6001`

---

## E. ecosystem 端口切 600x（5.8）+ 重启方式

> ⚠️ **重启铁律：禁止用 `env -i` 清环境重启 prod。**
> prod 的 `PORT` / `NODE_ENV=production` / `DB_*` 写在 `ecosystem.config.js` 的 env 块里，服务的 `.env` **并不自足**
> （DB_HOST 可能是内网地址）。`env -i PATH=… pm2 start dist/main.js` 会把这些变量全清掉，后果（2026-09-24 实测）：
> - `NODE_ENV` 丢失 → TypeORM `synchronize=true` → 撞 MySQL 报错起不来；**且已起来的服务可能在无 `NODE_ENV` 下跑 synchronize，有动 schema 的风险**
> - `DB_*` 丢失 → `Access denied for user …`（回落到错误的默认凭据）
>
> 正确姿势（每台机器 env 来源不同，动手前按 A 段最后一条确认）：
> ```bash
> cd <DEPLOY_DIR> && pm2 start ecosystem.config.js --only <name>   # prod 是 .js；dev/local 是 .cjs
> pm2 save
> ```

- [ ] `sed` 改 `PORT: 300x` → `PORT: 600x`（按服务列表）
- [ ] `sed` 改 `http://127.0.0.1:300x` → `http://127.0.0.1:600x`
- [ ] `sed` 改 `http://localhost:3000` → `http://localhost:6000`
- [ ] `pm2 reload ecosystem.config.js` + `pm2 save`
- [ ] 重启后核对：`pm2 jlist | grep -E 'NODE_ENV|PORT'` 每服务的 `NODE_ENV=production` 与 `PORT` 都在位（不是空）
- [ ] 重启后核对：各服务 `/health` 返回 200，且 `lsof -tiTCP:<port>` 的占用者 == `pm2 pid <name>`

---

## F. SSL 层 + 安全组（5.9）

- [ ] SSH `<SSH_ALIAS_SSL>` 备份 nginx conf
- [ ] `sed` 改 `proxy_pass http://<PROD_HOST>:3000` → `:6000`
- [ ] `sudo nginx -t && sudo systemctl reload nginx`
- [ ] `sudo nginx -T | grep "proxy_pass http://<PROD_HOST>"` 确认已是 `6000`

---

## G. 验证（5.10）

- [ ] `sudo ss -lntp | grep -i node` 看到 `6000 6001 6002 6003 6004 6005 6006 6007` 全部
- [ ] 各服务 `curl 127.0.0.1:<port>/health` → 200（各服务已统一免鉴权 `/health`，见 specs/backend-health-endpoint/design.md）
- [ ] `https://<PROD_DOMAIN>/api/health` → 200
- [ ] `https://<ADMIN_DOMAIN>/` → 200
- [ ] `POST https://<PROD_DOMAIN>/api/ai/chat` → 200（业务核心）
- [ ] `pm2 save` 完成

---

## H. 发布后

- [ ] 监控 30 分钟确认无重启循环（`pm2 list` 看 `↻` 列）
- [ ] 看 `pm2 logs --lines 100` 无 ERROR
- [ ] 通知业务侧恢复

---

## I. 回滚（紧急程度由上到下）

1. **pm2 reload 错配**：`mv ecosystem.config.js.bad ecosystem.config.js && pm2 reload`
2. **nginx 错配**：`sudo cp /etc/nginx/conf.d/admin.conf.bak-XXX /etc/nginx/conf.d/admin.conf && sudo systemctl reload nginx`
3. **dist 错**：`git checkout <old-commit>` → rebuild → rsync → **`pm2 start ecosystem.config.js --only <name>`**（不要用 `env -i`，见 E 段铁律）
4. **数据库错**：`mysql < /tmp/deploy-sync/dev-before-sync-XXX.sql`（会冲掉发布期间数据，慎用）
5. **schema 被 synchronize 误动**（如误在无 `NODE_ENV` 下启动）：立即改回 `NODE_ENV=production` 重启止损，
   再比对 `information_schema.tables` 的 `create_time/update_time` 定位被重建的表，
   按业务库时间点备份恢复；发布前务必先做 A 段的库备份

---

## J. 紧急联系

| 项 | 入口 |
|---|---|
| 腾讯云控制台（安全组 / SSL 证书） | https://console.cloud.tencent.com/ |
| 公网访问报错 | 先看 SSL 层 nginx error log：`ssh <SSH_ALIAS_SSL> 'sudo tail /var/log/nginx/error.log'` |
| 服务日志 | `ssh <SSH_ALIAS_PROD> "pm2 logs <svc> --lines 200"` |
| 数据库直查 | `mysql -h<DB_PUBLIC_HOST> -P<DB_PORT> -u<DB_USER> <DB_NAME_DEPLOY>` |
| 回滚 dist 所需的旧 commit | `git log origin/master --oneline | head -10` |
---

## K. 安全门禁（每次发布必查）

> 详细规则见 [`docs/development/security-baseline.md`](../development/security-baseline.md)。本段是发布前的快速勾选清单。

### K.1 网络层
- [ ] **腾讯云安全组**：prod `6000-6007` TCP 入站已放通（来源：`<SSL_PROXY_HOST>` + 公网）
- [ ] **腾讯云安全组**：旧端口 `3000-3004` 已删除（避免被扫到）
- [ ] **VPC**：dev/prod 在同一 VPC，`<VPC_SUBNET_CIDR>` 子网互通

### K.2 主机层
- [ ] **SSH 公钥**：发布人 mac 的 `~/.ssh/id_ed25519.pub` 在 prod `~/.ssh/authorized_keys`
- [ ] **堡垒机白名单**：发布人账号已加
- [ ] **`<SSH_KEY_FILE>` 私钥**：在 `~/.ssh/`，权限 600，未过期
- [ ] **sudoers**：应用账号仅能 `systemctl` / `pm2 reload`，不能 su

### K.3 数据库层
- [ ] **云库 IP 白名单**：dev/prod 内网 IP 已加
- [ ] **应急办公 IP**：debug 用，到期移除
- [ ] **`<DB_USER>` 权限**：仅 SELECT/INSERT/UPDATE/DELETE on `<DB_NAME_DEPLOY>.*`，无 DROP/CREATE/ALTER
- [ ] **MySQL 强制 SSL**：`require_secure_transport = ON`

### K.4 凭证层
- [ ] **1Password `web_system-infra` vault**：本次发布涉及到的占位符 → 实际值映射已更新
- [ ] **凭证轮转**：90 天到期凭证已轮换（DB 密码 / GitHub PAT）
- [ ] **凭证不进 .env**：所有 SECRET_* / KEY_* 走 KMS / vault 引用

### K.5 仓库层
- [ ] **branch protection**：master 需 PR + 1 approval + CI 全绿（不能 force-push）
- [ ] **GitHub Secrets**：`PROD_SSH_KEY` / `PROD_HOST` 未过期，scope 限 `Environments=production`
- [ ] **GitHub PAT**：发布人 gh 工具用的 PAT 未过期

### K.6 第三方
- [ ] **腾讯云 RAM**：发布用 sub-account，权限 ≤ deploy + restart
- [ ] **npm token**：私有 scope token（如有）未过期

### K.7 审计
- [ ] **本周腾讯云安全组变更**：已 review（控制台 → 操作日志）
- [ ] **上周 SSH 登录异常**：已 review（`last -f /var/log/btmp`）
- [ ] **本月凭证库活动**：已 review（1Password Activity Log）
