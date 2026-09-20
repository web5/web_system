# admin 发布到 dev · 发布脚本明细

> 类型：scripts.md（Design 阶段产物）
> 日期：2026-09-11
> 关联：设计 `design.md` · 接口 `api-design.md` · 任务 `tasks.md`
> 原则：**脚本承接一切非 DB 动作；DB 写操作只经接口。**

---

## 0. 通用约定

### 0.1 执行环境

| 项 | 值 |
|---|---|
| 执行机 | 本机（发布流水线所在机器），shell 为 `bash` |
| 执行方式 | 平台 `runStageCommand` 将命令文本交给 `CommandService.exec(cmd, cwd, env)` 执行；`cwd` = 模块目录（`apps/admin`） |
| 失败判定 | 退出码非 0 → 该阶段失败（stdio 写入流水线日志） |
| 超时 | 各节点 `timeout_sec`（upload 300 / verify 120 / restart 120 / cleanup 30） |

### 0.2 变量（平台下发）

**沿用**：`DEPLOY_ENV` `MODULE_KEY` `MODULE_TYPE` `MODULE_DIR` `BRANCH` `COMMIT_ID` `RELEASE_DIR` `PM2_NAME` `PORT` `PUBLIC_PATH` `ENTRY_FILE` `BUILD_OUTPUT_DIR` `ARTIFACT_DIR` `GATEWAY_URL` `GATEWAY_TTL_SEC` `KEEP_VERSIONS`

**新增（remote 模式）**：

| 变量 | 示例 | 来源 |
|---|---|---|
| `GIT_COMMIT` | `1a2b3c4` | 平台（纯短哈希；缺省用 `${COMMIT_ID##*/}` 兜底） |
| `REMOTE_HOST` | `{{DEV_HOST}}` | `deploy_servers.dev-default.host` |
| `REMOTE_USER` | `ubuntu` | `…sshUser` |
| `REMOTE_KEY` | `{{SSH_KEY_PATH}}` | `…sshKeyPath`（**平台展开为绝对路径**） |
| `REMOTE_DIR` | `/data/web_system` | `…remoteDir` |
| `REMOTE_ARTIFACT_DIR` | `/data/web_system/servers/gateway/public/static/modules/admin/default/1a2b3c4` | 平台拼装 |
| `REMOTE_GATEWAY_URL` | `https://dev.kedouai.com` | 配置中心（env=dev） |
| `REMOTE_CONSOLE_URL` | `http://{{DEV_HOST}}:6200` | 配置中心（env=dev） |
| `RELEASE_HOOK_SECRET` | `15ca…` | `.env`（两端同值） |

> ⚠️ `COMMIT_ID` = **完整引用**（`default/1a2b3c4`），用于产物路径与 manifest 断言；
> `GIT_COMMIT` = **纯短哈希**，用于接口 `commitId`。二者不可互换。

### 0.3 脚本落点

| 阶段 | 落点 | 理由 |
|---|---|---|
| `upload` / `verify` / `restart` / `cleanup` | DB `deploy_pipeline_step_commands`（本机默认模板，nodeKey 同名） | 可页面编辑、按环境调 |
| `git` | DB `deploy_pipeline_step_commands`（nodeKey=`git`，**`locked=true`**，迁移/seed 写入） | 既进 DB 真相源（可审计/可 SQL 调/可随迁移同步），又不允许页面改（平台托管），见 S0 |
| `version` / `pointer` | 平台内置代码（`platform` 节点） | 发布语义真相源，不走脚本 |

---

## S0 · git（DB 脚本 · 平台托管 · **锁定不可编辑**）

> 落点：`deploy_pipeline_step_commands(template_id, node_key='git')`，由**迁移/seed** 写入并置 `locked=true`。
> 引擎优先执行本脚本；模板未 seed 时**回退内置 `PullExecutor`**（存量模板零回归）。

