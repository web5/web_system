# 后端 restart / verify 下沉为「发布流水线 action」

> 建立：2026-09-21 ｜ 状态：**已实施（local）并在本地验证通过**（dev / prod 待后续批次）
> 相关：`specs/pipeline-node-model/design.md`、`specs/pipeline-step-task/design.md`、`specs/pipeline-env-scripts/design.md`、`specs/pipeline-deploy-action/`、`docs/development/deploy-target-knowledge.md`
> 决策来源（2026-09-21 用户口径）：
> ① 后端 `restart` / `verify` **分别是 action，放在发布流水线里**；控制台 API 那套「部署」不再需要；
> ② 前端模块**保持现有流水线节点**，部署 = 重启刷新 shell 加载的资源。

---

## 0. 现状取证（本地库，2026-09-21 实测）

| 项 | 现状 | 证据 |
|---|---|---|
| 模板节点 | 16 个模板全是四节点：拉取代码 → 构建 → 发布确认 → 发布 | `deploy_pipeline_steps`（每模板 4 行） |
| 发布节点动作 | 普通 DB 脚本（`managed=0`）：投递产物 / 发布（远程） / write-version | `deploy_pipeline_actions` |
| restart / verify | 每个模板在 `deploy_pipeline_step_commands` 里都有两行、`locked=1`、正文=`exec bash $WS_PLATFORM_SCRIPTS_DIR/restart-backend.sh|verify-backend.sh` | 32 行（16×2） |
| **问题 1** | 模板 nodes 里**没有 restart/verify 节点** → 这两行是**孤儿数据，永不执行** | `deploy_pipelines.nodes` |
| **问题 2** | 真正让后端生效的是另一条路：控制台「服务详情 → 部署」→ `POST /api/services/:key/deploy` → `DeployService.deployVersion()` → `applyBackendVersion()`（版本目录 → `dist` + `pm2 restart`） | `deploy.service.ts` L340-448 |
| 平台代码位置 | `pipeline/scripts/restart-step.sh`（委托壳）、`verify-step.sh`（委托壳）、`restart-backend.sh`（依赖校验 + pm2 delete/start 干净启动 + 端口探活）、`verify-backend.sh`（在线 + 端口 + AI 链路） | 随 console dist 分发（nest-cli assets） |
| 托管机制 | `PLATFORM_STEP_SCRIPTS=[restart, verify]`，`PlatformScriptSeedService` 启动/提交时**覆盖写 DB**（`locked=true`、页面只读） | `step-scripts.ts` L39-42 |

**结论**：restart/verify 现在既不在流水线里跑（孤儿），实现又锁在平台代码里（不可页面编辑、换环境要改代码）。用户口径要的是把它俩变成**能被编辑、能在流水线里跑的 DB action**。

---

## 1. 目标 / 非目标

### 目标
- 后端（`MODULE_TYPE=backend`）发布流水线的**发布节点**里，`restart` / `verify` 各是一个 **shell action（正文存 DB）**，跑完即生效，无需再去控制台点「部署」。
- 平台代码退场：`PLATFORM_STEP_SCRIPTS` 不再托管 restart/verify；删除两个委托壳；`restart-backend.sh` / `verify-backend.sh` 的**正文内容**迁入 DB 脚本。
- 前端（micro-frontend / shell）**节点结构不变**：发布 = 投递产物 + write-version + 切指针；「部署」= shell 重载资源（已有：指针目录直出 + `version-check` 探测提示刷新）。

### 非目标
- 不做后端**远程**（dev/prod）发布的 restart/verify（远程后端发布能力本身就未实现，见 `specs/pipeline-node-model/`）。
- 不动前端节点、不给前端加 restart/verify。
- 不脚本化 `write-version.mjs` 这类平台**工具**（工具化调用 ≠ 实现托管，本次保留）。

---

## 2. 设计

### 2.1 后端发布节点的动作序列（改后）

```
发布 / local（task）
  ├─ 发布（投递产物 → servers/<dir>/<pipelineKey>/<commit>/）     ← 已有
  ├─ write-version · 写版本记录（deploy_versions）                  ← 已有
  ├─ restart · 落地并重启（版本目录 → dist + 依赖校验 + pm2）        ← 新增（DB action）
  └─ verify · 部署验证（在线 + 端口 + AI 链路 + 写指针）              ← 新增（DB action）
```

- 动作按 `sort` 串行；`restart` 失败即终止（后续不执行，指针不动 → 旧版本仍在跑，状态不撕裂）。
- `verify` 通过后才写指针（`deploy_deployments`），语义 = **「验证通过才算部署成功」**，回滚依据仍是该指针。
- 前端模板：上述两行不追加；发布节点保持「投递 + write-version + 切指针」。

### 2.2 `restart` action 正文（DB 脚本，草案）

职责 = 原 `restart-backend.sh`（依赖校验 + 干净重启）+ 原 `applyBackendVersion()` 的 local 落地（含产物守卫与 `dist.bak-*` 备份）。

