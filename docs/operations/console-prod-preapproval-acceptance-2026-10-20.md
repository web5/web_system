# Todo/prod 审批前准备验收（2026-10-20）

## 结论与范围

新单 `1792411988185-xbs5fou` 的发布前准备已完成，可以进入人工发布审批。新审批 `1792412011617-rlk43vg` 仍为 pending，新单仍停在 `awaiting-approval` /「发布确认」，发布闸门绑定该新单。本轮没有批准审批、启动新业务版本、重启服务或执行生产 DDL。

本结论仅适用于当前生产 MySQL 配置、固定提交 `6a7106863d1d18a041752cb8ae86d9239a4a2e2c` 和下述确切产物摘要；不是正式上线成功或回滚演练完成的结论。产品源码本轮未修改，未复用旧候选 `e1618537` 或同名不同摘要产物的验收结果。

## 本次候选产物

- 完整引用：`todo-service-dev/6a710686`。`todo-service-dev` 是既有流水线命名空间，本单实际目标环境为 prod。
- Git commit：`6a7106863d1d18a041752cb8ae86d9239a4a2e2c`。
- 载荷：20,739 个文件，SHA-256 `e80955d81b6d8229d8cc52a2686b1dea3f58ebfafc50d85e2eb7756475741847`。
- 冻结归档：54,930,757 bytes，SHA-256 `5fb60bc1be2c941ffba69675306b81a849a4c8d8871b1a690050f5bdb2c1b172`。
- 从新单的真实构建目录核对 HEAD 和完整载荷后，在 dev 独立准备目录冻结，通过已核对的 prod 目标及严格 SSH known_hosts 直传，生产侧再次核对归档与载荷摘要。
- 候选先在 `/root/web_system_artifact_preparation/todo-closeout-20261020/candidate` 验收，再通过已评审的不可变产物发布器固化到 `/data/web_system/servers/todo-service/todo-service-dev/6a710686`。没有激活该目录，也没有提前把候选写成已发布的版本记录。
- 正式发布时若构建目录内容漂移，同名版本发布会因摘要不同被拒绝，不会覆盖这份已验收的不可变版本。

## 真实恢复点发布与登记

- 引用：`runtime-checkpoint/todo-prod-1792396360725`。
- Git 来源：未知，manifest 和版本登记的 `gitCommit` 均为 null，不把现场采集结果伪装成某次 Git 构建。
- 载荷：20,675 个文件，SHA-256 `915929c9fb94b34432488d14f43e25e40acc749c665424d2719bc0338046b722`。
- 原始归档 SHA-256 `312ee2bd2a11962a842ae6c65904cac1cfc8565d55b9501286858f11ff8e0a11`，保留既有异机副本和私有配置/PM2 备份。
- 对真实生产现场重新核对：当前运行 dist 仍为 43 个文件，SHA-256 `bf052d62778059fe610001e69239496ddc7d2157a29383c6a0e0b2b1882af772`，与该恢复点采集来源一致。
- 通过不可变发布器发布到 `/data/web_system/servers/todo-service/runtime-checkpoint/todo-prod-1792396360725`，再对已发布目录执行完整 inspect。没有替换当前 dist。
- 通过 Console 标准内部版本 API 登记恢复点，备注明确其现场采集来源、完整载荷摘要和非业务发布属性，旧 `b08b2199` 历史记录保留。

## 生产侧兼容验收

候选和恢复点分别在实际生产机器上验证：

1. 与生产 Node ABI 127、Linux/x64 匹配，包完整性和依赖边界检查通过，包不包含运行配置文件。
2. 使用各自产物中的 TypeORM/MySQL 依赖连接实际生产 MySQL，两份均为 2 个实体、0 schema 差异。
3. `synchronize=false`、`migrationsRun=false`、`dropSchema=false`，执行语句受只读白名单限制，没有执行 DDL。
4. 隔离子进程中 MySQL 驱动和 AppModule 加载通过；阻断网络、监听和子进程，不初始化业务应用、不启动新服务。
5. SQLite 原生依赖检查未通过；生产选择 MySQL，因此本次不宣称 SQLite 可用。
6. 生产配置指纹再次核对通过，配置中心内容响应 204，未写 `.env` 或 `.env.generated`。

## 当前引用对齐与安全边界

通过共享发布锁串行维护 Todo/prod 的提交及模块范围。先保存元数据备份，再使用 Console 标准版本/指针 API：

- 控制台库与 prod 云库的 Todo 当前引用均从裸 `b08b2199` 对齐到完整真实恢复点 `runtime-checkpoint/todo-prod-1792396360725`。
- 这是对现有运行现场的账本引用校正，不是把新候选切上线；对齐前后均重新检查运行 dist、PID 和真实恢复点摘要。
- 不修改其他模块/环境的版本指针，不覆盖旧版本历史，不更改新旧 run 的状态或任何审批结果。
- 维护锁在 finally 中释放，最终无 running/pending 发布任务或残留锁。
- 生产 10 个服务均 online、健康检查均 200、PID 保持原值；Todo PID 为 2562346，实际运行仍是原来的 dist。

准备期间一次接收前检查把 PM2 动态监控字段误计入运行身份而保守拒绝。校正为 PID/状态/cwd/script 等稳定身份字段后重试；完整 dist、配置文件摘要、启动覆盖摘要及其他服务 PID 比对仍保留。失败诊断没有覆盖或删除，拒绝发生在接收解包前，没有造成业务文件变更。

## 证据与后续

- 生产准备目录：`/root/web_system_artifact_preparation/todo-closeout-20261020`，包括冻结候选、工具、schema/离线验证和发布回执。
- 本地私有证据：`/tmp/web-system-console-closeout-20261020`，包括两库对齐、正式就绪审计、生产健康清单和最终摘要。
- 元数据变更前备份及标准审计 ID 记录在上述目录的 `registry-alignment.json`；远端备份位于 `/home/ubuntu/web_system_backups/console-closeout-20261020-*`。
- 新单仍待人工审批。只审批 `1792412011617-rlk43vg`，不要批准历史审批或重跑旧失败单。
- 批准会正式触发生产发布，随后仍需验证新版本健康、实际版本指针，并完成受控回滚演练。正式发布/回滚闭环完成前，不把 Console 生产交付标记为全部完成；本轮结束后应将发布闸门恢复为 closed。

## 审批后的结果更新

用户已通过 admin 批准该新审批；正式发布及发布结果验收完成，实际隔离版本为 `todo-service-dev/6a710686`，载荷与本验收摘要一致，控制台/云库指针一致，10 个生产服务健康。Todo PID 为 2917160，其他服务 PID 和生产配置未变，闸门已恢复 closed。尚未执行生产回滚演练。完整结果见 `docs/operations/console-todo-prod-release-acceptance-2026-10-20.md`；本节之前的 pending/未激活描述是审批前阶段状态。