```bash
#!/usr/bin/env bash
# 阶段：git（platform 节点 · 平台托管，locked=true，页面只读）
# 依赖变量：RELEASE_DIR / BRANCH / COMMIT_ID / MODULE_* / WS_SAFE_DELETE
# 约束：机器无关 —— 只依赖「本机自身」变量，禁止引用 REMOTE_*（那是发起端概念）
# 稳定性：三处前置校验全部 fail-fast（见下方「脚本级 fail-fast」），不静默降级
set -euo pipefail

: "${RELEASE_DIR:?缺少 RELEASE_DIR（发布目录）}"
: "${BRANCH:?缺少 BRANCH}"

cd "$RELEASE_DIR"
[ -d .git ] || { echo "[git] 发布目录不是 git 仓库: $RELEASE_DIR（请先 git clone）" >&2; exit 1; }

# ① 必须有 origin：代码来源不可确认时不构建（防「拿本地工作区代码发出去」）
git remote get-url origin >/dev/null 2>&1 || {
  echo "[git] 未配置 origin: $RELEASE_DIR（git remote -v 自检；如需容忍本地仓库请改本脚本）" >&2
  exit 1
}

# ② 取回全部引用（失败即失败：离线/无凭证不允许用旧代码继续构建）
echo "[git] fetch --all --prune --tags"
git fetch --all --prune --tags

# ③ 检出目标分支：origin 优先；origin 与本地都没有 → 直接失败（不吞错误）
if git rev-parse --verify --quiet "refs/remotes/origin/${BRANCH}" >/dev/null; then
  git checkout -B "$BRANCH" "origin/${BRANCH}"
elif git rev-parse --verify --quiet "refs/heads/${BRANCH}" >/dev/null; then
  echo "[git] [warn] origin/${BRANCH} 不存在，回退本地分支 ${BRANCH}（代码来源非远端，请确认）" >&2
  git checkout -B "$BRANCH" "$BRANCH"
else
  echo "[git] 分支不存在: ${BRANCH}（origin 与本地均无）；请核对分支名或先 push" >&2
  exit 1
fi

# ④ 指定 commit → 必须可达，否则 fail-fast（绝不静默退回「分支最新」）
#    COMMIT_ID 在 R6 下是完整引用（default/<commit>），取末段作为 git 目标
TARGET="${COMMIT_ID##*/}"
if [ -n "$TARGET" ]; then
  git rev-parse --verify --quiet "${TARGET}^{commit}" >/dev/null || {
    echo "[git] commit 不可达: ${TARGET}（未 push 到 origin 或哈希错误）；请先 push 后重发" >&2
    exit 1
  }
  WANT=$(git rev-parse "${TARGET}^{commit}")   # 统一成全哈希，避免短哈希位数差异
  echo "[git] reset --hard ${TARGET}"
  git reset --hard "$WANT"

  # 脚本自证：HEAD 必须等于目标 commit（与平台断言互为双保险）
  GOT=$(git rev-parse HEAD)
  [ "$GOT" = "$WANT" ] || { echo "[git] 自检失败: HEAD=${GOT} 期望=${WANT}" >&2; exit 1; }
fi

# ⑤ 清理未跟踪文件（残留会污染构建）
git clean -fd

echo "[git] 就绪 HEAD=$(git rev-parse --short HEAD) branch=$(git rev-parse --abbrev-ref HEAD)（依赖同步与共享包预构建由平台随后执行）"
```

**平台职责（脚本之外，不写进脚本）**

| 项 | 说明 |
|---|---|
| 复用守卫 | `reuseArtifact=true` → 不执行本脚本（`step-registry` 守卫优先于脚本） |
| 版本回填 | 脚本成功后平台读 `ReleaseGitService.shortHead(RELEASE_DIR)` → `gitCommit`；`versionTag = <templateKey>/<commit>` |
| 一致性断言 | 入参指定 `commitId` 时，用**全哈希**比对（`git rev-parse --verify <commitId>^{commit}` 与 `HEAD`），不一致 fail-fast —— 避免短哈希位数差异误判 |
| 依赖同步 | `pnpm-lock.yaml` md5 变化才 `pnpm install --prefer-offline`（平台执行） |
| 共享包预构建 | `@web-system/shared` / `@web-system/types`（平台在 git 后执行一次，避免并发竞态） |
| 不可编辑 | `PUT`/`DELETE /api/pipeline-templates/:id/steps/git` → 400（`locked`）；UI 只读展示 |
| 两端一致 | 本机与 dev 机各随 console 迁移落一份；不一致以各自 DB 为准（本期远端 pull 被 reuse 跳过） |

**脚本级 fail-fast（为什么放脚本，以及和平台断言的分工）**

