# 配置清单 · 服务 × 环境 指向（主机组 + 端口）

> 状态：**待确认** ｜ 2026-09-20
> 依据：`./page-spec.md` §9.4 决策（Q17 方案 D / Q18 / Q19 / Q20）
> 规则：`host_name` = 主机组名（引用 `deploy_hosts.name`）· 地址由主机解析 · **端口必填不继承** · 填错报错
> 数据来源标注：✅ 实测（ssh `pm2 jlist` / `ss -lntp`、本地 `ecosystem.config.cjs`）｜⚠️ 待人工确认

---

## 1. 主机组 `deploy_hosts`（目标 3 条）

| 组名 `name` | 地址 `host` | SSH 用户 | 部署根目录 | 运行时 | 说明 |
|---|---|---|---|---|---|
| `local-default` | `127.0.0.1` | `geekwen` | `/Users/geekwen/web_system_release` | pm2 | 本机；现有行 `name=127.0.0.1` 需**重命名** ✅ |
| `dev-default` | `175.27.189.123` | `ubuntu` | `/data/web_system` | pm2 | dev 机；现有行 `name=175.27.189.123` 需**重命名** ✅ |
| `prod-default` | `106.52.176.246` | `root` | `/data/web_system` | pm2 | prod 机；现有行 `name=106.52.176.246` 需**重命名** ✅ |

- 旧表 `deploy_servers`（`dev-default` / `prod-default` / `staging-default`）**不迁移**：以 `deploy_hosts` 为准。
- `staging-default`(10.0.0.9) 不建：`deploy_envs` 只有 `dev / local / prod`，无 staging 环境。
- ⚠️ **堡垒机 101.43.117.234**：若 `deploy-console` 的 prod 实例跑在堡垒机（本次 ssh 未通，无法实测），需另加主机组 `bastion-default`（端口待确认）。见 §5 待确认 Q3。

## 2. local 环境（全部本机 → `local-default`）

端口来源：本机 `ecosystem.config.cjs`（写死 env.PORT）✅

| 服务 | 主机组 | 端口 | 现库值 | 动作 |
|---|---|---|---|---|
| gateway | local-default | 6000 | `127.0.0.1 / 6000` | 改组名 |
| auth-service | local-default | **6101** | `127.0.0.1 / 6101` | 改组名（6001 在本机被占用，故用 6101）|
| user-service | local-default | 6002 | `127.0.0.1 / 6002` | 改组名 |
| ai-service | local-default | 6003 | `127.0.0.1 / 6003` | 改组名 |
| system-service | local-default | 6004 | `127.0.0.1 / 6004` | 改组名 |
| todo-service | local-default | 6005 | `127.0.0.1 / 6005` | 改组名 |
| mcp-gateway | local-default | 6006 | `127.0.0.1 / 6006` | 改组名 |
| content-hub | local-default | 6007 | `127.0.0.1 / 6007` | 改组名 |
| upload-service | local-default | 6008 | `127.0.0.1 / 6008` | 改组名 |
| ai-agent | local-default | 6010 | `127.0.0.1 / 6010` | 改组名 |
| knowledge-service | local-default | 6011 | `127.0.0.1 / 6011` | 改组名 |
| deploy-console | local-default | 6200 | `127.0.0.1 / 6200` | 改组名（legacy 通道）|
| finnews | — | — | 无 | ⚠️ 未运行，见 §5 Q2 |

## 3. dev 环境（`dev-default`）

端口来源：dev 机 `pm2 jlist` 实测 ✅

| 服务 | 主机组 | 端口 | 现库值 | 动作 |
|---|---|---|---|---|
| gateway | dev-default | 6000 | `175.27.189.123 / 6000` | 改组名 |
| auth-service | dev-default | **6001** | `175.27.189.123 / 6001` | 改组名（与本机 6101 **不同**，勿统一）|
| user-service | dev-default | 6002 | 同 | 改组名 |
| ai-service | dev-default | 6003 | 同 | 改组名 |
| system-service | dev-default | 6004 | 同 | 改组名 |
| todo-service | dev-default | 6005 | 同 | 改组名 |
| mcp-gateway | dev-default | 6006 | 同 | 改组名 |
| content-hub | dev-default | 6007 | 同 | 改组名 |
| upload-service | dev-default | 6008 | 同 | 改组名 |
| ai-agent | dev-default | 6010 | 同 | 改组名 |
| knowledge-service | dev-default | 6011 | 同 | 改组名 |
| deploy-console | dev-default | 6200 | 同 | 改组名 |
| finnews | — | — | `dev-default` 无端口 | ⚠️ 未运行，见 §5 Q2 |

## 4. prod 环境（`prod-default`）

端口来源：prod 机 `ss -lntp` 实测 ✅

| 服务 | 主机组 | 端口 | 现库值 | 动作 |
|---|---|---|---|---|
| gateway | prod-default | 3000 | `106.52.176.246 / 3000` | 改组名 |
| auth-service | prod-default | 3001 | 同 | 改组名 |
| user-service | prod-default | 3002 | 同 | 改组名 |
| ai-service | prod-default | 3003 | 同 | 改组名 |
| system-service | prod-default | 3004 | 同 | 改组名 |
| todo-service | prod-default | 3005 | 同 | 改组名 |
| mcp-gateway | prod-default | **6006** | 同 | 改组名（prod 上仍是 6000 段，非 3006）|
| content-hub | prod-default | **6007** | 同 | 改组名（同上）|
| ai-agent | — | — | 无 | ⚠️ prod 未监听 6010 → **不建指向**（探活 fail-fast 即正确行为）|
| knowledge-service | — | — | 无 | ⚠️ prod 未监听 6011 → 同上 |
| upload-service | — | — | `prod-default` 无端口 | ⚠️ prod 未监听 6008 → 建议**删行**，保持"未配置" |
| deploy-console | — | — | `prod-default` 无端口 | ⚠️ 跑在堡垒机？见 §5 Q3 |
| finnews | — | — | `prod-default` 无端口 | ⚠️ 未运行，见 §5 Q2 |

