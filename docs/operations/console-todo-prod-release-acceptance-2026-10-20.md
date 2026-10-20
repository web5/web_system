# Todo/prod 正式发布结果验收（2026-10-20）

## 结果

用户通过 admin 批准新审批 `1792412011617-rlk43vg` 后，新单 `1792411988185-xbs5fou` 已由正常流水线执行到 `succeeded`。实际生产运行版本、完整载荷、健康及控制台/云库指针均已核对，不只是页面状态成功。一次性发布闸门已恢复 `closed`。

正式发布完成；生产回滚演练尚未执行，不把回退点可读或发布器的失败恢复能力说成实际回滚演练完成。本轮没有代理用户批准审批，也没有恢复历史审批或重跑旧失败单。

## 发布与实际运行

- 目标：Todo/prod；版本完整引用 `todo-service-dev/6a710686`。命名空间含 dev 是既有模板 key，不是目标环境。
- 来源：`6a7106863d1d18a041752cb8ae86d9239a4a2e2c`，通过已激活 runtime manifest 和原新单的 requested commit 核对。
- 实际载荷：20,739 个文件，SHA-256 `e80955d81b6d8229d8cc52a2686b1dea3f58ebfafc50d85e2eb7756475741847`，重新遍历已安装 payload 核对，不只读取 manifest 自报值。
- 当前 `dist` 为隔离运行目录链接，实际路径 `/root/web_system_runtimes/todo-service/todo-service-dev/6a710686/dist`，依赖不回退到运行仓库的共享 node_modules。
- Todo PID 从 2562346 变为 2917160；间隔检查 PID 和重启计数保持，6005 监听归属为该 PID，真实 `/health` 返回 200。
- 生产 10 个服务全部 online、健康检查均 200；其他 9 个服务 PID 与审批前基线一致，dev 服务也未因本轮操作变化。
- 原配置文件及启动配置指纹不变，仍为 production/MySQL；没有生产 DDL、运行仓库 reset、生产依赖安装或其他服务重启。

## 流水线与版本账本

新单从「发布确认」恢复时跳过已完成的拉码、构建和审批节点，没有重复构建或创建第二张单。只执行 prod 发布分支，local/dev 分支按条件跳过。

发布动作使用已验收不可变产物；随后写版本、检查完整性、执行单服务隔离激活，验证动作再次执行幂等激活并确认健康，最后通过正常内部指针 API 推进版本。最终控制台和 prod 云库的 Todo 当前引用均为 `todo-service-dev/6a710686`。

版本账本的候选记录已由正常发布动作登记；源码来源以固定 run 请求和实际 runtime manifest 的完整 Git commit 验证，不把未填写的账本 `git_commit` 字段说成已填写。真实恢复点记录继续保留 `gitCommit=null` 的现场来源语义，没有重写旧 `b08b2199` 历史。

## 闸门关闭与审计

在核对新单 succeeded、新审批 approved、实际进程及两库指针后，使用提交/模块范围维护锁和事务，仅将模板 `tpl-todo-service-dev` 的 `PROD_RUNTIME_ROLLOUT_RUN_ID` 从本次新单 ID 恢复为 `closed`。

通过标准变量服务更新并记录审计，变更前状态和回执保存在 `/home/ubuntu/web_system_backups/console-release-closeout-20261020-*`，具体目录见本地私有回执 `/tmp/web-system-console-release-20261020/gate-closed.json`。其他流水线变量、新旧 run 和审批结果不变，维护锁已释放。没有 running/pending 发布任务或残留锁。

旧历史 run `1790749237193-nn2w34p` 仍为 awaiting-approval、其原审批仍 pending；前一失败单 `1792410766024-cp7liak` 仍 failed、其原批准结果保留。

## 回退材料与剩余工作

真实恢复点 `runtime-checkpoint/todo-prod-1792396360725` 仍已发布、登记且完整性检查通过：20,675 个文件，载荷 SHA-256 `915929c9fb94b34432488d14f43e25e40acc749c665424d2719bc0338046b722`。其实际生产 MySQL、离线模块验证见审批前验收文档；SQLite 原生能力仍不在通过范围内。

目前剩余的是单独安排受控生产回滚演练。演练会再次切换生产运行版本、重启 Todo 并改两库指针，不属于本次新单批准的自动后续动作，本轮没有擅自执行。需分别验证回退至真实检查点、健康和指针一致性，再按明确计划恢复当前新版本，并再次关闭闸门。不能仅通过检查点 inspect 或幂等激活的成功声明该闭环已完成。

本地私有证据 `/tmp/web-system-console-release-20261020` 包含真实运行检查、两库状态、闸门关闭回执、全量生产健康清单和最终摘要；无密钥进入此文档。审批前准备记录见 `docs/operations/console-prod-preapproval-acceptance-2026-10-20.md`。