| 加固点 | 内置 `PullExecutor` 的行为 | 本脚本行为 | 为什么必须堵 |
|---|---|---|---|
| commit 可达性 | `rev-parse` 失败就**跳过 reset**，继续用分支最新代码构建 | 不可达 → **exit 1** | 静默降级 = 「传了版本引用却打出分支最新代码」，与历史上「传 versionTag 打出当前 HEAD」同源高危 |
| 分支解析 | `checkout -B origin/x 2>/dev/null \|\| 本地同名` —— 错误被吞，可能悄悄用本地分支 | origin 缺失 → warn 后退回本地；两者皆无 → **exit 1** | 不吞错误，代码来源可追溯 |
| origin 存在性 | 未校验（靠 `fetch` 失败兜底） | **显式校验**，缺失即 exit 1 | 无 origin 的仓库无法保证「代码 = 目标 commit」 |
| HEAD 自证 | 无 | `reset` 后自证 `HEAD == ${TARGET}` | 把错误锁在 git 阶段（日志直指原因），不拖到 version/pointer 之后 |

**分工（双保险，各管一段）**

- **脚本**：管「本次拉码动作正确」—— 前置校验 + 自证，错误在 **git 阶段**暴露，日志自带可操作提示（先 push / 核对分支名）
- **平台**：管「结果与入参一致」—— 回填 `gitCommit`/`versionTag` 并对入参做全哈希断言；**对未 seed 脚本走内置的模板同样生效**（脚本可被换掉，端到端契约不能只靠脚本）

**作用目录 / 谁执行**（沿用现状，未变）：执行进程自己的 `RELEASE_DIR` —— 本机 `{{RELEASE_DIR}}`；dev 机 `/data/web_system`（git clone、master、origin 可达，已实测）。本机流水线跑本机脚本（服务本机构建），远端 console 跑它自己的脚本，本机**不** ssh 过去跑 git。

**本期远端是否触发**：**否** —— hook 带 `commitId` + S1 已投递产物 → 远端 `check` 命中 → `reuseArtifact=true` → `git`/`build`/`upload`/`restart` 全跳过；仅当远端无该产物时才会真正拉码（即 design R2）。

**分支与代码确定性**（详见 design 决策 8）

| 项 | 说明 |
|---|---|
| 拉哪个分支 | 入参 `branch`（页面/MCP 选择，来源 `GET /api/modules/:key/branches`），缺省 `master`；`prod` 强制 `master` |
| 最终代码 | `git reset --hard ${COMMIT_ID##*/}` —— **代码由 commit 决定，分支只决定 fetch 来源与检出名** |
| 怎么确认 | 脚本输出 `[git] HEAD=<短哈希>`；平台回填 `gitBranch`/`gitCommit` 到流水线；`version` 阶段写入 `deploy_versions`（含 `git_branch`/`git_commit`）；产物路径与 manifest 引用 `default/<commit>` |

**排障**（脚本自带可操作提示）：非 git 仓库 → `发布目录不是 git 仓库`（提示 clone）；无 origin → `未配置 origin`；分支不存在 → `分支不存在: <branch>`（核对分支名或先 push）；commit 未 push → `commit 不可达: <hash>`（先 push 再重发）；`git fetch` 鉴权失败 → 查该机 `~/.ssh` 与该目录 `git remote -v`；脚本被改坏 → `GET /pipeline-templates/:id/steps` 核对脚本文本，或重跑迁移重置。

---

## S1 · upload（remote）：产物投递

```bash
#!/usr/bin/env bash
# 阶段：upload（remote）—— 本机构建产物 → 目标环境应用机
# 依赖变量：BUILD_OUTPUT_DIR / MODULE_KEY / REMOTE_HOST / REMOTE_USER / REMOTE_KEY / REMOTE_ARTIFACT_DIR
set -euo pipefail

: "${BUILD_OUTPUT_DIR:?缺少 BUILD_OUTPUT_DIR}"
: "${MODULE_KEY:?缺少 MODULE_KEY}"
: "${REMOTE_HOST:?缺少 REMOTE_HOST（deploy_servers <env>-default 未配置）}"
: "${REMOTE_ARTIFACT_DIR:?缺少 REMOTE_ARTIFACT_DIR}"

[ -d "$BUILD_OUTPUT_DIR" ] || { echo "[upload] 本机产物目录不存在: $BUILD_OUTPUT_DIR" >&2; exit 1; }

# SSH key：~ 展开为绝对路径（POSIX 兼容写法）
if [ -n "${REMOTE_KEY:-}" ]; then
  case "$REMOTE_KEY" in "~"*) REMOTE_KEY="$HOME/${REMOTE_KEY#\~/}" ;; esac
fi

SSH_OPTS="-o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new"
[ -n "${REMOTE_KEY:-}" ] && SSH_OPTS="$SSH_OPTS -i $REMOTE_KEY"
TARGET="${REMOTE_USER:+${REMOTE_USER}@}${REMOTE_HOST}"

STAMP=$(date +%s)
TAR="/tmp/${MODULE_KEY}-${STAMP}.tar.gz"
REMOTE_TAR="/tmp/$(basename "$TAR")"

echo "[upload] 打包 $BUILD_OUTPUT_DIR → $TAR"
tar czf "$TAR" -C "$BUILD_OUTPUT_DIR" .

echo "[upload] 投递 → ${TARGET}:${REMOTE_TAR}"
scp $SSH_OPTS "$TAR" "${TARGET}:${REMOTE_TAR}"

ssh $SSH_OPTS "$TARGET" "DEST='${REMOTE_ARTIFACT_DIR}' TAR='${REMOTE_TAR}' bash -s" <<'REMOTE'
set -e
if [ -d "$DEST" ]; then
  mv "$DEST" "/tmp/old-$(basename "$(dirname "$DEST")")-$(basename "$DEST")-$(date +%s)"
fi
mkdir -p "$DEST"
tar xzf "$TAR" -C "$DEST"
rm -f "$TAR"
[ -f "$DEST/index.js" ] || { echo "[upload] 远端缺 index.js: $DEST" >&2; exit 1; }
echo "[upload:remote] 就绪：$DEST"
REMOTE

rm -f "$TAR"
echo "[pipeline:upload] ${MODULE_KEY} → ${TARGET}:${REMOTE_ARTIFACT_DIR}"
```

