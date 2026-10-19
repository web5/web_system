# 运行根统一到 web_system

## 目标和不可变边界

服务器运行代码根统一为 `/data/web_system`，不再把 `/data/web_system_git` 作为新发布目标。控制台部署与后端产物巡检复用同一解析规则：环境级 `WEB_SYSTEM_DIR_<ENV>`、全局 `WEB_SYSTEM_DIR`、默认 `/data/web_system`；旧 `web_system_git` 配置显式拒绝，不能静默选择另一棵树。

这不等于把所有目录合并：

- `RELEASE_WORKSPACE` 必须仍是独立构建 checkout；不得指向运行树或兼容软链。
- 生产静态根 `/data/web_system_static/public` 不搬迁，Nginx/Gateway 继续使用现有静态配置。
- 隔离后端依赖目录 `web_system_runtimes` 不搬进运行仓库，避免 Node 回落共享依赖。
- 历史版本、旧运行树、环境文件和用户数据不删除、不覆盖合并。
- 原待审批生产 run 保持 pending；目录统一不等于允许恢复旧 run。

## 默认只生成计划

`scripts/normalize-runtime-root.cjs` 仅使用 Node 内置模块。脚本默认只读，读取既有 PM2 的进程引用和受控文件摘要，不启动 PM2 守护，不安装依赖，不初始化应用或迁移数据库。

在目标机独立工具目录运行经评审的脚本，或使用已有受控只读执行通道；不要为了获取计划触发发布流水线。

```sh
node normalize-runtime-root.cjs --plan \
  --root /data/web_system \
  --legacy /data/web_system_git \
  --output /root/runtime-root-plan.json
```

输出仅包含路径、进程引用、文件数和摘要，不输出 `.env` 的值。计划文件以 0600 创建；已经存在的输出不会被覆盖。

计划会区分已统一、旧树需提升和有歧义的双运行树。两个目录都有实际进程入口、没有可确认的旧树来源、外部 Git worktree 元数据或异常软链时，不自动选择或合并。

## 实际生产盘点

2026-10-19 维护前的只读计划识别到 10 个在线进程引用旧树，模式为 `promote-legacy-tree`。当时 `/data/web_system` 中已有另一棵旧代码树，不能直接覆盖，也不能把“改了配置路径”当成运行进程已切换。

用户随后明确授权立即进入维护窗口，已完成离线 apply 和服务复验，结果见本文末尾。脚本仍拒绝在线 apply；本次有停服和重启，不是热迁移或零停机承诺。

## 窗口内执行顺序

1. 暂停所有发布/安装/巡检清理写操作，确认无部署任务或发布锁；保存并私有备份原 PM2 dump、主机/流水线/配置 revision。PM2 dump 可能含密钥，权限应为 0600，不进入 Git。
2. 在独立目录生成新计划，核对计划指纹、10 个服务和真实回退材料；不要复用已失效的计划。操作者 shell 的 cwd 也离开两个运行根。
3. 按维护窗口停止引用两棵树的进程，保持原 PM2 进程记录，不 `pm2 kill`/删除记录。脚本还会检查 `/proc` 中仍占用这些路径的进程；不能用强制选项绕过。
4. 执行经过核对的计划：

```sh
node normalize-runtime-root.cjs --apply /root/runtime-root-plan.json \
  --confirm-root /data/web_system
```

脚本只做同文件系统 rename：旧目标完整移到独立 `web_system_backups/runtime-root-*/web_system.before`，再将活动旧树提升为 `web_system`，保留 `web_system_git → web_system` 兼容链接。不会递归复制覆盖，不删除任一代码树，不改静态根/构建根，也不自行重启。

计划后受控运行文件、Git 引用或进程引用变化，备份根经软链落到任一运行树，跨文件系统或目标身份不符时拒绝执行。中途兼容链接创建等步骤失败时恢复原路径，保留私有回执；不能自行删备份来重试。

5. 收据状态为 `directory-normalized-offline-pending-service-validation`，只代表离线目录步骤完成。仍需在窗口中核对并调整 PM2 的实际入口/cwd、显式环境路径、主机记录及流水线 `PUBLISH_PATH` 为 canonical 路径，再启动、核对 PID/端口/版本/真实 HTTP。不能将仓库根 cwd 的服务自动改为服务 cwd 而跳过配置兼容检查。
6. 兼容链接保留到所有旧绝对路径引用完成迁移，不自动清除。目录切换不会迁移旧后端模板，已知运行仓库 reset 动作仍须单独替换为隔离产物。

