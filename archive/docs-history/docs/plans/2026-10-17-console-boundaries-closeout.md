# Console 安全修复收口报告（2026-10-17）

> 时间均为北京时间。结论：安全边界修复已部署 dev，模块回滚实测通过；不是 Console 全量验收完成。未操作 prod，未执行现网 schema DDL，源码未提交/合入。
> 本文保留 2026-10-17 部署版本证据。2026-10-18 S1c 新建构建发现依赖准备遗漏，后续本地补丁尚未部署；当前进展见 [S1c 续验记录](2026-10-18-console-s1c-build-preparation.md)，本文源码摘要不代表后续工作树当前状态。
> 入口：[三主线计划](2026-10-16-three-track-delivery-plan.md)、[安全门](2026-10-17-console-release-safety-gates.md)、[验收矩阵](2026-10-16-console-acceptance-baseline.md)、[dev 对齐记录](2026-10-16-console-dev-alignment.md)。

## 1. 已完成修复

| 范围 | 修复及已核验证据 | 尚未覆盖 |
|---|---|---|
| 前序缺陷 | release_plan 按微前端环境/版本目录检查；不存在模块返回 404 | 不代表所有模块模式均已真实发布 |
| 构建隔离 | 拒绝构建/运行目录重合、包含及软链绕过；Git 脏状态与 clean 预览保护；submit 在创建 run 前检查，shell 检查实际 cwd 与最终 RELEASE_DIR | 新建 run 真实 git/build 对运行根和备份无影响仍待补证 |
| 历史 run | RELEASE_WORKSPACE_CUTOVER_MS 栅栏覆盖提交、shell 和两种审批，拒绝旧 run 时不改审批状态 | 不自动迁移旧 run；需要新建、重新评审 |
| 模块回滚 | component 进入 rollbackUnified；空 component 拒绝，MCP 必填；失败不降级整站恢复；成功跳过重复版本记录 | 非 MCP 的无 component 整站恢复仍是独立能力，未做实机演练 |
| 对外契约 | DTO、MCP rollback 声明与接口文档同步；prod confirm 保护保留 | 整包 gateway 的 schema 兼容问题单列后续 |

## 2. 本地验证与源码身份

- 全量 Console 测试：89 suites / 1066 tests 通过；Console 和 MCP gateway 构建通过。最后仅补充接口文档，未改运行代码。
- 独立工作树：`<workspace>/.worktrees/console-acceptance-fixes-20261016`，基线 `e16185379d860ab9fa009fa64152d95eff3bee68`，未提交、未合入。
- 源码清单含 20 个源码/测试/契约文件；按排序后的 `{file, sha256}` 数组计算 SHA-256：`de91cca6f5d77f3d8adf9873f80b599710ec2babea680fcadc216131a5ce06e6`。不含本文及其他主工作区报告。
- 清单与测试/构建日志：本机私有目录 `/tmp/web-system-console-cutover-20261017/` 中的 `source-manifest.json`、`full-jest.json`、`full-jest.log`、`console-build.log`、`mcp-build.log`。临时目录不是永久归档承诺。

## 3. dev 实际变更

2026-10-17 02:04:11–02:04:27 完成激活，仅重启 dev Console；MCP gateway 未重启，其他进程在激活前后保持不变。

| 项目 | 激活后的事实 |
|---|---|
| 构建 checkout | `/home/ubuntu/web_system_build/console-acceptance-20261017-offline`，HEAD `c38423cc94021c4c15b583d53a811c5cd2de6a59`；工作树干净，依赖实际位于构建目录，Git remote 使用 SSH |
| RELEASE_WORKSPACE | 指向上述独立构建 checkout |
| WEB_SYSTEM_DIR | `/data/web_system`，运行根不变 |
| STATIC_PUBLIC_ROOT_DEV | `/data/web_system/servers/gateway/public`，不随构建目录迁移 |
| RELEASE_WORKSPACE_CUTOVER_MS | `1792173663816` |
| 数据库 | Console 候选与现网 schema 零差异；未执行现网 DDL；临时探针数据库已全部删除 |
| MCP 兼容范围 | 基于实际已部署的 mcp.service.js 仅替换 rollback 声明对象；只更新既有一条 deploy/rollback 工具记录的 description/params，保留 ID，mcp_modules 不变 |

