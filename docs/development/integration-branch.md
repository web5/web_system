# 集成分支 `feature/test` 与自动发布 watcher

> 面向本地开发/联调：多个功能分支先在 `feature/test` 上集成，再由发布目录自动全量发布到 `local` 环境。

---

## 1. 为什么有这个分支

本地只有一套发布目录（`~/web_system_release`）和一套跑在它上面的服务。如果每个功能分支都直接切发布目录验证，会互相覆盖、也无法同时验证多个分支的叠加效果。

因此约定一个**集成分支** `feature/test`：

```
feature/a ─┐
feature/b ─┼─→ PR（base = feature/test）→ 合并 → feature/test ─→ 发布目录自动同步 + 全量发布
feature/c ─┘
```

- `feature/test` 是**各功能 PR 的 base**（不是 master）；
- 它不往 master 提 PR（`auto-pr` workflow 已排除，避免噪音 PR）；
- 发布目录的 watcher 盯着它：**有新提交就自动全量发布**。

---

## 2. 本地全流程

```bash
# ① 功能分支开发完，推上去，提 PR 到 feature/test
git push -u origin feature/my-work
#    在 GitHub 上把 PR 的 base 选成 feature/test

# ② 合并后（watch 默认 30s 轮询）发布目录自动：git reset --hard → 全量发布
#    看进度：
pm2 logs web-release-watcher --lines 60

# ③ 手动触发一次（不等轮询）
cd ~/web_system_release && node scripts/watch-integration.mjs --once     # 有更新才发
cd ~/web_system_release && node scripts/watch-integration.mjs --force    # 无视状态立刻发
```

---

## 3. watcher 行为（`scripts/watch-integration.mjs`）

| 项 | 说明 |
|---|---|
| 轮询对象 | `origin/feature/test`（`--branch` 可改） |
| **跟随 master** | 每轮先检查 `origin/master` 是否已在集成分支祖先链里；缺就把 master 合进来并推送（**冲突只告警不推**，工作区脏则本轮跳过）。`--no-follow-master` 可关闭 |
| 触发条件 | 远程 commit ≠ 上次成功发布的 commit（状态存在 `<发布目录>/.watch-integration.state`） |
| 同步方式 | `git reset --hard origin/feature/test`；**工作区脏则跳过**（不覆盖人工改动，下轮重试） |
| 发布方式 | 经 deploy-console 流水线逐个模块发布（`env=local`，`branch=feature/test`） |
| 发布顺序 | 后端服务 → 前端/微前端 → **deploy-console 最后** |
| 失败处理 | 单模块失败/超时（20 分钟）只告警，继续后面的模块，最后汇总成功数 |
| 重复保护 | 发布期间不重复触发；watcher 重启后从状态文件继续 |

**为什么 deploy-console 排最后**：发布它会重启流水线引擎自己，若排在中间，会把它自己正在执行的流水线打断（这正是历史上踩过的同类问题）。

---

## 4. 常驻管理

```bash
# 启动（只应在本地发布目录；不要写进 ecosystem.config.cjs，避免 dev/prod 误启动）
cd ~/web_system_release
pm2 start scripts/watch-integration.mjs --name web-release-watcher --interpreter node
pm2 save

pm2 logs web-release-watcher --lines 80     # 看进度
pm2 restart web-release-watcher             # 改了脚本后重启
pm2 delete web-release-watcher              # 停掉自动发布
```

参数（都可用环境变量给）：

| 参数 | 默认 | 说明 |
|---|---|---|
| `--branch` | `feature/test` | 盯哪个远程分支 |
| `--interval` | `30` | 轮询间隔（秒） |
| `--env` | `local` | 发布目标环境（须与 gateway 的 `DEPLOY_ENV_ID` 一致） |
| `--console` | `http://127.0.0.1:6200` | deploy-console 地址 |
| `--dry-run` | — | 只打印计划，不执行 |
| `--once` / `--force` | — | 检查一次 / 无视状态立刻全量发一次 |
| `--no-follow-master` | — | 关闭"自动把 master 合进集成分支"（默认开启） |

前置条件（缺失会直接报错退出）：

1. 发布目录 git 工作区干净；
2. deploy-console 在跑，且其 `.env` 有 `ADMIN_USER` / `ADMIN_PASS`（脚本据此登录）；
3. `servers/gateway/.env` 的 `DEPLOY_ENV_ID` 与 `--env` 一致。

---

## 5. 排查

| 现象 | 原因/处理 |
|---|---|
| watcher 一直没动静 | `pm2 logs web-release-watcher` 看是否在等轮询；确认远程确实有新提交（`git fetch && git log origin/feature/test -1`） |
| 日志提示"工作区有未提交改动，跳过" | 发布目录被手工改脏了：`git status` 处理后即可，watcher 下一轮会重试 |
| 某个服务发布后仍是旧代码 | 典型的端口被**非 pm2 进程**占用（孤儿）：`lsof -nP -iTCP:<port> -sTCP:LISTEN`，其 pid 与 `pm2 jlist` 里的不一致就 kill 掉，然后重跑该模块 |
| 全量发布太频繁 | 调大 `--interval`，或临时 `pm2 delete web-release-watcher` |