```bash
#!/usr/bin/env bash
# 发布流水线 · restart（后端）：版本目录 → dist + 依赖校验 + pm2 干净重启
# 变量：RELEASE_DIR / MODULE_KEY / MODULE_DIR / MODULE_TYPE / COMMIT_ID
#       PM2_NAME / PM2_SCRIPT（默认 dist/main.js）/ PM2_CWD / PORT
set -euo pipefail
[ "${MODULE_TYPE:-}" = "backend" ] || { echo "[restart] MODULE_TYPE=${MODULE_TYPE:-未设置}，非后端模块，跳过"; exit 0; }
: "${RELEASE_DIR:?}" "${MODULE_KEY:?}" "${COMMIT_ID:?}"
SVC_DIR="${PM2_CWD:-$RELEASE_DIR/servers/${MODULE_DIR:-$MODULE_KEY}}"
VER_DIR="$SVC_DIR/$COMMIT_ID"
DST="$SVC_DIR/dist"
ENV_FILE="$SVC_DIR/.env"
PM2="${PM2_BIN:-$(command -v pm2 || echo "$RELEASE_DIR/node_modules/.bin/pm2")}"
env_get() { [ -f "$1" ] && sed -n "s/^$2=//p" "$1" | head -1 | tr -d '\r' || true; }
die() { echo "[restart] $*" >&2; exit 1; }

# ① 依赖校验：配置不完整 / 跨服务密钥不一致 ⇒ 不允许上线
case "$MODULE_KEY" in
  ai-agent)
    [ -n "$(env_get "$ENV_FILE" MCP_GATEWAY_URL)" ] || die \
      "ai-agent/.env 缺少 MCP_GATEWAY_URL —— 所有 MCP 能力都不会注册（运行时报「工具未注册」）"
    a="$(env_get "$ENV_FILE" MCP_CLIENT_KEY)"
    g="$(env_get "$RELEASE_DIR/servers/mcp-gateway/.env" MCP_CLIENT_KEY)"
    if [ -n "$a" ] && [ -n "$g" ] && [ "$a" != "$g" ]; then
      die "ai-agent.MCP_CLIENT_KEY 与 mcp-gateway.MCP_CLIENT_KEY 不一致 —— /mcp/tools/call 会 401"
    fi ;;
  mcp-gateway)
    t="$(env_get "$ENV_FILE" KNOWLEDGE_SERVICE_AUTH_CONFIG | sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
    k="$(env_get "$RELEASE_DIR/servers/knowledge-service/.env" INTERNAL_API_KEY)"
    if [ -n "$t" ] && [ -n "$k" ] && [ "$t" != "$k" ]; then
      die "mcp-gateway.KNOWLEDGE_SERVICE_AUTH_CONFIG.token 与 knowledge-service.INTERNAL_API_KEY 不一致 —— 会 4010"
    fi ;;
esac

# ② 产物守卫 + 落地（保留最近 3 份 dist.bak-*，可手工回滚）
[ -d "$VER_DIR" ] || die "版本目录不存在：$VER_DIR（build / 投递节点是否成功）"
[ -n "$(ls -A "$VER_DIR" | grep -v '\.tsbuildinfo$' || true)" ] || die \
  "版本目录没有有效产物（只有 tsbuildinfo？）：$VER_DIR"
rm -rf "$DST.bak-"* 2>/dev/null || true   # 旧的同秒备份先清，避免同名前缀堆积
[ -d "$DST" ] && mv "$DST" "$DST.bak-$(date +%s)"
mkdir -p "$DST" && cp -R "$VER_DIR"/. "$DST"/
ls -1dt "$DST".bak-* 2>/dev/null | tail -n +4 | xargs -r rm -rf   # 只留最近 3 份

# ③ 干净重启：进程环境只留 PATH/HOME/PORT（不用 restart --update-env，防 pm2_env 污染）
NAME="${PM2_NAME:-web-$MODULE_KEY}"
for occ in $(lsof -tiTCP:"${PORT:-0}" -sTCP:LISTEN 2>/dev/null || true); do
  if ! "$PM2" jlist 2>/dev/null | grep -q "\"pid\": *$occ"; then
    echo "[restart] 清理端口 ${PORT:-} 孤儿进程 $occ"; kill -9 "$occ" 2>/dev/null || true
  fi
done
"$PM2" delete "$NAME" >/dev/null 2>&1 || true
env -i PATH="$PATH" HOME="${HOME:-/root}" PORT="${PORT:-}" \
  "$PM2" start "$DST/$(basename "${PM2_SCRIPT:-dist/main.js}")" \
    --name "$NAME" --cwd "$SVC_DIR" --max-memory-restart 512M \
  || die "启动失败：$NAME（pm2 logs $NAME）"
"$PM2" save >/dev/null 2>&1 || true
echo "[restart] 已重建 $NAME（版本 $COMMIT_ID 已落到 dist）"
```

> ⚠️ 上面 `pm2 start` 的入口用 `$DST/$(basename PM2_SCRIPT)` 是因为 `PM2_SCRIPT=dist/main.js` 相对服务目录；实现时以「先 cd 到 `$SVC_DIR` 再 `pm2 start "${PM2_SCRIPT:-dist/main.js}"`」为准（两者等价，取更不易错的一种）。

### 2.3 `verify` action 正文（DB 脚本，草案）

职责 = 原 `verify-backend.sh`（进程在线 → 端口 → AI 链路）+ 通过后写指针。

