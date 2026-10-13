# 边界脚本化（S1）：远端投递交给脚本，平台只做裁决

> 适用版本：console ≥ 2026-10-13（PR `feat/boundary-remote-scripts`）
> 相关： [`../operations/pipeline-run-token.md`](./pipeline-run-token.md)（脚本凭据）、
> [`console-bootstrap.md`](./console-bootstrap.md)（console 自举）

## 1. 为什么要做

「平台轻量、机械动作交脚本」落到流水线上的具体含义是：**发布路径上不再由 console 进程
spawn `scp`/`ssh`**。留下来的只有两类 SSH —— 诊断 / 监控（`monitor.service.ts`、老链路
`deploy.service.ts`），业务路径全部交给脚本。

| 维度 | 平台代做（旧） | 脚本代做（新） |
|---|---|---|
| 改一次投递逻辑 | 改 console → 构建 → 发版 | 改 DB 里的脚本文本，下次发布即生效 |
| 私钥暴露面 | console 进程长期持有目标机私钥 | 只在脚本进程生命周期内用到（且注入的是**路径**） |
| 排障 | 只能看平台日志 | 脚本自己打日志、自己报错、自己对账 |

S1 之后发布路径上的平台 SSH 只剩 0 处 —— `upload` 与 `cleanup(remote)` 两个节点。

## 2. 能不能被脚本覆盖：一张表

一个节点能否被脚本覆盖，由 `steps/step-registry.ts` 的 `commandMode` 声明：

| 节点 | commandMode | 有内置执行体 | v5 下脚本能否覆盖 |
|---|---|---|---|
| `check` | base | ✅ | 叠加（安全基线恒执行，命令做附加校验） |
| `git` | override | ✅ | ✅ DB 脚本优先，缺省回退内置 pull |
| `build` | required | ❌ | 必须配命令，未配 fail-fast |
| **`upload`** | override | ✅ | ✅ **本次新增**（此前 v5 判成纯内置，配了脚本也不跑） |
| **`cleanup`** | override | ✅ | ✅ **本次新增** |
| `apply` / `version` / `pointer` | none | ✅ | ❌ 发布语义真相源 |

> **坑记录**：`commandMode` 与 v5 执行分派（`steps/node-exec-plan.ts`）是**两处**。此前 registry
> 早就写了 `override`，v5 分派却只对 `git` 兑现 —— 运维配了脚本、跑起来还是平台那份，
> 且完全静默。现在两者的对应关系被 `OVERRIDABLE_PLATFORM_NODES` 与单测拴住。

## 3. 挂载方式

1. 流水线详情 → 编辑流水线 → 选 `upload`（或 `cleanup`）节点 → 节点脚本；
2. 贴入本仓库 `scripts/pipeline/upload-remote.sh`（或 `clean-remote.sh`）的正文；
3. 保存即生效。**删掉脚本 = 回退到平台内置实现**（存量流水线零改动、零迁移）。

⚠️ 仓库里的 `.sh` 是**模板副本**（可评审、可被 CI 体检），线上执行的正文在 DB。
改仓库文件不会改变流水线行为，改行为请改 DB 里那一份。

## 4. 平台注入的远端变量（保护键）

| 变量 | 含义 | 谁算 |
|---|---|---|
| `REMOTE_SSH_TARGET` | `user@host` | 平台：`SshExecService`（「主机管理 → 服务器管理」），**不读 `DEV_SERVER` 等环境变量** |
| `REMOTE_MODULES_ROOT` | 远端静态产物根 | 三级取值链：`REMOTE_MODULES_ROOT_<ENV>` → `STATIC_PUBLIC_ROOT_<ENV>/static/modules` → 旧常量 |
| `REMOTE_DEST_DIR` | 本次落点 `<根>/<模块>/<版本>` | 平台（与 `uploadDist` 的 dest 同源） |
| `SSH_KEY_PATH` | 私钥**绝对路径**（不是私钥内容） | 平台：与目标机同源（主机管理登记的 `sshKeyPath`，未填则用控制台默认私钥）；都没有则为空 |

三条铁律：

1. **落点必须由平台注入，脚本不要自己拼那条三级链**。prod 的静态根与 dev 完全不同，
   拼错的症状是「投递成功但页面 404」，且日志看不出来（诊断 #3）。
2. **这几个变量是保护键**，配置中心与流水线变量都覆盖不了（`PROTECTED_STAGE_KEYS` +
   `resolveStageVars` 末尾对流水线变量的二次拦截）。理由同 `CONSOLE_API`：
   被改写 = 发布到别处还报成功，最难排查的一类事故。
   `SSH_KEY_PATH` 例外 —— 允许流水线变量覆盖（换私钥路径是合法定制，改错也只是连不上）。
3. **空串 = 未配置**，脚本必须显式报错退出，不能带着空串去连 `""`。

> 「空串」最常见的成因是 **该环境没在「基础设施 → 主机管理」登记**（或登记了但私钥不在控制台所在机）。
> 排查顺序：主机管理有没有这台机 → `sshKeyPath` 指向的私钥控制台读得到吗 → 再看流水线。
> 控制台日志会留一条 `REMOTE_SSH_TARGET / SSH_KEY_PATH 留空` 的 WARN（每个环境只打一次）。

## 5. 两件**不能**下放给脚本的事

这两条写在这里是因为它们有真实事故背书，别照着「统统脚本化」的直觉推翻：

1. **`pull` 的依赖安装与共享包预构建**必须留在平台（`PullExecutor.afterSync`）。
   共享包预构建要求「整条流水线只做一次」，下放给各模块脚本会重现 admin/portal 并发
   时的「并发 mv → 重建」竞态（vite resolve 失败）。`pull.executor.ts` 头部有完整说明。
2. **「保留哪些版本」是裁决，不是机械动作**。当前版本 + 启用中灰度版本的名单由平台算好
   注入 `PROTECTED_VERSIONS`；脚本只读名单执行删除。**名单为空 = 全保护，一个都不删。**
   灰度规则在 DB，脚本不该也不能去读。

## 6. 远端清理模板的额外一个输入

`REMOTE_VERSIONS_DIR`（版本目录层）建议按流水线显式声明：

- 投递布局：`<根>/<模块>/<版本>` （默认值，等于 `${REMOTE_MODULES_ROOT}/${MODULE_KEY}`）
- env-dir 布局：`<根>/<模块>/<envId>/<版本>` —— **多一层环境**，必须显式声明

猜错一层的后果是「扫不到任何版本」或「扫到别人的目录」，所以宁可让脚本打一条
warning 也不替你猜。

默认 **只观测**：`REMOTE_CLEANUP_APPLY=1` 才真删（`rm -rf` 远端版本目录，逐个删、
失败即断，避免半清状态难以对账）。

## 7. 验证与回滚

```bash
# 模板草稿的静态体检（CI 同规则：语法/变量/ssh 续行/危险命令）
node scripts/pipeline-lint.mjs --scripts scripts/pipeline

# 本地试跑（不碰远端）
DRY_RUN=1 MODULE_KEY=portal COMMIT_ID=abc1234 BUILD_OUTPUT_DIR=/tmp/dist \
  REMOTE_SSH_TARGET=ubuntu@10.0.0.9 REMOTE_DEST_DIR=/tmp/ws-verify/portal/abc1234 \
  bash scripts/pipeline/upload-remote.sh
```

**回滚**：删掉节点的脚本配置 → 存一下 → 自动回到平台内置实现。
不需要回滚代码、不需要改库、不需要重启 console。