**要点**
- 旧目录用 `mv` 移出（不用 `rm -rf`），避免远端出现不可逆删除
- 解包后断言 `index.js` 存在（提前暴露"投递成功但内容为空"）
- 失败时 `ssh`/`scp` 的 stderr 会进流水线日志

---

## S2 · version + pointer（remote）：调远端接口

> 该阶段是 `platform` 节点，由平台代码执行（`design.md` P3/P4）；下面给出**等价 curl 脚本**，
> 既可作为实现参照，也可用于手工验证与排障。

```bash
#!/usr/bin/env bash
# 阶段：version + pointer（remote）—— 在目标环境控制台完成"写版本表 + 切指针"
# 依赖变量：REMOTE_CONSOLE_URL / RELEASE_HOOK_SECRET / DEPLOY_ENV / MODULE_KEY / BRANCH / GIT_COMMIT
set -euo pipefail

: "${REMOTE_CONSOLE_URL:?缺少 REMOTE_CONSOLE_URL（配置中心 env 级）}"
: "${RELEASE_HOOK_SECRET:?缺少 RELEASE_HOOK_SECRET}"
: "${MODULE_KEY:?}" "${DEPLOY_ENV:?}"

GIT_COMMIT="${GIT_COMMIT:-${COMMIT_ID##*/}}"
[ -n "$GIT_COMMIT" ] || { echo "[pointer] 无法确定 commit" >&2; exit 1; }

DELIVERY_ID="local-${GIT_COMMIT}-${MODULE_KEY}"
BODY=$(printf '{"deliveryId":"%s","env":"%s","moduleKey":"%s","branch":"%s","commitId":"%s","mode":"direct","source":"local-console"}' \
  "$DELIVERY_ID" "$DEPLOY_ENV" "$MODULE_KEY" "${BRANCH:-master}" "$GIT_COMMIT")

TS=$(date +%s)
SIG="sha256=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$RELEASE_HOOK_SECRET" | awk '{print $NF}')"

echo "[pointer] 调远端接口 ${REMOTE_CONSOLE_URL}/api/hooks/release（deliveryId=${DELIVERY_ID}）"
RESP=$(curl -fsS -X POST "${REMOTE_CONSOLE_URL}/api/hooks/release" \
  -H 'Content-Type: application/json' \
  -H "X-Ws-Timestamp: ${TS}" \
  -H "X-Hub-Signature-256: ${SIG}" \
  --data-binary "$BODY")
echo "[pointer] 远端受理: $RESP"
```

**响应与语义**

```json
{ "deliveryId": "local-1a2b3c4-admin", "duplicate": false, "jobId": "1789…-ab12cd3", "status": "pending" }
```

- `duplicate=true` → 该 `deliveryId` 已受理（幂等命中），视为成功
- 远端 `check` 发现 `modules/admin/default/<commit>/index.js` 已存在 → `reuseArtifact=true` → 跳过构建
- 本机**不等待**远端 job 终态：指针是否生效由 S3 的 manifest 断言闭环

---

## S3 · verify（remote 分支）：探活断言