```bash
#!/usr/bin/env bash
# 发布流水线 · verify（后端）：pm2 online → 端口 TCP → （MCP 相关）AI 链路 → 写指针
set -uo pipefail
[ "${MODULE_TYPE:-}" = "backend" ] || { echo "[verify] 非后端模块，跳过"; exit 0; }
: "${RELEASE_DIR:?}" "${MODULE_KEY:?}" "${COMMIT_ID:?}"
PM2="${PM2_BIN:-$(command -v pm2 || echo "$RELEASE_DIR/node_modules/.bin/pm2")}"
die() { echo "[verify] $*" >&2; exit 1; }
NAME="${PM2_NAME:-web-$MODULE_KEY}"
case "$MODULE_KEY" in ai-agent|mcp-gateway|knowledge-service) IS_MCP=1 ;; *) IS_MCP=0 ;; esac

# ① 进程在线（最多 12×2s）
ONLINE=""
for _ in $(seq 1 12); do
  ONLINE="$("$PM2" jlist 2>/dev/null | python3 -c "
import sys,json,os
try: procs={p['name']:(p.get('pm2_env') or {}).get('status') for p in json.load(sys.stdin)}
except Exception: sys.exit(0)
print('$NAME' if procs.get('$NAME')=='online' else '')" 2>/dev/null)"
  [ -n "$ONLINE" ] && break
  echo "[verify] 等待服务上线: $NAME"; sleep 2
done
[ -n "$ONLINE" ] || die "服务未在线：$NAME（pm2 logs $NAME）"

# ② 端口 TCP 探活
if [ -n "${PORT:-}" ]; then
  ok=0; for _ in 1 2 3; do (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null && { ok=1; break; }; sleep 2; done
  [ "$ok" = "1" ] || die "端口探活失败：127.0.0.1:$PORT 无响应"
  echo "[verify] 端口探活 $PORT: 健康"
fi

# ③ AI 链路端到端（仅 MCP 相关服务）
if [ "$IS_MCP" = "1" ]; then
  MCP_PORT="${MCP_PORT:-6006}"
  key="$(sed -n 's/^MCP_CLIENT_KEY=//p' "$RELEASE_DIR/servers/mcp-gateway/.env" 2>/dev/null | head -1 | tr -d '\r')"
  [ -n "$key" ] || echo "[verify] [WARN] 取不到 mcp-gateway.MCP_CLIENT_KEY，跳过 AI 链路"
  if [ -n "$key" ]; then
    resp=""; for i in 1 2 3; do
      resp="$(curl -s --max-time 10 -X POST "http://127.0.0.1:$MCP_PORT/mcp/tools/call" \
        -H "Authorization: Bearer $key" -H 'Content-Type: application/json' \
        -d '{"module":"knowledge","tool":"knowledge_list","args":{}}' 2>/dev/null || true)"
      [ -n "$resp" ] && break; echo "[verify] AI 链路重试 $i/3"; sleep 2
    done
    case "$resp" in
      "") die "AI 链路无响应（mcp-gateway / knowledge-service 未就绪）" ;;
      *4010*|*内部调用密钥无效*) die "内部鉴权失败：mcp-gateway token ≠ knowledge-service.INTERNAL_API_KEY" ;;
      *Unauthorized*) die "网关鉴权失败：调用方 MCP_CLIENT_KEY ≠ mcp-gateway.MCP_CLIENT_KEY（401）" ;;
      *) echo "[verify] AI 链路 knowledge_list OK" ;;
    esac
  fi
fi

# ④ 验证通过 → 写指针（deploy_deployments）
node "$WS_PLATFORM_SCRIPTS_DIR/write-pointer.mjs" "$MODULE_KEY" "$DEPLOY_ENV" "$COMMIT_ID" "${DEPLOYED_BY:-pipeline}"
echo "[verify] 验证通过并已切指针: $DEPLOY_ENV/$MODULE_KEY -> $COMMIT_ID"
```

### 2.4 指针写入（新增平台**工具**，非托管实现）

- 新增 `pipeline/scripts/write-pointer.mjs`（与 `write-version.mjs` 同构：读 console `.env` 连部署库，`upsert deploy_deployments(envId, moduleKey, currentVersion, status='deployed')`）。
- 定位澄清：这是**脚本调用的工具**，与 `write-version.mjs` 同级；restart/verify 的**业务实现**在 DB 脚本里，不在平台代码里 —— 与用户口径一致。
- 备选（不推荐）：脚本内联 `mysql` CLI 写库 → 会把连接口令散落到 DB 配置里。

### 2.5 平台代码退场范围

| 文件 | 处置 |
|---|---|
| `pipeline/step-scripts.ts` | `PLATFORM_STEP_SCRIPTS` 去掉 restart/verify（清单可能为空 → 保留空数组与注释，说明「平台托管脚本机制暂不再使用」） |
| `pipeline-step-command/platform-script-seed.service.ts` | 移除 restart/verify 的同步分支；`DEFAULT_STEP_SCRIPTS`（git）机制保持不变 |
| `pipeline/scripts/restart-step.sh`、`verify-step.sh` | 删除（委托壳） |
| `pipeline/scripts/restart-backend.sh`、`verify-backend.sh` | 正文迁入 DB 后删除；**留一份参考稿**在本 spec 的附录/`docs`，避免"只在 DB"再次发生 |
| `pipeline/steps/service-tools.ts`、`restart.executor.ts`、`verify.executor.ts` | 待定（见 §6-Q3）：保留 = 仍可用 `service` action 走代码实现；建议**保留但不用于新模板** |
| `WS_PLATFORM_SCRIPTS_DIR` 注入 | 保留（`write-version.mjs` / 新 `write-pointer.mjs` 仍需要） |
| `deploy.service.ts` 的 `applyBackendVersion` / `POST /api/services/:key/deploy` | 保留为**应急手段**（回滚、手工部署），不再是发布必需路径（见 §6-Q2） |

### 2.6 前端口径（本次不改）

- 节点保持：拉取代码 → 构建 → 发布确认 → **发布（投递 + write-version + 切指针）**。
- 「部署」= 浏览器/基座重载资源：`/static/modules/<key>/<envId>/index.js` 指针目录直出 + 已有 `version-check` 探测提示刷新（`apps/shell/src/version-check.ts`，2026-09-21 已修）。
- 因此前端**不需要** restart/verify action，也不改动 gateway 的 manifest 机制（TTL 10s 自动过期）。

---

## 3. 影响清单