每次 rename 后更新私有回执阶段。若进程被强杀、机器掉电或回执仍为 preparing，不能直接重跑 apply：先在维护窗口按两棵树与备份的 inode/device 检查实际阶段，人工恢复或完成路径步骤。各次 rename 原子，但多步切换不是跨进程崩溃原子事务。

## 路径级回退

若要撤销目录切换，先再次停止相关进程，并恢复原来停止状态的 PM2 路径引用；脚本不替你恢复可能含密钥的 PM2 配置。

```sh
node normalize-runtime-root.cjs \
  --rollback /data/web_system_backups/runtime-root-<id>/receipt.json \
  --confirm-root /data/web_system
```

只移除本次创建且目标严格匹配的兼容软链，将提升的树移回旧名，再恢复原目标树；所有文件保留。回执路径、inode/device、备份身份或 PM2 引用不符时拒绝回退，不覆盖后续变更。路径回退不是业务版本回滚，仍需恢复原启动配置并独立验活。

## 代码与脚本门禁

- 后端旧格式落地前检查具体 PM2 服务的真实脚本入口，与登记服务目录不一致则在任何 dist 改写前失败；不再允许复制到闲置树后重启另一棵树的同名进程。
- 隔离运行包保留更严格的单服务 cwd 要求，不为兼容生产旧 cwd 放宽。
- 部署、回滚和 SQL 迁移历史脚本使用 `scripts/lib/runtime-root.sh` 校验服务器根目录名；local SQL 模式不受服务器根校验影响。`deploy.sh` 仍是弃用入口，本次不把它恢复为新发布通道。
- Git 交付使用 `feature/manual-review/` 分支和草稿 PR。auto-pr 和 auto-merge 均排除该分支前缀，不因外部转为 ready 就启用自动合入，质量检查继续运行；不把代码评审授权等同生产切换授权。

## 2026-10-19 维护窗口执行结果

- 获取 10 个后端及 Admin/Portal/Shell 共 13 个生产维护锁，确认无运行中发布、部署任务，远端清理及保留策略未开启写入；私有备份 PM2 完整定义、原 dump、数据库路径变量及模板 revision。完成后仅释放本次 owner 的锁，复查无遗留任务或锁。
- 停止 10 个进程并保留 PM2 记录，执行目录工具；原闲置树保存在 `/data/web_system_backups/runtime-root-6dNcfM/web_system.before`，原活动树成为 `/data/web_system`，保留 `/data/web_system_git -> /data/web_system`。
- 全部 PM2 实际入口已改为 canonical 前缀，cwd 只替换根前缀，保留仓库根 cwd 与服务 cwd 的既有语义。环境键值除明确的根前缀替换外保持一致，全部仍为 production；启动参数和实例定义未重建，完成 `pm2 save`。
- 10 个进程均 online；实际监听端口 6000–6008、6010 的 `/health` 全部 200。最终复查 PID 与逐项启动验证一致。1,125 个受控文件摘要及活动树 inode 与迁移前一致，Git HEAD 仍为 `4b5872d76841ac0c8118a482ac23aa82e2ab1247`；未升级业务代码、安装依赖或执行数据库迁移。
- 静态根保持 `/data/web_system_static/public`；通过 Gateway 的本机 6000 端口核对 Admin 当前、Portal 当前/上一、Shell 当前共 4 个入口，HTTP 200 且 SHA-256 与磁盘文件一致。本机 80 端口不监听，不作为验收入口；本次未验证公网可达性。
- 仅将 10 个现运行后端模板的 `PROD_PATH` 改为 canonical 路径，事务校验维护锁及原值；保留私有前后快照。主机记录、流水线 revision/动作脚本、应用和部署版本指针均未改动，原生产审批仍 pending。
- 工具原始回执保留离线阶段状态，服务级最终验收另存 `/root/web-system-maintenance-20261019/acceptance.json`，不会把目录工具本身的成功等同业务验活。原 PM2 定义与回退工具也在该私有目录；回退须重新获取维护锁，并恢复本次改过的 10 条 `PROD_PATH`，不能仅回退文件路径。

兼容链接暂不移除：历史模板脚本仍有旧根引用，未运行的 deploy-console/mini-contract 路径变量也没有纳入本次 10 个后端的精确更新。mini-contract 涉及独立静态根，不能按后端路径规则盲改。生产旧后端模板迁移、严格服务 cwd、完整产物引用和真实回滚演练仍是后续发布门禁；本次目录维护不代表这些门禁已完成。
