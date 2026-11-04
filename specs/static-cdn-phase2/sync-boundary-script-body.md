# 边界脚本正文同步清单（upload-remote.sh / clean-remote.sh → DB）

> 配套：`scripts/pipeline/sync-boundary-script-body.sh`
> 归属：Phase 2 静态资源 CDN 化 · PR-A 切片 S8
> 状态：**当前无同步对象**（见 §3 实测），脚本仅作「防未来」的巡检/同步工具。

## 1. 同步对象

仓库里的 `.sh` 是**模板副本**，真正执行的正文在 DB。改模板 ≠ 线上生效，是方案 §5
「DB 脚本是数据」反复强调的坑。

| 模板副本 | DB 落点 | nodeKey | 字段 |
|---|---|---|---|
| `scripts/pipeline/upload-remote.sh` | `deploy_pipeline_step_commands` | `upload` | `command`（单操作）/ `actions[].code`（多操作） |
| `scripts/pipeline/clean-remote.sh` | `deploy_pipeline_step_commands` | `cleanup` | 同上 |

- `upload` / `cleanup` 节点 `commandMode=override`：DB 有脚本时优先执行脚本，否则回退内置
  `RemoteDeliveryService` / `RemoteArtifactCleanupService`。
- 两库：dev `web_system_deploy @127.0.0.1:3306`、prod `web_system_deploy @172.16.16.10:3306`。

## 2. 同步 / 巡检工具

```bash
cd /Users/geekwen/workspace/web_system/scripts/pipeline
./sync-boundary-script-body.sh --check      # 只读巡检（默认）
./sync-boundary-script-body.sh --gen-sql    # 生成 base64 安全 SQL 到 /tmp（不执行）
# 发布窗口：人工审 SQL 后执行 → 复跑 --check 验证两库一致
```

- `--check`：只读，报告两库 `deploy_pipeline_step_commands` 的 nodeKey 分布 + upload/cleanup
  正文的 sha256（不打印正文、不打印凭证）。
- `--gen-sql`：把模板正文 base64 编码后生成 `UPDATE ... SET command = FROM_BASE64('...')`，
  规避 `$`/引号/换行的转义问题（等价参数化绑定，`FROM_BASE64` 是纯 ASCII 安全串）。
- `--apply`：**本脚本不自动执行线上 SQL**，只提示人工审后执行（prod 写操作必须人工确认）。

## 3. 实测结论（2026-11-04）

只读巡检 dev + prod 两库 `deploy_pipeline_step_commands`，结果**完全一致**：

| nodeKey | dev | prod |
|---|---|---|
| build | 14 | 14 |
| git | 15 | 15 |
| prebuild | 11 | 11 |
| release | 14 | 14 |
| **upload** | **0** | **0** |
| **cleanup** | **0** | **0** |

**结论**：两库**均无 upload/cleanup 脚本正文**，线上 upload/cleanup 节点全部走平台内置执行体
（`RemoteDeliveryService` / `RemoteArtifactCleanupService`，已在切片 2/4 完成 CDN 化）。
因此「改了模板但 DB 正文没改 → 线上仍按旧布局」这个坑**当前对象为空**，本轮无同步动作。

> 内置执行体才是当前真相源：切 `CDN_LAYOUT_MODE=cdn` 后，线上 upload/cleanup 行为由内置
> 执行体决定，不受这两个模板副本影响。模板副本只对「未来某条流水线显式配了脚本」有意义。

## 4. 什么时候需要真正同步

仅当**有人给某条流水线在 upload/cleanup 节点贴了脚本正文**（页面编辑）后，改模板才需要同步。
届时流程：

1. `--check` 看哪些 pipeline 的 upload/cleanup 正文与模板 sha256 不一致。
2. 区分「照抄旧模板的」（应同步）与「自定义的」（跳过并告警）——当前工具用 sha256 只报不一致，
   是否覆盖由人判断，**不自动覆盖自定义正文**。
3. `--gen-sql` 生成 SQL → 人工审 → 目标库执行 → 复跑 `--check` 确认两库一致。

## 5. 风险与边界

- 🔴 **禁止自动覆盖自定义正文**：`deploy_pipeline_step_commands` 是「流水线 × 节点」粒度，
  某条流水线的 upload 脚本可能是定制过的；`--gen-sql` 生成的 UPDATE 按 nodeKey 全量匹配，
  执行前必须人工确认没有覆盖自定义（当前无记录，风险为 0）。
- 🔴 **凭证不落盘**：DB 连接从远端 `.env` 读，脚本只透传 `MYSQL_PWD` 环境变量，不打印。
- `--apply` 故意不做自动执行：prod 写操作是不可逆变更，必须发布窗口人工审后执行。