**代码（`servers/deploy-console`）**
1. `src/pipeline/step-scripts.ts`（托管清单）
2. `src/pipeline-step-command/platform-script-seed.service.ts`（同步逻辑）
3. 删除 `src/pipeline/scripts/{restart-step,verify-step}.sh`；迁移并删除 `{restart-backend,verify-backend}.sh`
4. 新增 `src/pipeline/scripts/write-pointer.mjs`（+ `nest-cli.json` assets 已有 `pipeline/scripts/*` 通配则无需改）
5. 相关单测：`platform-script-seed.service.spec.ts`、`step-scripts` 相关断言、`pipeline.service.spec.ts`（若涉及平台脚本同步断言）

**数据（两处库：本地 `127.0.0.1/web_system_deploy` 与 dev/堡垒机共用云库）**
6. 16 个模板 × `deploy_pipeline_step_commands(restart|verify)`：删除孤儿行（或改成 `locked=0` 的可编辑正文）
7. 后端模板（`tpl-{gateway,auth-service,user-service,system-service,ai-service,ai-agent,mcp-gateway,content-hub,upload-service,todo-service,deploy-console,finnews}-dev` 等）的**发布/local task** 追加两个 action（restart / verify）
8. 前端模板（`tpl-{admin,portal,shell,mini-contract}-dev`）**不动**

**文档**
9. `docs/development/deploy-target-knowledge.md`：§0 边界（补"发布 = 脚本动作串"）、§1.1 基座构建约定、§2 服务域补"restart/verify 在流水线里"
10. `specs/pipeline-env-scripts/`、`specs/pipeline-node-model/`：关于"平台托管脚本"的段落同步修订
11. 本 spec 附录保留 restart/verify 脚本参考稿

---

## 4. 迁移步骤（本地先行 → 云库）

1. **本地库**：后端模板加 restart/verify action（脚本正文 = §2.2/§2.3）；删除 32 行孤儿 `step_commands`。
2. **代码**：按 §2.5 退场 + 新增 `write-pointer.mjs`；重启 console（注意 6200 孤儿端口铁律）。
3. **验证**（见 §5）：挑一个低风险后端模块（建议 `todo-service`）走一次 local 发布。
4. **云库**：把第 1 步的脚本正文与动作行导出成幂等 SQL/脚本，导入 dev/堡垒机库（见 §6-Q4）。
5. **文档**：更新 §3 第 9、10 项。

---

## 5. 验收判据

| # | 判据 | 方法 |
|---|---|---|
| 1 | 后端 local 发布一次跑通，流水线内含 restart + verify 两个动作且 succeeded | 流水线日志出现 `[restart] 已重建`、`[verify] 端口探活` |
| 2 | 跑完即生效（不必去控制台点「部署」） | `pm2 describe <name>` 的 pid 变化 + 端口持有者 == pm2 pid；`servers/<dir>/dist` 内容 == 版本目录 |
| 3 | 指针在 verify 通过后才前进；restart 失败时指针不动 | 人为制造 restart 失败（如把 `dist` 权限改坏）→ 指针保持旧值，旧版本仍在跑 |
| 4 | 依赖校验仍 fail-fast | 临时清空 ai-agent 的 `MCP_GATEWAY_URL` → 发布在 restart 阶段失败并给出原文提示 |
| 5 | 前端不受影响 | admin/portal 各发一次，节点仍是四个，切指针行为不变；页面无「发现新版本」误报 |
| 6 | 平台托管机制不再覆盖 DB | 手工改 DB 里 restart 脚本正文 → 重启 console → 内容保持不变 |

---

## 6. 待确认项

| # | 问题 | 我的建议 |
|---|---|---|
| Q1 | §2.4 的指针写入：新增 `write-pointer.mjs` 工具（脚本调用），可接受吗？ | 可接受（与 `write-version.mjs` 同级；业务实现仍在 DB 脚本里） |
| Q2 | `POST /api/services/:key/deploy`（控制台「服务详情 → 部署」）**删除**还是**保留为应急**？ | 保留（回滚/救火用），但不再是发布必需路径 |
| Q3 | `restart.executor.ts` / `verify.executor.ts`（`service` action 走代码实现）是否一并删除？ | 保留代码但不用于新模板（删了会削弱「回滚到旧模板」的兼容性） |
| Q4 | 云库（dev/堡垒机共用）由我改，还是你改？需要我提供幂等导出脚本吗？ | 我提供导出脚本 + 只改本地库；云库改动等你确认窗口 |
| Q5 | 后端远程（dev/prod）发布本次不做 —— 确认？ | 确认（远程后端发布能力本身未实现） |

---

## 附录 A：restart / verify 参考稿（从平台脚本迁移前存档）

- `restart-backend.sh`（原 6861B）：依赖校验 `check_deps()` → `resolve_name()`（pm2 jlist + python 解析候选名）→ `clean_orphan_port()`（pm2 纳管进程不杀，防自杀护栏）→ `pm2 delete` + `env -i PATH HOME PORT pm2 start ... --max-memory-restart 512M` + `pm2 save`。
- `verify-backend.sh`（原 5503B）：`MODULE_TYPE=backend` 守卫 → 进程在线轮询（12×2s）→ 端口 `/dev/tcp` 探活（3 次）→ MCP 相关服务 `knowledge_list` 端到端（3 次，区分 401 / 4010）。
- 迁入 DB 时**保留**上述语义与错误文案（它们是排障入口），仅去掉「委托 `$WS_PLATFORM_SCRIPTS_DIR`」这一层。

---

## 附录 B：迁移前的平台实现脚本（全文存档，2026-09-21）

> 这两个文件已从 `servers/deploy-console/src/pipeline/scripts/` 删除，实现改为 DB action 脚本正文（见 §2.2 / §2.3）。存档仅供对照与回溯。

