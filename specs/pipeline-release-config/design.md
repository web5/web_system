# 流水线配置完善（git URL 显式化 · 发布节点按环境分支 · admin 线合并）

> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
> 定位：本轮流水线「配置层面」完善的设计、执行与验收口径 —— 不改表结构、不改执行链路，只改配置与节点脚本正文。
> 配套：`specs/pipeline-env-scripts/design.md`（环境级脚本列的备选方案，本轮不采用）、`specs/config-driven-deploy/design.md`（配置中心全量注入）

---

## 1 现状（实测，本机库 `127.0.0.1/web_system_deploy`）

| 事实 | 证据 |
|---|---|
| git URL **不在任何配置里** | `git-step.sh` 只在发布目录跑 `git remote get-url origin` 校验「有 origin」；实际来源 = 发布目录自身 origin（实测 `git@github.com:web5/web_system.git`）。代码来源在流水线里不可见、不可配，origin 被改错也不拦截 |
| 流水线 17 条 | 16 条 p12 合并线（`env=NULL`）+ `admin-local`（2026-09-20 新建）。环境已是运行期参数 |
| admin 两条线**只有 release 不同** | `admin-local` / `admin-dev` 的 `git` / `build` / `restart` / `verify` 节点正文逐字节一致；release 分别是「本机 cp」与「scp 到 `PUBLISH_HOST`」 |
| 远程投递参数在流水线变量 | `admin-dev`：`PUBLISH_HOST=175.27.189.123`、`PUBLISH_USER=ubuntu`、`PUBLISH_PATH=/data/web_system/servers/gateway/public/static/modules/admin` |
| git 节点是**普通可编辑节点** | 正文存 `deploy_pipeline_step_commands`（每条流水线一份），代码只提供新建时的初始正文、不覆盖 → 改 git 脚本 = 改配置 |
| **节点执行体在 `actions` 列，不在 `command` 列** | `pickStepActions()`：actions 非空 → 取 `actions[].code`（shell 操作）/ `tool`（service 操作）执行；**仅当 actions 为空才回落到 `command` 列**。故改脚本必须两处都写，否则页面看着改了、执行仍是旧脚本 |

---

## 2 目标 / 非目标

**目标**

1. **git URL 显式化**：配置中心 global 配 `REPO_URL`，git 脚本校验 origin 与之一致并回显，换仓库只改一处。
2. **发布节点按环境分支**：一份 release 脚本内 `case $DEPLOY_ENV`（`local` 本机 cp / 其他 scp），后续新增环境分支直接改脚本。
3. **admin 收敛为一条流水线**：删除 `admin-local`，投递逻辑并入 `admin 发布`。

**非目标**

- 不改表结构、不加 `env` 列（`specs/pipeline-env-scripts/design.md` 的环境级脚本方案本轮不采用）。
- 不动 `PipelineService` 执行链路与接口契约。
- 不同步云库（本轮只调本机库，本地验证通过后再议）。

---

## 3 设计

### 3.1 `REPO_URL`（配置中心 global）

| 项 | 值 |
|---|---|
| 表 | `config_items` |
| 行 | `scope='global'`、`envId=''`、`moduleKey=''`、`key='REPO_URL'` |
| value | `git@github.com:web5/web_system.git` |
| 生效方式 | 配置中心已全量注入各阶段变量（含 git 阶段），脚本直接读 `$REPO_URL` |

git 节点脚本改造（在现有「① 必须有 origin」之后追加「①-2 代码来源自证」）：

```bash
ORIGIN_URL="$(git remote get-url origin)"
echo "[git] origin=$ORIGIN_URL"

# ①-2 代码来源自证：配置中心 REPO_URL（global）非空时，origin 必须与之完全一致
#      存在意义：历史高危场景 = 发布目录 origin 被改错后照常构建，代码来源在流水线里不可见
if [ -n "${REPO_URL:-}" ] && [ "$ORIGIN_URL" != "$REPO_URL" ]; then
  echo "[git] 代码来源不符: 期望 $REPO_URL 实际 $ORIGIN_URL" >&2
  echo "[git] 处置：核对配置中心 REPO_URL 或修正发布目录 origin" >&2
  exit 1
fi
```

- 未配置 `REPO_URL` → 行为与现状一致（只校验「有 origin」），零破坏。
- 源码 `src/pipeline/scripts/git-step.sh` 同步加同段（否则新建流水线拿不到初始校验），单测补断言。

### 3.2 发布节点按环境分支