## 5. 待确认

| # | 议题 | 现状 | 需要你定 |
|---|---|---|---|
| **Q1** | `staging` 残留 | `deploy_service_envs` 有 9 行 `env_id=staging`（`staging-default`，无端口），但 `deploy_envs` 无 staging | 建议**删除这 9 行**（脏数据，前端永远看不到）。确认？ |
| **Q2** | `finnews` | 三环境均未运行（不在 `ecosystem.config.cjs`，dev/prod 均无监听） | 建议**服务置停用**（`deploy_services.enabled=0`）并删掉三行空指向。确认？ |
| **Q3** | `deploy-console` 的 prod 指向 | prod 机未监听 6200；记忆里 console 跑在堡垒机 `101.43.117.234`（本次 ssh 公钥被拒，未实测） | 堡垒机上 console 是否在跑、端口多少？确认后决定新增 `bastion-default` 主机组还是留"未配置" |
| **Q4** | prod 缺的三个服务（ai-agent / knowledge-service / upload-service） | prod 机未监听 | 是"prod 确实不部署它们"（→ 保持未配置）还是"待上线"（→ 先留占位？） |
| **Q5** | `deploy_services.default_port` | 13 个服务该列**全为空** | 按 Q19 不再依赖它。是否**清空语义**（保留列但弃用）或直接不管？建议保留列、代码不读 |

## 6. 入库草案（确认后执行，幂等）

> 执行前先备份两张表；DB 路由默认关闭（`GATEWAY_DB_ROUTES≠1`），写入不会立即改变转发。

```sql
-- ① 主机组：name 由 IP 改为组名（host 保持 IP）
UPDATE deploy_hosts SET name='local-default' WHERE host='127.0.0.1';
UPDATE deploy_hosts SET name='dev-default'   WHERE host='175.27.189.123';
UPDATE deploy_hosts SET name='prod-default'  WHERE host='106.52.176.246';

-- ② 指向：host_name 由 IP 改为组名（按环境）
UPDATE deploy_service_envs SET host_name='local-default' WHERE env_id='local' AND host_name IN ('127.0.0.1');
UPDATE deploy_service_envs SET host_name='dev-default'   WHERE env_id='dev'   AND host_name IN ('175.27.189.123','dev-default');
UPDATE deploy_service_envs SET host_name='prod-default'  WHERE env_id='prod'  AND host_name IN ('106.52.176.246','prod-default');

-- ③ 清理脏数据（Q1 / Q2 确认后）
DELETE FROM deploy_service_envs WHERE env_id='staging';
DELETE FROM deploy_service_envs WHERE service_key='finnews';

-- ④ 校验收尾
SELECT env_id, COUNT(*) n FROM deploy_service_envs GROUP BY env_id;
SELECT service_key, env_id, host_name, port FROM deploy_service_envs
 WHERE host_name IS NULL OR port IS NULL ORDER BY service_key, env_id;
```

校验期望：④ 第一行 `local=12 / dev=12 / prod=8`（prod 少的 5 个 = prod 上确实未部署）；第二行**应为 0 行**（不允许留"有主机无端口"的半配置）。

## 7. 执行结果（2026-09-20 已入库）

备份：`deploy_hosts_bak_20260920`、`deploy_service_envs_bak_20260920`。

| 项 | 结果 |
|---|---|
| 主机改名 | `local-default` / `dev-default` / `prod-default` 各 1 行 ✅ |
| 指向改组名 | local 13 → 12、dev 13 → 12、prod 11 → 8（删 staging 10 行、finnews 3 行、半配置 2 行）✅ |
| 半配置残留 | **0 行** ✅ |
| `finnews` | 服务置停用 ✅ |

**按新逻辑（主机组 → 地址 → `/health`）实测探活**：配置解析失败 **0**；健康 6 / 非 2xx 或不可达 26。分布与结论：

- **prod（8 项全部可达）**：`ai-service` 200，其余 404/401 —— 端口与地址**都对**，404 是这些服务**没实现 `/health` 路由**（`deploy_services.health_path` 默认 `/health` 与实际不符）。
- **local（12 项）**：`ai-agent` / `ai-service` / `knowledge-service` / `deploy-console` 200，其余 404（同上，健康检查路径问题），`gateway` 连接失败（本机 6000）。
- **dev（12 项全部超时）**：仅 `deploy-console:6200` 通 —— dev 机**安全组只放行了 6200**，6000–6011 未开放，属网络策略而非配置错误。

## 8. 下一步

1. **修探活路径**：逐个服务确认真实健康检查路径（多数 Nest 服务没有 `/health`），改 `deploy_services.health_path` 或补路由 —— 否则探活永远显示失败。
2. **dev 安全组**：若要从 console 探活/远程部署 dev，需放行 6000–6011（当前只有 6200）。
3. **发布生效**：本次改动涉及 deploy-console（后端 hosts 模块 + 前端两页 + 主机管理页）与 gateway（主机解析）。deploy-console 走 `./scripts/publish-deploy-console.sh`，gateway 走流水线（env=local）—— 两者都要求先把改动 **commit & push** 到当前分支。
4. 探活全绿后再考虑开 `GATEWAY_DB_ROUTES=1`（开启后 DB 路由才真正接管转发）。