### B.1 `restart-backend.sh`

```bash
#!/usr/bin/env bash
# ============================================================
# 发布流水线 · restart 阶段（backend）
#
# 为什么单独成脚本：restart 不只是「把进程拉起来」，还要保证服务拿到的
# **依赖配置**是正确的。真实事故（2026-09-11 dev 环境）：
#   ① ai-agent/.env 缺 MCP_GATEWAY_URL → 所有 MCP 能力静默不注册，
#      直到 Playground 报「工具 knowledge_list 未注册」才暴露；
#   ② `pm2 restart --update-env` 把**执行会话**的环境固化进 pm2_env，
#      而 dotenv 不覆盖已存在的 process.env → 各服务的 .env 形同虚设，
#      实际生效的是会话里混入的 .env.production 变量，跨服务密钥不一致
#      （网关 401 / 知识服务 4010），排查成本极高。
#
# 设计原则：**服务自身的 .env 是唯一配置源**。
#   1) 依赖校验：关键依赖缺失 / 跨服务密钥不一致 → fail-fast，阻断发布；
#   2) 干净重启：pm2 delete + start，进程环境只保留 PATH / HOME / PORT，
#      配置全部由服务 .env 提供（不留历史污染残留）。
#
# 平台下发变量：RELEASE_DIR / MODULE_KEY / MODULE_DIR / MODULE_TYPE /
#              PM2_NAME / PORT / COMMIT_ID / BRANCH
# 本地调试：DRY_RUN=1 只打印计划，不改动进程
# ============================================================
set -euo pipefail

DRY_RUN="${DRY_RUN:-0}"

log() { echo "[pipeline:restart] $*"; }
die() { echo "[pipeline:restart] $*" >&2; exit 1; }

case "${MODULE_TYPE:-}" in
  backend) ;;
  *) log "MODULE_TYPE=${MODULE_TYPE:-未设置} 非后端模块，跳过"; exit 0 ;;
esac

: "${RELEASE_DIR:?RELEASE_DIR 未设置}"
: "${MODULE_KEY:?MODULE_KEY 未设置}"

MODULE_DIR_NAME="${MODULE_DIR:-${MODULE_KEY}}"
SVC_DIR="${RELEASE_DIR}/servers/${MODULE_DIR_NAME}"
ENV_FILE="${SVC_DIR}/.env"
PM2="${PM2_BIN:-$(command -v pm2 || echo "${RELEASE_DIR}/node_modules/.bin/pm2")}"

[ -f "${SVC_DIR}/dist/main.js" ] || die "未找到构建产物：${SVC_DIR}/dist/main.js（请确认 build 阶段已成功）"

# 读 .env 中某个键的值（文件不存在或键缺失时返回空）
env_get() { # $1=env 文件路径 $2=键名
  [ -f "$1" ] || return 0
  grep -m1 "^$2=" "$1" 2>/dev/null | cut -d= -f2- | tr -d '\r' || true
}

# ── ① 依赖校验：配置不完整 / 跨服务不一致 ⇒ 不允许上线 ──
check_deps() {
  case "${MODULE_KEY}" in
    ai-agent)
      [ -f "$ENV_FILE" ] || die "ai-agent 缺少 .env（${ENV_FILE}）"
      [ -n "$(env_get "$ENV_FILE" MCP_GATEWAY_URL)" ] || die \
        "ai-agent/.env 缺少 MCP_GATEWAY_URL —— 所有 MCP 能力（knowledge_* 等）都不会注册，运行时报「工具未注册」。
      修复：在 ${ENV_FILE} 增加 MCP_GATEWAY_URL=http://127.0.0.1:6006"
      local agent_key gw_key
      agent_key="$(env_get "$ENV_FILE" MCP_CLIENT_KEY)"
      gw_key="$(env_get "${RELEASE_DIR}/servers/mcp-gateway/.env" MCP_CLIENT_KEY)"
      if [ -n "$agent_key" ] && [ -n "$gw_key" ] && [ "$agent_key" != "$gw_key" ]; then
        die "ai-agent.MCP_CLIENT_KEY 与 mcp-gateway.MCP_CLIENT_KEY 不一致 —— /mcp/tools/call 会返回 401"
      fi
      ;;
    mcp-gateway)
      local gw_token ks_key
      gw_token="$(env_get "$ENV_FILE" KNOWLEDGE_SERVICE_AUTH_CONFIG \
        | sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
      ks_key="$(env_get "${RELEASE_DIR}/servers/knowledge-service/.env" INTERNAL_API_KEY)"
      if [ -n "$gw_token" ] && [ -n "$ks_key" ] && [ "$gw_token" != "$ks_key" ]; then
        die "mcp-gateway.KNOWLEDGE_SERVICE_AUTH_CONFIG.token 与 knowledge-service.INTERNAL_API_KEY 不一致 —— knowledge 工具调用会返回 4010"
      fi
      ;;
  esac
  return 0
}

# ── ② 解析 pm2 进程名（注册表名 ↔ 实际进程名兼容）──
resolve_name() {
  MK="$MODULE_KEY" PM2N="${PM2_NAME:-}" "$PM2" jlist 2>/dev/null \
    | MK="$MODULE_KEY" PM2N="${PM2_NAME:-}" python3 -c '
import sys, json, os
mk = os.environ.get("MK", "")
base = mk[:-8] if mk.endswith("-service") else mk
cands = [os.environ.get("PM2N", ""), "web-" + mk, "web-" + base, mk, base]
try:
    procs = {p["name"] for p in json.load(sys.stdin)}
except Exception:
    sys.exit(0)
for c in cands:
    if c and c in procs:
        print(c)
        break
'
}

# ── ③ 端口孤儿清理（防自杀护栏：pm2 纳管进程一律不杀）──
clean_orphan_port() {
  [ -n "${PORT:-}" ] || return 0
  local all_pm2_pids occ
  all_pm2_pids="$("$PM2" jlist 2>/dev/null | python3 -c '
import sys, json
try:
    print(" ".join(str(p["pid"]) for p in json.load(sys.stdin) if p.get("pid")))
except Exception:
    pass
' 2>/dev/null || true)"
  for occ in $(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true); do
    case " $all_pm2_pids " in
      *" $occ "*) log "端口 $PORT 占用者 $occ 为 pm2 纳管进程，跳过清理（疑似 PORT 配置冲突）" ;;
      *) log "清理端口 $PORT 孤儿进程 $occ"; kill -9 "$occ" 2>/dev/null || true ;;
    esac
  done
}

log "模块 ${MODULE_KEY}｜目录 servers/${MODULE_DIR_NAME}｜配置源 ${ENV_FILE}"
check_deps

NAME="$(resolve_name)"
if [ -z "$NAME" ]; then
  # 首次纳管（bootstrap 场景）：pm2 里还没有该进程，回退到命名约定。
  # 默认**关闭**，避免 typo 的 MODULE_KEY 凭空创建进程；bootstrap.sh 会显式置 PM2_ALLOW_NEW=1。
  if [ "${PM2_ALLOW_NEW:-0}" = "1" ]; then
    NAME="${PM2_NAME:-web-${MODULE_KEY}}"
    log "pm2 中未找到 ${MODULE_KEY} → 首次纳管，进程名取 ${NAME}"
  else
    die "pm2 中未找到服务（候选 ${PM2_NAME:-未设置} / web-${MODULE_KEY} / web-${MODULE_KEY%-service}）—— 请先纳管进程，或置 PM2_ALLOW_NEW=1 允许首次创建"
  fi
fi

if [ "$DRY_RUN" = "1" ]; then
  log "[DRY_RUN] 将清理端口 ${PORT:-未设置} 孤儿进程，并以干净环境重建："
  log "[DRY_RUN] env -i PATH HOME PORT=${PORT:-} pm2 start ${SVC_DIR}/dist/main.js --name ${NAME} --cwd ${SVC_DIR} --max-memory-restart 512M"
  exit 0
fi

clean_orphan_port

# ── ④ 干净重启：delete + start（进程环境只留 PATH / HOME / PORT）──
# 不用 `pm2 restart --update-env`：它只增量更新，历史 pm2_env 中的混杂变量
# （如 .env.production 的 JWT_SECRET / 微信密钥 / MCP_CLIENT_KEY）会残留，
# 而 dotenv 不覆盖已存在的 process.env → 服务实际用的是错误来源的配置。
"$PM2" delete "$NAME" >/dev/null 2>&1 || true
env -i \
  PATH="$PATH" \
  HOME="${HOME:-/root}" \
  PORT="${PORT:-}" \
  "$PM2" start "${SVC_DIR}/dist/main.js" \
  --name "$NAME" \
  --cwd "$SVC_DIR" \
  --max-memory-restart 512M \
  || die "启动失败：${NAME}（查看 pm2 logs ${NAME}）"

"$PM2" save >/dev/null 2>&1 || true
log "已重建 ${NAME}：进程环境仅 PATH/HOME/PORT，依赖配置由 ${ENV_FILE} 提供"
```