> ⚠️ **写脚本必须同时写 `actions[].code` 与 `command` 列**（真相源见 §1 与 `pickStepActions`）：
> `admin-dev` 的 release 是「多操作」节点 —— `actions = [shell(投递) , service(write-version)]`，
> 只改 `command` 列时页面显示已生效，实际仍执行旧脚本（已实测复现：`env=local` 仍 scp 到 dev 机）。

```bash
ENV_ID="${DEPLOY_ENV:-local}"
case "$ENV_ID" in
  local)  # 本机投递：<RELEASE_DIR>/servers/gateway/public/static/modules/<key>/<env>/<commit>
    ...cp...
  *)      # 远程投递：打包 → scp → 目标机解包到 $PUBLISH_PATH/$VER（保持 dev 既有布局，不加 env 子目录）
    ...scp...
esac
```

- `VER="${COMMIT_ID##*/}"`（R6 下 `COMMIT_ID` 是完整引用 `default/<commit>`）。
- 参数缺失（`BUILD_OUTPUT_DIR` / `PUBLISH_HOST` / `PUBLISH_PATH` / `COMMIT_ID`）→ fail-fast。
- 新增环境分支 = 在 `case` 里加一段，不动数据模型。

### 3.3 admin 流水线合并

| 动作 | 对象 |
|---|---|
| 保留并改写 release | `admin 发布`（`tpl-admin-dev` / key `admin-dev`） |
| 删除 | `admin 本地发布`（`tpl-1789875044581-vrnfbh1` / key `admin-local`）及其 `deploy_pipeline_step_commands`、`deploy_pipeline_vars` |
| 变量 | `PUBLISH_*` 保留在 `admin-dev`（已有） |

---

## 4 执行

迁移脚本 `scripts/migrations/p13-pipeline-release-config.mjs`（幂等，可重跑，支持 `DRY_RUN=1`）：

1. 备份到 `/tmp/p13-backup-<ts>.json`（config 行 + git/release 脚本 + admin-local 三表数据）。
2. 写 `REPO_URL`（`INSERT ... ON DUPLICATE KEY UPDATE`）。
3. 更新 17 条流水线的 git 节点脚本（已含 `REPO_URL` 标记则跳过；找不到锚点则跳过并报告）。
4. 改写 `admin-dev` 的 release 脚本；删除 `admin-local` 及关联配置。
5. `bash -n` 校验所有改写后的脚本（语法不过则不落库）。

连接默认本机库（`MYSQL_HOST=127.0.0.1` / `root` / `web_system_deploy`），可用 `MYSQL_*` 环境变量覆盖（后续同步云库时用）。

---

## 5 验收

| 判据 | 方法 |
|---|---|
| V1 配置可见 | `GET /api/config?scope=global` 含 `REPO_URL` |
| V2 脚本生效 | 改写后脚本 `bash -n` 通过；页面「流水线编辑 → git 节点」能看到 origin 校验段 |
| V3 来源拦截 | 临时把 `REPO_URL` 改错 → 提交发布 → **git 阶段失败且日志含「代码来源不符」** → 改回 |
| V4 本机投递 | 提交 `admin` + `env=local` → 产物落 `<RELEASE_DIR>/servers/gateway/public/static/modules/admin/local/<commit>/` |
| V5 收敛 | `GET /api/pipeline-templates` → 16 条，`admin` 恰好 1 条 |
| V6 dev 分支未回归 | 提交 `admin` + `env=dev`（可只跑到 release 前确认脚本解析到 scp 分支），dev 机产物布局不变（`$PUBLISH_PATH/$VER`，无 env 子目录） |

---

## 6 回退

- 删除 `config_items` 的 `REPO_URL` 行 → git 回落到「只校验有 origin」的旧行为。
- `/tmp/p13-backup-<ts>.json` 含全部改写前正文与 `admin-local` 数据，可整份还原。

---

## 常见问题

**Q：为什么不按 `specs/pipeline-env-scripts` 给 `deploy_pipeline_step_commands` 加 `env` 列、每环境一份脚本？**
A：那套要改实体、接口、执行链路与单测，收益是「脚本分开存」。本轮用户口径是**脚本内分支更直观、后续加分支直接改脚本**，且配置层面改动当天可验证。env 列方案留作备选，未被否决——若后续出现「同一节点的环境脚本需要独立权限/审计」再考虑。

**Q：`REPO_URL` 为什么放配置中心而不是写进脚本？**
A：git 脚本正文每条流水线一份（17 处），写死则换仓库要改 17 处且必然漂移；配置中心 global 一行，且未来按 env/module 覆盖（如某环境用镜像仓）无需改脚本。