> 落点：DB `deploy_pipeline_step_commands`（默认模板 `nodeKey='verify'`，**可页面编辑**）。
> **为什么不改 `verify.executor.ts`**：模板已配 `verify` 命令时，`executeStage` 的 `commandMode='override'` 会**覆盖内置执行体**（实测两端默认模板 verify 命令均为 `backend) ;; *) 跳过探活; exit 0`）→ 只改执行体的话断言永不执行。故断言写进 DB 命令（design 决策 7 / R9）。

```bash
#!/usr/bin/env bash
# 阶段：verify —— remote 断言分支（在既有 verify 命令上增量补充分派）
# 依赖变量：DEPLOY_ENV / MODULE_TYPE / REMOTE_GATEWAY_URL / MODULE_KEY / COMMIT_ID / PUBLIC_PATH / ENTRY_FILE / GATEWAY_TTL_SEC
set -euo pipefail

# ── ① 原有逻辑整段保留（local 或无远端地址 → 行为与改造前完全一致）──
if [ "${DEPLOY_ENV}" = "local" ] || [ -z "${REMOTE_GATEWAY_URL:-}" ]; then
  case "${MODULE_TYPE}" in
    backend)
      # …… 原有后端段（pm2 online 轮询 + /dev/tcp 端口探活）原样保留 ……
      ;;
    *)
      echo "[pipeline:verify] ${MODULE_TYPE} 跳过探活"
      exit 0
      ;;
  esac
  exit 0
fi

# ── ② remote 分支：远端 manifest 断言 + 产物可访问（新增）──
: "${MODULE_KEY:?}" "${COMMIT_ID:?}"
FULL_REF="$COMMIT_ID"              # 形如 default/1a2b3c4（完整引用）
ENTRY="${ENTRY_FILE:-index.js}"
TTL="${GATEWAY_TTL_SEC:-10}"

echo "[verify] 等待 gateway 版本缓存 ${TTL}s（+2s 余量）"
sleep $(( TTL + 2 ))

MANIFEST="${REMOTE_GATEWAY_URL}/__manifest__"
VER=$(curl -fsS "$MANIFEST" | python3 -c '
import sys, json
d = json.load(sys.stdin)
d = d.get("data", d)
mk = sys.argv[1]
print(next((m.get("version") for m in d.get("modules", []) if m.get("name") == mk), ""))
' "$MODULE_KEY")

if [ "$VER" != "$FULL_REF" ]; then
  echo "[verify] 失败：manifest 版本=${VER:-<缺失>}，期望=${FULL_REF}" >&2
  echo "[verify] 排查：① 远端指针是否已切（deploy_deployments）② TTL 是否已过 ③ 产物目录是否存在" >&2
  exit 1
fi

ARTIFACT_URL="${REMOTE_GATEWAY_URL}/static/modules/${PUBLIC_PATH}/${FULL_REF}/${ENTRY}"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$ARTIFACT_URL")
if [ "$CODE" != "200" ]; then
  echo "[verify] 失败：产物不可访问 HTTP ${CODE} → ${ARTIFACT_URL}" >&2
  exit 1
fi

echo "[verify] OK manifest=${VER} artifact=HTTP ${CODE}"
```

**要点**
- 分派条件用 `DEPLOY_ENV` + `REMOTE_GATEWAY_URL`（两者都由平台下发）→ **local 零回归**，无需为 local 单独配一套命令
- 远端模板的 `verify` 命令**不改**（仍跳过）：断言由发起端（本机流水线）兜住，避免双口径
- 若模板未配 `verify` 命令 → 内置 `VerifyExecutor` 兜底（前端 manifest 断言 / 后端 pm2+端口探活）

---

## S4 · restart（remote，backend）：SSH 重启

> 本期 admin 是 `micro-frontend`，该脚本会直接跳过；为后续后端模块预留。

