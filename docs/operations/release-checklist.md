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
- [ ] 手动补 pnpm 漏装的包（`ws`/`adm-zip`/...）从 mac rsync（见 5.5）
- [ ] workspace 包名兼容软链：`<DEPLOY_DIR>/node_modules/@<PROD_DOMAIN_NS>/agent-core → packages/agent-core`（见 5.6）
- [ ] 验：`cd <DEPLOY_DIR> && node -e "require('@<PROD_DOMAIN_NS>/agent-core'); console.log('OK')"` 打印 `OK`

---

## D. 服务 .env 补丁（5.7）

- [ ] 扫描 `REQUIRED_SERVICE_URLS_IN_PROD` 声明的 URL 全部填齐（清单见 [required-service-urls.md](./required-service-urls.md)）
- [ ] 当前 known：system-service 需 `AUTH_SERVICE_URL=http://127.0.0.1:6001`

---

## E. ecosystem 端口切 600x（5.8）

- [ ] `sed` 改 `PORT: 300x` → `PORT: 600x`（按服务列表）
- [ ] `sed` 改 `http://127.0.0.1:300x` → `http://127.0.0.1:600x`
- [ ] `sed` 改 `http://localhost:3000` → `http://localhost:6000`
- [ ] `pm2 reload ecosystem.config.js` + `pm2 save`

---

## F. SSL 层 + 安全组（5.9）

- [ ] SSH `<SSH_ALIAS_SSL>` 备份 nginx conf
- [ ] `sed` 改 `proxy_pass http://<PROD_HOST>:3000` → `:6000`
- [ ] `sudo nginx -t && sudo systemctl reload nginx`
- [ ] `sudo nginx -T | grep "proxy_pass http://<PROD_HOST>"` 确认已是 `6000`

---

## G. 验证（5.10）

- [ ] `sudo ss -lntp | grep -i node` 看到 `6000 6001 6002 6003 6004 6005 6006 6007` 全部
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
3. **dist 错**：`git checkout <old-commit>` → rebuild → rsync → `pm2 restart all`
4. **数据库错**：`mysql < /tmp/deploy-sync/dev-before-sync-XXX.sql`（会冲掉发布期间数据，慎用）

---

## J. 紧急联系

| 项 | 入口 |
|---|---|
| 腾讯云控制台（安全组 / SSL 证书） | https://console.cloud.tencent.com/ |
| 公网访问报错 | 先看 SSL 层 nginx error log：`ssh <SSH_ALIAS_SSL> 'sudo tail /var/log/nginx/error.log'` |
| 服务日志 | `ssh <SSH_ALIAS_PROD> "pm2 logs <svc> --lines 200"` |
| 数据库直查 | `mysql -h<DB_PUBLIC_HOST> -P<DB_PORT> -u<DB_USER> <DB_NAME_DEPLOY>` |
| 回滚 dist 所需的旧 commit | `git log origin/master --oneline | head -10` |