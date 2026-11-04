# 环境事实巡检（Fact v1）运维手册

> 一句话：**定时把「线上真实态」采回来，和「平台认为的期望态」比一比，不一致就告警。**
> 它不修任何东西 —— 采集只读、漂移只报（设计约定）。
> 设计出处：《console 建设方案》P0-6；评审报告：`docs/development/release-reviews/2026-10-14-fact-snapshot-v1.md`。

## 为什么要有它

过去几起事故本质是同一个：**没人能回答"线上现在到底是什么"**。

| 事故 | 平台/文档说的 | 线上实际 | 怎么发现的 |
|---|---|---|---|
| 双树运行 | 发布树是 X | pm2 跑的是另一棵树 | SSH 上去人工看 |
| 静态根落点 | 指针写到本机根 | 目标机读的是外置根 | 出问题后倒推 |
| 迁移空跑 | 迁移已执行 | 实际没执行 | 迁移表 ≠ 真实 schema |

文档解决不了（文档会再漂移），只有**定时采集 + 自动比对**能解决。

## 采什么

| 事实 | 期望态来源 | 真实态怎么采 |
|---|---|---|
| `version` | `deploy_app_env_versions.current_version` | 读版本指针 `index.js` 里的 commit 引用 |
| `dir` | 同上（登记版本应有产物） | 版本目录条目数（0 = 产物不在了） |
| `process` | `deploy_service_envs`（active，`pm2_name` 回落 `service_key`） | `pm2 jlist` 里的 status |
| `port` | `deploy_service_envs.port` | `ss -ltn` 是否在监听 |

采集通道：**本机**（静态根无 sshTarget）直接执行；**远端**走 `SshExecService.run(env, ...)` ——
目标机解析的唯一入口，不另推导一遍。

## 怎么看

```bash
# 最近一批的全部事实
SELECT kind, target_key, expected, actual, status, host, collected_at
FROM deploy_fact_snapshots ORDER BY collected_at DESC LIMIT 50;

# 只看要人盯的（drift / missing / error）
SELECT kind, target_key, expected, actual, status, detail
FROM deploy_fact_snapshots
WHERE batch_id = (SELECT batch_id FROM deploy_fact_snapshots ORDER BY collected_at DESC LIMIT 1)
  AND status IN ('drift','missing','error');
```

API（与 `monitor` 同族的运维接口，需登录态）：

| 接口 | 用途 |
|---|---|
| `GET /api/fact/envs` | 当前允许采集的环境列表 |
| `GET /api/fact/snapshots?env&kind&limit` | 最近快照 |
| `GET /api/fact/drift?env` | 最近一批的漂移清单 |
| `GET /api/fact/last?env` | 最近一批摘要（checked/drift/missing/error） |
| `POST /api/fact/collect` | 手动触发一次（同一环境在采集中返回 409） |

## 开关（全部有默认值，缺失 = 默认行为）

| 键 | 默认 | 说明 |
|---|---|---|
| `FACT_SNAPSHOT_ENABLED` | `true` | 总开关 |
| `FACT_SNAPSHOT_INTERVAL_MS` | `21600000`（6h） | `0` = 关定时，仍可手动触发 |
| `FACT_SNAPSHOT_ENVS` | `dev` | 逗号分隔；**prod 需显式加入** |
| `FACT_SNAPSHOT_FIRST_DELAY_MS` | `60000` | 启动后首次延迟 |

想彻底不影响：`FACT_SNAPSHOT_ENABLED=false` 重启即可（TC **C6 回滚路径**）。

## status 怎么读

| status | 含义 | 该做什么 |
|---|---|---|
| `ok` | 与期望一致 | 不用管 |
| `drift` | **不一致**（如指针指向别的 commit） | 查最近一次发布是否没走流水线 / 指针没切 |
| `missing` | 期望有、线上没有 | 确认是不是被误删 / 发布失败 / 登记有误 |
| `unknown` | 采到了但**没人说过应该是什么** | 补期望态登记（不告警，但不能假装 ok） |
| `error` | **采集机制故障**（SSH 错 / 超时 / 命令被拒） | 先修采集链路，别急着改业务 |
| `skipped` | 不适用 / 未配置 | 通常不用管；`detail.reason` 写了为什么跳过 |

> `drift` / `missing` 是**业务问题**，`error` 是**采集链路问题** —— 两者的处理完全不同，别混。

## 只读约束（改动前必读）

采集是**定时自动跑**的，一旦能拼任意命令，这个模块就从"观测"退化成"远程执行通道"。因此：

1. 命令必须先过白名单：只允许 `cat` / `ls` / `md5sum` / `stat` / `test` / `readlink` / `pm2 jlist` / `ss -ltn`；
2. 危险字符（分号、逻辑运算、命令替换、重定向、`rm`/`mv`/`kill` 等）一律拒绝，前有单测锁住；
3. 管道只允许 `| wc -l`；
4. **`pm2 jlist` 只取 5 个安全字段**（name / pid / status / cwd / restarts），
   **不落 `pm2_env` 的环境变量** —— 那里面可能有 DB 密码，落库 = 密钥入库事故。

新增采集项时：先加命令构造函数 → 补白名单单测 → 再接 service。

## 排障速查

| 现象 | 原因 / 处理 |
|---|---|
| 一条 `version` 长期 `skipped` | 该模块是 index.html 入口型产物，无 SystemJS 版本指针 —— 属正常（`detail.reason` 会写明） |
| `process` 全 `missing` 但服务正常 | `deploy_service_envs.pm2_name` 与真实 pm2 进程名不一致 → 补齐 `pm2_name` |
| 全是 `error` 且 detail 带 SSH 关键字 | 目标机不可达 / 主机管理未登记 / 私钥路径不对 |
| 表根本没建 | console 库的 `synchronize` 未开（见评审 C1）；新环境须手工同步一次 |
| 想临时停 | `FACT_SNAPSHOT_ENABLED=false` + 重启，或直接 `INTERVAL_MS=0` 只关定时 |