```bash
#!/usr/bin/env bash
# 阶段：restart（remote，backend）—— 目标机 pm2 重启
set -euo pipefail

case "${MODULE_TYPE}" in
  backend) ;;
  *) echo "[restart] ${MODULE_TYPE} 无服务进程，跳过"; exit 0 ;;
esac
: "${REMOTE_HOST:?}" "${PM2_NAME:?}"

case "${REMOTE_KEY:-}" in "~"*) REMOTE_KEY="$HOME/${REMOTE_KEY#\~/}" ;; esac
SSH_OPTS="-o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new"
[ -n "${REMOTE_KEY:-}" ] && SSH_OPTS="$SSH_OPTS -i $REMOTE_KEY"
TARGET="${REMOTE_USER:+${REMOTE_USER}@}${REMOTE_HOST}"

ssh $SSH_OPTS "$TARGET" "MODULE_KEY='${MODULE_KEY}' PM2_NAME='${PM2_NAME}' REMOTE_DIR='${REMOTE_DIR}' bash -s" <<'REMOTE'
set -e
cd "$REMOTE_DIR"
PM2="$(command -v pm2 || echo /usr/bin/pm2)"
NAME=$("$PM2" jlist | MODULE_KEY="$MODULE_KEY" PM2_NAME="$PM2_NAME" python3 -c '
import sys, json, os
mk = os.environ["MODULE_KEY"]; pm2n = os.environ.get("PM2_NAME", "")
base = mk[:-8] if mk.endswith("-service") else mk
cands = [pm2n, "web-" + mk, "web-" + base, mk, base]
procs = {p["name"] for p in json.load(sys.stdin)}
print(next((c for c in cands if c and c in procs), ""))
')
[ -n "$NAME" ] || { echo "[restart] 未找到 pm2 进程（候选 $PM2_NAME / web-$MODULE_KEY）" >&2; exit 1; }
"$PM2" restart "$NAME" --update-env
echo "[restart:remote] 已重启 $NAME"
REMOTE
```

> dev 机 pm2 进程名**无 `web-` 前缀**（`gateway` / `system-service` …），候选列表已覆盖两种命名。

---

## S5 · cleanup（remote，可选 · 二期）

```bash
#!/usr/bin/env bash
# 阶段：cleanup（remote）—— 目标机保留最近 KEEP_VERSIONS 个版本
set -euo pipefail
: "${REMOTE_HOST:?}" "${MODULE_KEY:?}"
KEEP="${KEEP_VERSIONS:-5}"

case "${REMOTE_KEY:-}" in "~"*) REMOTE_KEY="$HOME/${REMOTE_KEY#\~/}" ;; esac
SSH_OPTS="-o BatchMode=yes -o ConnectTimeout=15"
[ -n "${REMOTE_KEY:-}" ] && SSH_OPTS="$SSH_OPTS -i $REMOTE_KEY"
TARGET="${REMOTE_USER:+${REMOTE_USER}@}${REMOTE_HOST}"

ssh $SSH_OPTS "$TARGET" "ROOT='${REMOTE_DIR}/servers/gateway/public/static/modules/${PUBLIC_PATH}' KEEP='${KEEP}' bash -s" <<'REMOTE'
set -e
[ -d "$ROOT" ] || exit 0
cd "$ROOT"
# 结构：<templateKey>/<commit>/ ；按目录 mtime 倒序保留最近 KEEP 个
for tpl in */; do
  [ -d "$tpl" ] || continue
  ( cd "$tpl" && ls -1dt */ 2>/dev/null | tail -n +$((KEEP+1)) | while read -r d; do
      [ -n "$d" ] && mv "$d" "/tmp/old-$(basename "$tpl")-$(basename "$d")-$(date +%s)" 2>/dev/null || true
    done )
done
echo "[cleanup:remote] 保留最近 ${KEEP} 个版本：$ROOT"
REMOTE
```

---

## S6 · 端到端演练脚本（本机一键，链路验证用）

> 用途：**在 console 能力改造落地前**先验证全链路；或改造后作为排障基线。
> 正式路径仍是「页面 / Agent → 流水线」。
> 注：步骤 1「本机拉码」是**手工模拟** S0 的 `git` 脚本（DB 锁定脚本；未 seed 时回退内置 `PullExecutor` / `ReleaseGitService`）。