完整 MCP 候选探测存在 24 项 schema 差异，因此没有整包部署 gateway，也没有为上线工具声明强推迁移。新建 SDK 会话 tools/list 已确认 rollback 可见、component 必填。实际 MCP 声明文件 SHA-256：`f0a0945a90a7e9a1acb9ed5d191cf8cad2560e5958b4a3ecaeecb121f512240d`。

既有 prod todo-service run `1790749237193-nn2w34p` 保持 awaiting-approval，approval `1790749249606-mncs8f1` 保持 pending。只读求值切换栅栏确认返回 409，未调用其实际审批 API，未批准、取消或重跑。

## 4. admin/dev 模块回滚实测

| 场景 | 任务 ID | 结果 |
|---|---|---|
| 不存在产物 | `1792174189316-k3brvl1` | failed；基线 e2a2866c 不变，无整站恢复 |
| 切换保留历史版本 | `1792174193247-g44latf` | success；e2a2866c → 6e7b2690 |
| 恢复测试前当前版本 | `1792174197547-vpfgexg` | success；6e7b2690 → e2a2866c |

每阶段均验证 release_verify=verified、DB 版本与磁盘指针一致；HTTP 指针、index.js、index.css、主 chunk 共 4/4 返回 200 且与磁盘字节一致。任务有操作者及模块回滚日志，无整站脚本日志；其他模块/环境指针、审批和流水线集合不变。

最终 admin/dev 为 current_version=e2a2866c、previous_version=6e7b2690。保留实际回滚历史，不用 SQL 把 previous_version 改回。新增的三条任务为真实审计记录，未删除。流水线仍为 152 条，本次没有提交全量构建发布 run。

证据：`module-rollback-result.json`、`mcp-and-legacy-smoke.json`、`final-readiness.json`、`activation-result.json`；这些汇总文件仅含脱敏结论，其他原始私有响应不得进入仓库。

## 5. 回退材料与操作边界

- dev 持久备份：`/home/ubuntu/web_system_backups/console-cutover-20261017`，目录 0700，配置/工具快照等敏感文件 0600。包含旧 console.env、旧 mcp.service.js、旧 rollback-tool.json、旧 Console dist、激活清单和回执。
- 02:35 完成校验：旧配置、MCP 文件、工具记录副本摘要一致；旧 Console dist 共 939 文件，目录摘要 `d22239a2c87f668c966e8dd65797a0d22620eab75415f99d87eff4d3481a4de5`。校验回执见 `durable-backup.json` 及持久目录内 `backup-verification.json`。
- 旧 dist 同时保留于 `/data/web_system/servers/deploy-console/dist.previous-boundaries-20261017`；原临时备份和回执不删除，远端激活回执已补记 durableBackups。
- 紧急回退需先确认无活动 run/task/锁，备份当前状态；Console 旧 dist 与旧配置、MCP 声明与对应工具元数据应配套处理，不能仅改数据库或覆盖单个任意文件。恢复旧目录配置会重新引入 B01 风险，旧 rollback 声明会重新引入模块范围风险，未重新修复前不得继续构建/模块演练。
- 备份可用不等于已实测完整服务回退；本次只做模块版本切换及恢复。不要把含凭据配置、数据库快照或工具原始元数据提交 Git。

## 6. 剩余 S1c 与下一步

1. 新建 dev run 完成真实构建→投递→激活，提交前后核对运行根、持久备份及其他模块摘要；不恢复或审批旧 prod run。先评估 dev 内存与构建负载，不直接启动多路重构建。
2. 分别验证 shell/site-version、后端产物的发布/重启/探活及回退，不能套用 admin/env-dir 结果。
3. 浏览器登录态主流程与关键资源检查；并发、取消、重复请求、无权限、配置/构建/投递失败及状态一致性矩阵。
4. 单列 prod 只读适用性核查及差异；任何生产发布/回退需另行确认。另行处理整包 MCP gateway 的 schema 兼容与发布方式，不借本轮强推迁移。

完成这些后才出 Console 总验收结论，再继续 Content-hub M1/M2 与 Agent B0/B1。WorkBuddy 已处理的模型计费/数据库配置问题不在本轮重新排查。