### B.2 `verify-backend.sh`

```bash
#!/usr/bin/env bash
# ============================================================
# 发布流水线 · verify 阶段（backend）
#
# 为什么单独成脚本：历史事故里"发布成功"出现过两类**假健康**：
#   ① 进程 online 但端口没监听（生产 synchronize=false 漏跑迁移；
#      或端口被孤儿进程占着，新进程 EADDRINUSE 后 pm2 反复重启）；
#   ② 端口通、业务链断：ai-agent 未注册 MCP 工具（缺 MCP_GATEWAY_URL），
#      或跨服务密钥不一致（网关 401 / 知识服务 4010）—— 端口探活完全看不出来。
#
# 本脚本按序检查：pm2 online → 端口 TCP → （MCP 相关服务）AI 链路端到端。
# 任一项失败即退出非 0，由流水线/watchdog 决定回滚。
#
# 平台下发变量：RELEASE_DIR / MODULE_KEY / MODULE_DIR / MODULE_TYPE / PM2_NAME / PORT
# 本地调试：DRY_RUN=1 只打印将执行的检查
# ============================================================
set -uo pipefail

DRY_RUN="${DRY_RUN:-0}"
ONLINE_WAIT_TRIES="${ONLINE_WAIT_TRIES:-12}"   # 12 × 2s = 24s
AI_CHAIN_TRIES="${AI_CHAIN_TRIES:-3}"
MCP_PORT="${MCP_PORT:-6006}"

log() { echo "[pipeline:verify] $*"; }
die() { echo "[pipeline:verify] $*" >&2; exit 1; }

case "${MODULE_TYPE:-}" in
  backend) ;;
  *) log "MODULE_TYPE=${MODULE_TYPE:-未设置} 非后端模块，跳过探活"; exit 0 ;;
esac

: "${RELEASE_DIR:?RELEASE_DIR 未设置}"
: "${MODULE_KEY:?MODULE_KEY 未设置}"

MODULE_DIR_NAME="${MODULE_DIR:-${MODULE_KEY}}"
SVC_DIR="${RELEASE_DIR}/servers/${MODULE_DIR_NAME}"
PM2="${PM2_BIN:-$(command -v pm2 || echo "${RELEASE_DIR}/node_modules/.bin/pm2")}"

# ── 解析 pm2 进程名（与 restart-backend.sh 同源语义）──
resolve_name() {
  MK="$MODULE_KEY" PM2N="${PM2_NAME:-}" "$PM2" jlist 2>/dev/null \
    | MK="$MODULE_KEY" PM2N="${PM2_NAME:-}" python3 -c '
import sys, json, os
mk = os.environ.get("MK", "")
base = mk[:-8] if mk.endswith("-service") else mk
cands = [os.environ.get("PM2N", ""), "web-" + mk, "web-" + base, mk, base]
try:
    procs = {p["name"] for p in json.load(sys.stdin)}
except Exception:
    sys.exit(0)
for c in cands:
    if c and c in procs:
        print(c)
        break
'
}

NAME="$(resolve_name)"
[ -n "$NAME" ] || die "pm2 中未找到服务：${MODULE_KEY}（候选 ${PM2_NAME:-未设置} / web-${MODULE_KEY} / ${MODULE_KEY}）"

IS_MCP_RELATED=0
case "$MODULE_KEY" in
  ai-agent|mcp-gateway|knowledge-service) IS_MCP_RELATED=1 ;;
esac

if [ "$DRY_RUN" = "1" ]; then
  log "[DRY_RUN] 服务=${NAME}｜将检查：pm2 online（最多 ${ONLINE_WAIT_TRIES}×2s）→ 端口 ${PORT:-未设置} TCP 探活"
  if [ "$IS_MCP_RELATED" = "1" ]; then
    log "[DRY_RUN] 额外检查：AI 链路 /mcp/tools/call knowledge_list（端口 ${MCP_PORT}）"
  fi
  exit 0
fi

# ── ① 进程在线 ──
ONLINE=""
for _ in $(seq 1 "$ONLINE_WAIT_TRIES"); do
  ONLINE="$(MK="$MODULE_KEY" PM2N="$NAME" "$PM2" jlist 2>/dev/null | MK="$MODULE_KEY" PM2N="$NAME" python3 -c '
import sys, json, os
name = os.environ.get("PM2N", "")
try:
    procs = {p["name"]: (p.get("pm2_env") or {}).get("status") for p in json.load(sys.stdin)}
except Exception:
    sys.exit(0)
if procs.get(name) == "online":
    print(name)
' 2>/dev/null)"
  [ -n "$ONLINE" ] && break
  log "等待服务上线: $NAME"
  sleep 2
done
[ -n "$ONLINE" ] || die "服务重启后未在线：$NAME（排查：pm2 logs $NAME）"
log "服务在线: $ONLINE"

# ── ② 端口 TCP 探活 ──
if [ -n "${PORT:-}" ]; then
  port_ok=0
  for _ in 1 2 3; do
    if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then port_ok=1; break; fi
    sleep 2
  done
  [ "$port_ok" = "1" ] || die "端口探活失败：$MODULE_KEY 进程 online 但 127.0.0.1:$PORT 无响应（排查：lsof -tiTCP:$PORT -sTCP:LISTEN）"
  log "端口探活 $PORT: 健康"
else
  log "PORT 未解析，降级为进程状态探活"
fi

# ── ③ AI 链路端到端（仅 MCP 相关服务）──
check_ai_chain() {
  local gw_env="${RELEASE_DIR}/servers/mcp-gateway/.env"
  local key=""
  if [ -f "$gw_env" ]; then
    key="$(grep -m1 '^MCP_CLIENT_KEY=' "$gw_env" 2>/dev/null | cut -d= -f2- | tr -d '\r' || true)"
  fi
  if [ -z "$key" ]; then
    log "[WARN] 未取到 mcp-gateway 的 MCP_CLIENT_KEY，跳过 AI 链路探活"
    return 0
  fi
  local resp="" i
  for i in $(seq 1 "$AI_CHAIN_TRIES"); do
    resp="$(curl -s --max-time 10 -X POST "http://127.0.0.1:${MCP_PORT}/mcp/tools/call" \
      -H "Authorization: Bearer ${key}" -H 'Content-Type: application/json' \
      -d '{"module":"knowledge","tool":"knowledge_list","args":{}}' 2>/dev/null || true)"
    [ -n "$resp" ] && break
    log "AI 链路探活重试 ${i}/${AI_CHAIN_TRIES}（等待 mcp-gateway/knowledge-service 就绪）"
    sleep 2
  done
  case "$resp" in
    "") die "AI 链路探活无响应：http://127.0.0.1:${MCP_PORT}/mcp/tools/call（mcp-gateway 或 knowledge-service 未就绪）" ;;
    *"内部调用密钥无效"*|*4010*)
      die "AI 链路内部鉴权失败：mcp-gateway.KNOWLEDGE_SERVICE_AUTH_CONFIG.token ≠ knowledge-service.INTERNAL_API_KEY
      （改其中一处的 .env 后重启，或让 KNOWLEDGE_SERVICE_AUTH_CONFIG 引用同一密钥）" ;;
    *Unauthorized*)
      die "AI 链路网关鉴权失败：调用方 MCP_CLIENT_KEY ≠ mcp-gateway.MCP_CLIENT_KEY（401）" ;;
    *)
      log "AI 链路探活: knowledge_list OK" ;;
  esac
}

if [ "$IS_MCP_RELATED" = "1" ]; then
  check_ai_chain
fi

log "验证通过: $MODULE_KEY"
```