```bash
#!/usr/bin/env bash
# scripts/publish-admin-to-dev.sh —— 手工演练：本机构建 → 投递 → 远端切版本 → 探活
# 用法：BRANCH=feature/xxx ./scripts/publish-admin-to-dev.sh
set -euo pipefail

BRANCH="${BRANCH:-master}"
RELEASE_DIR="${RELEASE_DIR:-{{RELEASE_DIR}}}"
REMOTE_HOST="{{DEV_HOST}}"; REMOTE_USER="ubuntu"; REMOTE_KEY="$HOME/.ssh/id_ed25519_servers"
REMOTE_DIR="/data/web_system"
REMOTE_GATEWAY="https://dev.kedouai.com"
REMOTE_CONSOLE="http://{{DEV_HOST}}:6200"
MODULE_KEY="admin"; MODULE_DIR="admin"; PUBLIC_PATH="admin"; TPL_KEY="default"
: "${RELEASE_HOOK_SECRET:?请先 export RELEASE_HOOK_SECRET（与 dev 机同值）}"

SSH_OPTS="-o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new -i $REMOTE_KEY"
TARGET="${REMOTE_USER}@${REMOTE_HOST}"

# 1) 本机拉码
cd "$RELEASE_DIR"
git fetch origin
git checkout "$BRANCH"
git pull --ff-only
C=$(git rev-parse --short HEAD); echo "commit=$C"

# 2) 本机构建
cd "$RELEASE_DIR/apps/$MODULE_DIR"
[ -d dist ] && mv dist "/tmp/admin-dist-$(date +%s)"
RELEASE_TAG="$TPL_KEY/$C" MF_FORMAT=system node "$RELEASE_DIR/node_modules/vite/bin/vite.js" build --mode mf

# 3) 投递
ARTIFACT_DIR="$REMOTE_DIR/servers/gateway/public/static/modules/$PUBLIC_PATH/$TPL_KEY/$C"
TAR="/tmp/${MODULE_KEY}-${C}.tar.gz"; REMOTE_TAR="/tmp/$(basename "$TAR")"
tar czf "$TAR" -C dist .
scp $SSH_OPTS "$TAR" "${TARGET}:${REMOTE_TAR}"
ssh $SSH_OPTS "$TARGET" "DEST='$ARTIFACT_DIR' TAR='$REMOTE_TAR' bash -s" <<'REMOTE'
set -e
[ -d "$DEST" ] && mv "$DEST" "/tmp/old-admin-$(date +%s)"
mkdir -p "$DEST" && tar xzf "$TAR" -C "$DEST" && rm -f "$TAR"
echo "[upload] $DEST"
REMOTE
rm -f "$TAR"

# 4) 远端切版本（接口，HMAC）
BODY=$(printf '{"deliveryId":"local-%s-%s","env":"dev","moduleKey":"%s","branch":"%s","commitId":"%s","mode":"direct","source":"local-console"}' \
  "$C" "$MODULE_KEY" "$MODULE_KEY" "$BRANCH" "$C")
TS=$(date +%s)
SIG="sha256=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$RELEASE_HOOK_SECRET" | awk '{print $NF}')"
echo "[pointer] 远端受理："
curl -fsS -X POST "$REMOTE_CONSOLE/api/hooks/release" \
  -H 'Content-Type: application/json' -H "X-Ws-Timestamp: $TS" -H "X-Hub-Signature-256: $SIG" \
  --data-binary "$BODY"; echo

# 5) 探活
sleep 12
VER=$(curl -fsS "$REMOTE_GATEWAY/__manifest__" | python3 -c '
import sys, json
d = json.load(sys.stdin); d = d.get("data", d)
print(next((m.get("version") for m in d.get("modules", []) if m.get("name") == "admin"), ""))
')
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$REMOTE_GATEWAY/static/modules/$PUBLIC_PATH/$TPL_KEY/$C/index.js")
echo "[verify] manifest=$VER（期望 $TPL_KEY/$C）artifact=HTTP $CODE"
[ "$VER" = "$TPL_KEY/$C" ] && [ "$CODE" = "200" ] && echo "✅ 发布成功" || { echo "❌ 发布失败"; exit 1; }
```

---

## S7 · 排障速查

```bash
# 本机流水线日志
curl -s "http://127.0.0.1:6200/api/pipelines/<jobId>" -H "Authorization: Bearer $JWT" | jq '.logs[-20:]'

# 远端产物是否存在
ssh -i ~/.ssh/id_ed25519_servers ubuntu@{{DEV_HOST}} \
  'ls -l /data/web_system/servers/gateway/public/static/modules/admin/default/'

# 远端指针
ssh -i ~/.ssh/id_ed25519_servers ubuntu@{{DEV_HOST}} \
  'MYSQL_PWD={{DEV_DB_PASSWORD}} mysql -h127.0.0.1 -uroot web_system -e \
   "select env_id,module_key,current_version,deployed_at from deploy_deployments where module_key=\"admin\";"'

# 远端 manifest（TTL 10s 后）
curl -s https://dev.kedouai.com/__manifest__ | python3 -m json.tool | head -20

# 远端流水线记录
ssh -i ~/.ssh/id_ed25519_servers ubuntu@{{DEV_HOST}} \
  'MYSQL_PWD={{DEV_DB_PASSWORD}} mysql -h127.0.0.1 -uroot web_system -e \
   "select id,env,module_key,status,version_tag,start_time from deploy_pipelines order by start_time desc limit 5;"'
```

