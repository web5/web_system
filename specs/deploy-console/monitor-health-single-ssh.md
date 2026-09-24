# 服务监控探活：单 SSH 会话批量探活（修复 MaxStartups 限流误报）

> 服务：`servers/deploy-console`（`src/monitor/monitor.service.ts`，端口 6200）
> 状态：已实现（commit e25b1fe），dev 环境实测验收通过
> 关联：`docs/development/console-monitor-followups.md`（dev 监控改造待办）、`specs/deploy-console/api-design.md` §通用约定「命令注入防护」

## 1 问题

服务监控页（DEV 页签）随机出现个别服务「离线 / timeout」，但目标机器上服务进程正常、端口在监听、直连 curl 秒回。

### 证据（2026-09-24 12:40 复现）

- dev 机 `pm2 jlist`：upload-service `online`；`lsof -i tcp:6008` 有 LISTEN；`curl 127.0.0.1:6008/` → `404`（1.5ms）。
- dev 机 `sshd -T`：`maxstartups 10:30:100`（第 10 条之后的并发未认证连接按 30% 概率丢弃）。
- `/var/log/auth.log`：`beginning MaxStartups throttling` / `drop connection #10 ... past MaxStartups`，时间戳与页面误报吻合。

### 根因

`MonitorService.healthCheck()` 对**每个服务各开一条独立 SSH 连接**并行探活（`services.map(async ...)` 内各自 `execSsh`）。dev 环境 12 个模块 → 一次刷新并发 12 条 SSH，超出 `MaxStartups=10` 的连接被 sshd 随机丢弃；被丢弃的那条在 10s 后超时，其 `catch` 分支把该服务判为 `status:'down', response:'timeout'`。

**结论：这是探活机制自身的假阴性，不是服务故障。** 丢哪条是随机的，故现象为「随机某一个服务离线」。

## 2 方案

把 N 条 SSH 收敛为**一条 SSH 会话**：在该会话内用 shell 后台任务 + `wait` 对全部地址并行 curl，一次往返取回全部结果后再解析。

- 远程侧的并行（shell `&` + `wait`）保留低延迟：墙钟时间 ≈ 单个 curl 的最坏耗时，而非串行累加。
- 服务数增长（12 → 20+）不再线性消耗 SSH 连接，天然规避 `MaxStartups` / `MaxSessions`。

### 2.1 远程命令构造

```sh
( r=$(curl -s -o /dev/null -w '%{http_code}:%{time_total}' --connect-timeout 3 --max-time 5 'http://127.0.0.1:6008/' || printf '000:0'); printf '%s|%s\n' 'upload-service' "$r" ) &
( ... 每个服务一段 ... )
wait
```

- 每个子任务把「curl 结果 + 换行」合并为**一次 `printf`**（< PIPE_BUF），避免多子任务并发写同一管道时行内交错。
- 每行格式 `name|httpCode:timeTotal`，与现有 `HealthCheck` 解析保持一致。

### 2.2 注入防护（沿用既有约定）

地址/服务名来自 DB（`deploy_environment` 行的 `address`），拼进 shell 前必须白名单校验，不合法即跳过并 `warn` 记日志：

- `name`：`/^[a-zA-Z0-9_-]+$/`（与 controller 的 `SERVICE_RE` 同规）
- 归一化后的 URL：`/^https?:\/\/[a-zA-Z0-9.-]+(:\d+)?$/`

通过校验后仍用单引号包裹，杜绝 `$`、反引号、空格等被 shell 解释。

### 2.3 超时预算

- 单服务 curl：`--connect-timeout 3` + `--max-time 5`（新增 `--max-time`，防止服务 accept 后不回包把整批拖死）。
- SSH exec 超时：`execSsh` 增加可选 `timeoutMs` 参数，默认保持 10s；**探活批量调用使用 30s**（一次握手 + 远程并行 curl 上界 5s + 余量）。
- 判活口径不变：HTTP 状态码非 `000` 即 `up`（含 404/302），与既有注释一致。

### 2.4 失败语义

| 情形 | 结果 |
|---|---|
| 单服务 curl 失败（连接不上） | `status:'down'`, `response:'000'`（与现在一致） |
| 整条 SSH 失败/超时（连接不上主机） | 全部服务 `status:'down'`, `response:'ssh-failed'`；日志记 `error` |
| 地址不合法被跳过 | `status:'down'`, `response:'bad-address'` |

> 语义变化点：如今 SSH 层故障是「一次失败影响全部」，因此 `response` 从 `timeout` 改为 `ssh-failed`，便于页面上区分「服务离线」与「控制台连不上主机」（前端 `ServiceMonitor.vue` 直接展示 `response` 原文，无需改动）。

## 3 不改动的范围

- `getPm2List` / `getLogs` / `restartPm2` / `checkPort`：单次 SSH、非批量，保持现状。
- `getLocalHealth`（本机探活）：不经 SSH，无此问题；保持现状（本机 execSync 每端口 ~1ms）。
- 前端 `ServiceMonitor.vue`：不改动。

## 4 验收

- V1：`curl` dev 探活结果全部 `up`，且 `/var/log/auth.log` 一次刷新**不再新增** `MaxStartups throttling` 记录（刷新 5 次验证）。
- V2：人为停掉 dev 上一个服务后刷新 → 仅该服务 `down`（`response:000`），其余仍 `up`，不再出现随机 `timeout`。
- V3：`sshd` 的 `MaxStartups` 恢复默认（不调参）前提下 V1/V2 均通过 —— 证明修复不依赖改机器配置。
- V4：构造非法 address（含 `;`、`$()`、空格）写入 DB 行 → 该行被跳过并 `warn`，不进入命令、不影响其他服务。

### 4.1 实测结果（2026-09-24，dev）

- V1 ✓：dev 控制台连续 5 轮 × 10 服务全部 `up`；`auth.log` 的 `MaxStartups throttling` 最后一条停在修复前 12:41:52，之后零新增。
- V2 ✓：`pm2 stop todo-service` 后刷新 → 仅 todo-service `down`（`response=000`），其余 9 个仍 `up`；随后已 `pm2 start` 恢复 online。
- V3 ✓：未改动 dev 的 `sshd` 配置（`maxstartups` 仍为 `10:30:100`）。
- V4：未实测（未向 DB 写入非法地址），依赖白名单正则 + 单引号包裹。
- 附带修正：失败路径原为 `curl -w` 输出与 `|| printf '000:0'` 拼接成 `000:0.000093000:0`，已改为赋值式兜底 `|| r=000:0`，实测输出 `000:0`。

## 5 待确认

- Q1：是否需要顺带对 `getLocalHealth` 也做批量 shell（收益：进程数更少；风险：无）。当前倾向不动。
- Q2：`--max-time 5` 是否过短（个别服务首包慢）。若 V1 出现 `000`，先放宽到 8s 再排查真实原因。