---

## 7. 实施结果与验证证据（2026-09-21，local）

### 7.1 代码（提交 `20d1380`）

| 改动 | 文件 |
|---|---|
| 注入 `CONSOLE_API` / `CONSOLE_TOKEN`（并加入保护键，不被配置中心覆盖） | `pipeline/pipeline.service.ts` |
| 新增 `POST /api/internal/release/pointer`（`x-internal-key` 鉴权） | `deploy/internal-release.controller.ts`、`deploy/deploy.module.ts` |
| 托管清单清空（restart / verify 退出托管） | `pipeline/step-scripts.ts`、`pipeline-step-command/platform-script-seed.service.ts` |
| 删除内置执行体与委托脚本 | `pipeline/steps/{restart,verify}.executor.ts`、`pipeline/scripts/{restart,verify}-{backend,step}.sh` |
| 注册表 / 工具表同步 | `pipeline/steps/step-registry.ts`、`service-tools.ts`、`pipeline.module.ts` |

### 7.2 数据（本地 `web_system_deploy`）

- 11 个后端模板的「发布 / local」任务追加 `restart` / `verify` 两个 action（sort=2/3）；
- 删除 16 个模板的 32 行孤儿 `deploy_pipeline_step_commands`（restart / verify 托管行）；
- 顺带修复：7 个后端模板的 build 动作原为裸 `npx tsc -p tsconfig.json`（缺 `cd`，必然失败）
  → 改为 `cd "$RELEASE_DIR/servers/$MODULE_DIR"` + `npm run build`；
