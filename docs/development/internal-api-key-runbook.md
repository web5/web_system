# INTERNAL_API_KEY 维护手册（服务间内部密钥）

> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
> 定位：`INTERNAL_API_KEY` 是服务间调用（`/internal/*`）的共享密钥，**属引导凭据，永不下发**；本文规定它在 local / dev / prod 怎么配、怎么查、怎么轮换。
> 判据来源：`specs/service-config-delivery/design.md:67-72`（划界表）、`servers/deploy-console/src/config/config.service.ts:43-53`（`RESERVED_LOCAL_KEYS`）、`docs/development/local-dev-guide.md:231`

## 1 为什么不能走配置中心下发

`specs/service-config-delivery/design.md:69`：**鸡生蛋** —— 读配置中心本身要先有这个密钥。代码侧已硬编码排除：

- `config.service.ts:45` 把 `INTERNAL_API_KEY`（与 `CONFIG_MASTER_KEY` / `MYSQL_*` / `REDIS_*` / `PM2_*` / `CONSOLE_*` / `PATH` / `HOME`）列入 `RESERVED_LOCAL_KEYS`，下发时被过滤；
- 流水线脚本变量注入走 `resolveForScripts`，**跳过 `is_secret=1`**（`local-dev-guide.md:234`）。

> 结论：这个键只能落在**各服务自己的 `.env`**，人工维护。不要试图把它加进配置中心，加了也不会下发。

## 2 需要它的服务（判断标准）

判断标准：**只要该服务提供 `/internal/*` 端点，或要调用别的服务 `/internal/*`，就需要**。

| 服务 | 角色 |
|---|---|
| user-service | 提供 `/internal/users/email/verify`、`/internal/roles/permissions` |
| auth-service | **调用** user-service 的 internal 端点（邮箱验证码核销） |
| system-service | 提供 dict / logs / storage 的 internal 端点 |
| gateway | 调用 auth-service 的 `/internal/auth/token-status`（黑名单校验） |
| deploy-console | 提供 internal 端点（流水线脚本用 `CONSOLE_TOKEN`） |
| ai-agent | 调用 user-service `/internal/roles/permissions` |
| mcp-gateway / knowledge-service / upload-service | 提供或校验 internal 端点 |

新增服务时按同一标准判断，配完记得回填本表。

## 3 各环境怎么配

> 2026-09-24 拍板：`INTERNAL_API_KEY` **改为可走配置中心下发**（`specs/service-config-delivery/internal-key-delivery-design.md`）。
> 下表「手工路径」退化为**首次启动兜底**，权威源是配置中心。

| 场景 | 落点 | 谁维护 |
|---|---|---|
| 权威源 | 配置中心（`config_items`，按 env 分层，**dev / prod 用不同值**） | 控制台登记，`is_secret=1` |
| 部署时下发 | `servers/<svc>/.env.generated`（0600，部署前写入，重启即生效） | console 自动（`DeployService.writeGeneratedEnv`） |
| 仅重启 | 同上，由 `scripts/pipeline/fetch-config.sh` 拉取落盘（须挂在 restart 动作之前） | 流水线 |
| 兜底（首次启动 / 未下发） | `servers/<svc>/.env` | 人工，逐环境 |
| deploy-console 自身 | **只能** `servers/deploy-console/.env` | 人工 —— 它是下发链的根（`CONSOLE_TOKEN` 取自此，见 `pipeline.service.ts:265`） |

⚠️ **dev 与 prod 建议使用不同的值**（环境隔离）。当前本地 8 个服务共用同一值是 local 环境的事实，不要照搬到线上。

⚠️ 凭据仓 `~/env_config/web_system/{dev,prod}.env` 目前**没有**这个键（实测 0 命中）——它是留档用，不是生效源；推荐补进去，避免"人走了就没人知道配的什么"。

## 4 新增 / 变更服务的操作清单

1. 在目标服务 `.env` 写入与其它服务**相同**的 `INTERNAL_API_KEY`（该环境内）。
2. 确认调用方传的是请求头 `x-internal-key`（不是 body、不是 Bearer）。
3. 重启该服务并灰度验证一次 internal 调用（调用失败表现为 401 `internal forbidden`）。
4. 回填本文 §2 表格。

## 5 一致性巡检（不做就会踩的坑）

症状：某个服务漏配或配成别的值 → 跨服务调用直接 401，且日志只显示 `internal forbidden`，很容易误判成网络或权限问题。

巡检要点是**比对指纹而不是比对明文**，避免把密钥打进终端历史：

```bash
# 本机（工作区 / 发布目录）
cd <root>/servers
for f in auth-service gateway user-service system-service deploy-console ai-agent mcp-gateway knowledge-service upload-service; do
  v=$(grep '^INTERNAL_API_KEY=' $f/.env 2>/dev/null | tr -d '\r' | sed 's/^INTERNAL_API_KEY=//')
  [ -z "$v" ] && echo "$f 未配置" || echo "$f $(printf '%s' "$v" | shasum -a 256 | cut -c1-12)"
done

# 远程（dev / prod）
ssh <host> "for f in auth-service gateway user-service; do
  v=\$(grep '^INTERNAL_API_KEY=' /data/web_system/servers/\$f/.env 2>/dev/null | tr -d '\r' | sed 's/^INTERNAL_API_KEY=//');
  [ -z \"\$v\" ] && echo \"\$f 未配置\" || echo \"\$f \$(printf '%s' \"\$v\" | shasum -a 256 | cut -c1-12)\"; done"
```

同一环境内所有指纹必须一致；不同环境应当不同。

## 6 现状缺口（待补）

1. **无同步脚本**：仓库里没有任何从 `~/env_config` 生成 / 同步各服务 `.env` 的脚本（全仓 `*.sh` 搜 `env_config` 为 0 命中），dev/prod 全靠人工。
2. **无轮换方案**：`INTERNAL_API_KEY` 目前**没有轮换设计**。可对齐 `specs/config-master-key-distribution/design.md:208-211` 的**双钥（active/old）**方案：
   - InternalGuard 支持多值（`INTERNAL_API_KEY` + `INTERNAL_API_KEY_OLD`），过渡期两者都接受；
   - 轮换顺序：先在所有服务加 `_OLD`（旧值）→ 再把主值换成新值并逐台重启 → 观察期后摘掉 `_OLD`。
3. **凭据仓缺项**：`~/env_config/web_system/{dev,prod}.env` 未登记此键。
4. **与"目标态"冲突**：`docs/operations/release-checklist.md:130-133` 要求凭证不进 `.env`（走 1Password），与现状明文存 `.env` 冲突 —— 属目标态，未落地。

## 7 FAQ

- **Q：能不能给某个服务先不配，等用到再说？**
  A：可以，但那是"未配置即全部拒绝"（`InternalGuard`：`!expected` 也拒绝）。也就是说调用方如果传了值、被调方没配，一样 401。所以**成对配置**：要么两边都配，要么都别用 internal 端点。

- **Q：把它加进配置中心会怎样？**
  A：不会下发，且在控制台里能看到一个"改了不生效"的配置项，误导后续运维。不要加。

- **Q：漏配了怎么快速定位？**
  A：看被调方日志的 `internal forbidden`，再用 §5 的指纹巡检确认两边值是否一致；注意 `.env` 是 CRLF 时 `grep -c "^KEY=VALUE$"` 会数成 0（不代表没配上）。