**常见故障对照**

| 现象 | 根因 | 处理 |
|---|---|---|
| `upload` 失败 `缺少 REMOTE_HOST` | `deploy_servers.<env>-default` 未配置 | 页面「服务器管理」补 `dev-default` |
| `pointer` 401 | 签名/时间窗/密钥不一致 | 核对两端 `RELEASE_HOOK_SECRET`；检查本机时钟 |
| `pointer` 返回后 manifest 仍旧 | TTL 未过 或 远端未切指针 | 等 12s 重试；查远端 `deploy_deployments` |
| `verify` `manifest 版本=<缺失>` | 远端产物/指针缺失，或模块名不匹配 | 查远端产物目录与注册表 |
| `verify` 日志只有「跳过探活」（无断言） | 走的是原有分支：`DEPLOY_ENV=local` 或 `REMOTE_GATEWAY_URL` 未下发 | 检查平台是否注入 remote 变量（design P1/P3）；这正是 R9 的「静默通过」路径 |
| `verify` 产物 404 | 投递路径与指针引用不一致 | 对比 `REMOTE_ARTIFACT_DIR` 与 `current_version` |
| 远端 `git` 节点切走分支 | **仅当远端无该 commit 产物时**才会真正 pull | 保证 hook 带 `commitId`（走 reuse）；如需彻底消除改用 4b |
| `git` 阶段报「发布目录不是 git 仓库」 | 该机 `RELEASE_DIR`/`RELEASE_WORKSPACE` 指向的目录不是 git clone | 在该机 `git clone git@github.com:web5/web_system.git <dir>`（或修正 `.env`）；未 seed 脚本时内置执行体会抛「发布目录不存在」 |
| `git` 阶段报「gitCommit 与 commitId 不一致」 | 脚本没真正切到目标 commit（或改了代码没改版本引用） | 检查脚本 `reset --hard` 分支与 `COMMIT_ID` 取值；重跑迁移重置脚本文本 |
| `git` 阶段报 `unknown revision` | 目标 commit 未 push 到 `origin`（`fetch --all` 取不到） | 先 push 该分支/commit，再重新提交发布 |
| 远端目录 HEAD 分支与预期不符 | 远端真拉过码且 `branch` 没传 → 兜底 `master` 并 `checkout -B master` | 提交时带上 `branch`（T5c）；核对 `deploy_versions.git_branch` |
| `git fetch` 卡住/鉴权失败 | 该机 release 目录缺 origin 凭证 | 核对 `~/.ssh` 与 `git remote -v`（`git ls-remote origin` 自检） |
| 页面想改 `git` 脚本被拒（400） | 该节点 `locked=true`（平台托管） | 预期行为；如需变更走迁移/seed（SQL），不要绕过 |
| 指针已切但产物 404（远端目录无该版本） | 本机 `reuseArtifact` 把 remote `upload` 也跳过了 | 见 design R6 / P9；remote 模式 upload 不得因本机 reuse 跳过 |

---

## 变更日志

| 日期 | 版本 | 说明 |
|---|---|---|
| 2026-09-11 | v0.1 | 初稿：S1~S7 脚本与排障 |
| 2026-09-11 | v0.2 | 新增 S0「代码拉取（复用平台内置，无脚本）」；0.3 落点表补 pull；S6 注明步骤 1 为手工模拟；排障补远端拉码/复用跳过 upload 三行 |
| 2026-09-11 | v0.3 | S0 改为可落库的 git 脚本（`deploy_pipeline_step_commands` + `locked`，迁移/seed 写入、页面只读）；补平台职责表（守卫/回填/一致性断言/依赖同步）与 git 排障四行 |
| 2026-09-11 | v0.4 | S3 改为 DB 命令（保留原有分支 + 增量 remote 断言；说明为何不改 `verify.executor.ts`）；排障补「verify 静默跳过」一行 |
| 2026-09-11 | v0.5 | S0 补「分支与代码确定性」表（拉哪个分支/最终代码由 commit 决定/四条确认途径）；排障补 unknown revision 与 HEAD 分支不符两行 |
| 2026-09-11 | v0.6 | S0 脚本加固：origin 存在性校验、分支解析不吞错、commit 可达性 fail-fast、reset 后 HEAD 自证；新增「脚本级 fail-fast（为什么放脚本 + 与平台断言分工）」；一致性断言改全哈希比对 |