- 备份（可回滚）：`/tmp/backup-step-commands.json`、`/tmp/backup-build-actions.json`。

### 7.3 验证（todo-service @ local，jobId `1789995823365-3z95qh1`）

| 判据 | 结果 |
|---|---|
| 流水线终态 | succeeded（发布节点含 restart / verify 两个动作） |
| restart 日志 | `[restart] 已重建 web-todo：进程环境仅 PATH/HOME/PORT，依赖配置由 …/.env 提供` |
| verify 日志 | `服务在线: web-todo` → `端口探活 6005: 健康` → `验证通过并已切指针: local/todo-service → todo-service-dev/20d1380` |
| 指针 | `deploy_deployments(local, todo-service) = todo-service-dev/20d1380` |
| 落地 | `diff -rq dist <版本目录>` 一致 |
| 进程 / 端口 | 6005 持有者 pid == `pm2 web-todo` 的 pid |
| 失败不切指针 | 同版本首次发布因脚本缺陷 exit 1（restart 阶段）→ verify 未执行、指针未变 |

### 7.4 踩坑（已固化到 `docs/development/deploy-target-knowledge.md` §3.1）

1. **动作脚本的 cwd = 发布目录根**，必须自己 `cd`（否则 `TS5058: tsconfig.json 不存在` /
   `Could not resolve entry module "index.html"`）。
2. **console 的 bash 为单字节 locale**：`$VAR` 后紧跟中文会被并入变量名
   （`NAME\xef: unbound variable`，脚本实际跑成功却 exit 1）→ 一律写 `${VAR}（中文…）`。

### 7.5 遗留（待办）

- **云库（dev / 堡垒机共用）未同步**：那边模板的 restart / verify 与 build 动作仍是旧状态；
  同步前不要在云库 console 上用流水线发后端模块（会停在旧行为或构建失败）。
- 控制台「服务详情 → 部署」入口**已于同日下线**（提交 `95382c2`）：删除
  `POST /api/services/:key/deploy`、`ServicesService.deploy/restartLocal`、前端 `servicesApi.deploy`
  与服务详情页的部署按钮/选版本弹窗；脚本侧改由 `/api/internal/release/{versions,pointer}` 承担。
  （待办：服务详情页剩余文案「部署 / 待部署」建议随后统一为「发布生效」口径。）
- ~~`node-approval.spec.ts` 与 `PipelineService` 依赖漂移导致的既有单测失败~~ → **已修**（同日）：
  补齐 `stepCommands.getRow`、`StepBranchService.list`、`PipelineOrchestrationService` 等桩后 8/8 通过
  （全量 45 suites / 474 tests）。**结论：该 spec 的桩陈旧，不是引擎回归** ——
  `runStageCommand` 新增了「步骤执行条件 / 步骤分支」读取，旧桩缺这两个方法，
  第一个节点就抛 `getRow is not a function`，流水线 failed，于是「应挂起」的断言失败。

### 7.6 后续批次（2026-09-21 当日）：平台脚本分发机制整体移除

用户口径（追加）：**平台不提供脚本**，这类逻辑全部从平台删除；需要初始化流水线脚本就放到 SQL 初始化脚本。

| 删除项 | 说明 |
|---|---|
| `pipeline/step-scripts.ts` + `.spec.ts` | 托管清单 + 默认脚本读取 |
| `pipeline-step-command/platform-script-seed.service.ts` + `.spec.ts` | 启动 / 提交时的脚本 seed |
| `pipeline/scripts/git-step.sh`、`write-version.mjs` | 随 console 分发的脚本 |
| `WS_PLATFORM_SCRIPTS_DIR` 注入 | `resolveStageVars` 不再下发；`nest-cli.json` 不再拷贝脚本资产 |
| `PlatformScriptSeedService` 依赖 | `pipeline.service` / `pipeline-template.service` / module 一并移除 |

新增：**`scripts/migrations/p21-pipeline-node-scripts.sql`**（幂等）——
① 新环境初始化：给所有模板补 git 节点默认脚本（仅空值才填，不覆盖运维改动）；
② 存量迁移：`write-version` 动作改为 curl 调 `/api/internal/release/versions`（不再依赖平台分发的 `.mjs`）。

验证：todo-service @ local（jobId `1789996664527-2a0hg8k`）走通
`投递 → write-version(curl) → restart → verify 切指针`；库内 `WS_PLATFORM_SCRIPTS_DIR` 引用为 0。
