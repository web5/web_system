# 发布评审 · 失效域名 portal.kedouai.com 残留清理（2026-10-08）

> 评审对象：`nginx-proxy.conf`（仓库模板）、`docs/architecture/release-system-design.md`。
> 触发规则：`release-interface`（环境/发布配置面）。判据源：`docs/development/release-review-checklist.md`。

## 阻塞: 0　　重要: 0（DNS 保留为 2026-10-08 已决策的接受项，见 §4）

## 1 事实核查（排查结论）

| 面 | 结论 | 证据 |
|----|------|------|
| DNS | **仍解析**到 gateway（TTL 600），非泛解析（随机子域无记录）；2026-10-08 决策**保留不删** | 随机子域探测空；`portal` A 记录存在且 ENABLE |
| HTTPS | 不可用：证书 SAN 不含 `portal.kedouai.com`，握手报 `SSL: no alternative certificate subject name matches` | curl (60) |
| 线上 nginx | 生效配置**无** portal server 块（请求落到默认 server） | `grep portal.kedouai /etc/nginx/conf.d/*.conf` → 无 |
| 线上残留 | `portal.conf.disabled` + 3 个 portal 相关 `.bak` | 已归档（见 §2） |
| 流量 | 零：`/var/log/nginx/portal.access.log` 大小 0，最后写入 2026-09-11 | ls + tail |
| 数据库 | 干净：`deploy_environments.public_url` 只有 `dev.kedouai.com` / `kedouai.com`；流水线动作脚本与 `deploy_pipeline_vars` 无该域名 | SQL like 查询 |
| 仓库 | 3 个文件 10 处引用（模板 8、架构文档 1、归档迁移注释 1） | grep |

⚠️ **旧表述与实际不符**：此前文档写「portal.kedouai.com 已失效（不再解析）」，但 DNS 实际仍解析 ——
这会让后续排障误判为 DNS 问题。本次已改为「已下线（nginx 无 server 块 + 证书不匹配），勿再引用」。

## 2 已执行

仓库（本 PR）：

- `nginx-proxy.conf`
  - 删除指向 `{{DEV_HOST}}:6000` 的失效 portal server 块（原 158–187 行）及 `/etc/nginx/ssl/portal.kedouai.com/` 证书路径引用
  - 文件头证书段：portal 段落改为「已下线，勿再引用」单段警示
  - 顺带修正同一文件的过期事实：prod 端口 `3000` → `6000`（线上已全量 6000 系）；`portal.conf` 已从线上文件清单移除
- `docs/architecture/release-system-design.md:346`：域名约定改为「2026-09-10 下线，勿再引用」

线上（gateway，配置面，非本次 PR 内容）：

- 归档 `portal.conf.disabled`、3 个 portal 相关 `.bak` 到 `/root/nginx-portal-archive-20261008/`（mv，不删）
- 归档后 `nginx -t` 通过（仅有既存的 `api.kedouai.com` 443 server_name 冲突 warn，非本次引入）

未改动：`archive/migrations/p2-ports-to-addresses.mjs`（历史归档产物，保留原文）。

## 3 判据逐条（A/B/C/D/E）

| 组 | 判据 | 结论 |
|----|------|------|
| A 运行面 | 改的是仓库模板，未部署；线上只归档不加载的 `.disabled`/`.bak`（nginx 只 include `conf.d/*.conf`） | ✅ 无运行面变更 |
| B 配置面 | 未触碰 `servers/*/.env*`；模板内删除的是无对应证书、无 DNS 指向的失效块 | ✅ |
| C 数据面 | 无迁移、无 SQL | ✅ |
| D 前端面 | 无 | ✅ |
| E 特殊通道 | 未改流水线/动作脚本/workflow | ✅ |

**重要（1）**：DNS 的 `portal` A 记录仍未删除（API 子账号无 `dnspod:DeleteRecord` / `ModifyRecordStatus` 权限），
需账号在 DNSPod 控制台手工删除 —— 见 §4。在删除前，「域名解析但不可用」的状态依旧存在。

## 4 DNS 记录：保留不删（2026-10-08 决策）

不删除 `kedouai.com` 的 `portal` A 记录。理由与影响：

- **无收益也无害**：域名零流量（`portal.access.log` 大小 0），保留不会产生访问误导；
  而删除后「被遗忘的子域」风险由第三方视角看反而更低——本次选择保留，属**已接受的长期状态**。
- **必须记住的副作用**：该域名**能解析但访问必失败**（无 server 块 + 证书 SAN 不匹配）。
  ⚠️ 排障时禁止把「能 ping/dig 通」当作域名可用，也禁止据此判断 DNS 异常——这一点已在
  `nginx-proxy.conf` 与 `docs/architecture/release-system-design.md` 的警示语中写死。
- **若日后要删**（需主账号，当前 `~/env_config` 里的密钥无 dnspod 写权限）：
  DNSPod → 域名 `kedouai.com` → 解析记录 → 主机记录 `portal`（A 记录，TTL 600）→ 删除；
  验证 `dig +short portal.kedouai.com A` 为空；回滚即按原值重加 A 记录（默认值同 `kedouai.com`）。
  可用脚本：`~/WorkBuddy/web_system/2026-10-08-portal域名清理/dnspod_record.py`（支持 list / delete）。

## 5 回滚

- 仓库：revert 本 PR 即可（模板文件，无部署面）。
- 线上：`mv /root/nginx-portal-archive-20261008/* /etc/nginx/conf.d/` 后 `nginx -t && nginx -s reload`。
