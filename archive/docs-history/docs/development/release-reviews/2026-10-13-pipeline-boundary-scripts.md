# 发布评审报告 · 流水线边界脚本化 S1（2026-10-13）

```
阻塞: 0
重要: 1
```

> 触发面：`scripts/pipeline/**`（DB 里的流水线动作脚本 + 仓库模板副本）、`servers/deploy-console/src/**`（流水线执行链）
> 判据源：`docs/development/release-review-checklist.md`
> 目标：把 `upload` / `cleanup` 两个 platform 节点的远端投递（scp + ssh 解包）**下放到节点脚本**，
> 同时保证「投到哪台机器、落到哪个目录、用哪把私钥」仍由平台裁决（脚本只管用，不自己推导）

---

## 变更内容

| 项 | 值 |
|---|---|
| 发布目录 | 无（console 自身不走流水线，走独立链路；本次不动任何流水线实例数据） |
| 代码改动 | 见下表 |
| 模板改动 | 新增 `scripts/pipeline/upload-remote.sh`、`scripts/pipeline/clean-remote.sh`（**模板副本**，线上正文在 DB；已过 `pipeline-lint`：error 0 / warning 0） |
| 配置改动 | `servers/deploy-console/.env.example`：标注 `DEV_SERVER/PROD_SERVER` 已不再作为 console 的 SSH 目标来源（保留仅为兼容历史部署习惯） |
| 是否启停服务 | **是**（dev console 重启一次做验收） |
| 是否动 DB | **否**（无迁移；脚本正文由运维在「流水线详情 → 编辑流水线 → 节点脚本」维护） |

| 文件 | 改动 |
|---|---|
| `src/pipeline/steps/node-exec-plan.ts` | 新增分派 `builtin-override` 与白名单 `OVERRIDABLE_PLATFORM_NODES = {upload, cleanup}` |
| `src/pipeline/pipeline.service.ts` | `executeV5Node` 增 `builtin-override` 分支（守卫 → DB 脚本 → 回退内置）；新增 `resolveRemoteVars()` 注入远端四变量 |
| `src/remote/ssh-exec.service.ts` | `SshTarget` 增加 `keyPath`（绝对路径），构造函数两条返回路径都带上 |
| `src/remote/remote-delivery.service.ts` | 目标机改为委托 `SshExecService`；抽出纯函数 `resolveRemoteScriptVars` / `toRemoteScriptSsh`，删除 env 版 `resolveRemoteSshTarget` / `pickSshKeyPath` |
| `src/pipeline-orchestration/script-vars.ts`、`scripts/pipeline-lint.mjs` | `PLATFORM_VARS` 两侧同步新增四个变量（服务端与 CI 同一口径，有测试把守） |

---

## 逐条评审

### 适用项

| # | 判据 | 结论 | 证据 |
|---|---|---|---|
| E1 | deploy-console 自身不走流水线 | ✅ 不涉及 | 走本机构建 + scp + `pm2 restart` 独立链路 |
| E3 | 变更后有验证动作，留证据 | ✅ | 单测 841 例全绿（含本次新增 6 例）+ dev 部署后健康检查 + 脚本模板在 dev 真机空跑一次（见「验证证据」） |
| E4 | PR 挂自动合入 | 🔄 提交后执行 | CI 全绿后自动 merge，核实为 merge commit |
| B3 | 关键依赖配置非缺失 | ✅ | 环境未在「主机管理」登记（或私钥不在控制台所在机）→ 两个 SSH 变量**留空并告警**，脚本在使用点显式报错退出；不猜默认机、不静默连错机器 |
| B5 | 服务自身 `.env` 是唯一配置源 | ✅ **较改动前收窄** | SSH 目标原本「环境变量（`DEV_SERVER` 等）」与「主机管理」两套并行；现收敛为唯一一套（见「重要项」） |

### 不适用项（附理由）

| 段 | 不适用理由 |
|---|---|
| C1–C6 数据面 | 无迁移脚本、无结构变更、无写入动作 |
| D1–D4 前端面 | 不改产物、不切版本指针（流水线若走脚本投递，仍是原有版本表/指针逻辑，未触碰） |
| A1–A5 运行面 | 发布不涉及其他服务的部署；console 自身独立发布，已在 E1/E3 覆盖端口与进程校验 |
| B1/B2/B4 | 无 env 固化的重启方式；无新增跨服务共享密钥；无占位符密钥 |

---

## 重要项（1）：把「第四份 SSH 真相」收掉

第一版实现给脚本的 `REMOTE_SSH_TARGET` 按 `DEV_SERVER/PROD_SERVER` 环境变量算 —— dev 部署后验证发现
**这两个变量在开发机上一个都没配**（真实目标机登记在 `deploy_hosts`），即脚本变量恒为空；
更严重的是，这等于在「发布/监控用 SshExecService（主机管理）」「平台内置投递用环境变量」之后
**新增第三份目标推导**，正是诊断 #15 刚收敛过的东西重新发散。

现已改为：**只有一个入口** —— `SshExecService.resolve(env)`（主机管理 → 服务器管理 → 显式报错）。

- 边界脚本变量（`REMOTE_SSH_TARGET` / `SSH_KEY_PATH`）由它来；
- 平台内置 `uploadDist` 也改用它（原来读环境变量的那份已删除）；
- `user@host` 的拼法只有 `toRemoteScriptSsh()` 一处，投递执行体与脚本变量不会各写一遍。

**副作用（正面）**：dev 此前一旦为某模块配了 `target=remote` 的内置投递，会因为「未配置 dev 服务器地址」
直接失败；现在按主机管理登记正常投递（dev → `ubuntu@175.27.189.123`）。

**为什么不把解析失败做成硬失败**：变量解析对每个有命令的节点都会跑一次（含 `build` 这类不需要 SSH 的），
硬失败会让「某环境没登记远程投递」顺带把本机/后端发布一起打死。故选择留空 + 每环境一次 WARN，
由真正需要它的 `upload` / `cleanup` 脚本在使用点报错。

---

## 变更审阅要点（给 reviewer）

1. `builtin-override` 只对白名单内的 `upload` / `cleanup` 生效；`version` / `pointer` 等仍是纯内置，
   脚本覆盖不了（发布语义真相源不可下放）。
2. 四个远端变量里，前三个进了 `PROTECTED_STAGE_KEYS`（配置中心 + 流水线变量双重拦截）。
   理由同 `CONSOLE_API`：被改写 = 产物投到别处而流水线全绿。
   `SSH_KEY_PATH` 故意不保护 —— 换私钥路径是合法定制，改错也只表现为连不上，不静默。
3. 脚本执行前后的内置逻辑保持不变：守卫（`skip`）先判、DB 有脚本才下放、无脚本回退内置 ——
   存量流水线零改动零迁移（删掉脚本即回退）。

---

## 验证证据

| 项 | 结果 |
|---|---|
| `npx tsc --noEmit` | 0 error |
| `npx jest`（deploy-console 全量） | ✅ Test Suites 73 passed / Tests 841 passed |
| 本次新增/改写用例 | `resolveRemoteScriptVars` 4 例（含「目标机只来自传入的解析结果」）、`resolveTarget` 2 例、`uploadDist` 2 例、`toRemoteScriptSsh` 1 例、`node-approval` 注入口径 2 例 |
| `node scripts/pipeline-lint.mjs --scripts scripts/pipeline` | ✅ 动作 6 个，error 0 / warning 0 |
| dev console 部署 | 构建 → scp → 换 `dist`（旧包留 `dist.bak-*`）→ `pm2 restart`；`/health` 返回 200（`status=ok`），进程 online，启动日志无新增 ERROR |
| 脚本模板真机空跑 | ✅ `upload-remote.sh` 在 dev 上以临时根投递成功并回读对账成功（详见下） |

### dev 真机验收（2026-10-14）

① **目标机确实来自「主机管理」**（dev 库 `deploy_hosts`）：

```
name          host            ssh_user  ssh_key_path
dev-default   175.27.189.123  ubuntu    ~/.ssh/id_ed25519_servers      ← env=dev 解析结果
prod-default  106.52.176.246  root      ~/.ssh/id_ed25519_servers
```

对照：dev console 的 `.env` 里**只有** `STATIC_PUBLIC_ROOT_PROD`，没有 `DEV_SERVER/PROD_SERVER`
—— 这正是旧口径下脚本变量恒为空、而日志一句都不提「为什么空」的场景。

② **脚本模板真机投递**（dev → 自身，临时根）：

```
[pipeline:upload] 模块 portal｜源 /tmp/s1-artifact（3 个文件）→ ubuntu@175.27.189.123:/tmp/ws-s1-verify/modules/portal/s1test
[pipeline:upload] 投递完成：ubuntu@175.27.189.123:/tmp/ws-s1-verify/modules/portal/s1test（3 个文件，与本地一致）
远端回读：app.js / assets/a.css / index.html  ✅
```

③ **失败护栏**（真机实测，全部按预期非 0 退出且给指路文案）：

| 场景 | 结果 |
|---|---|
| 产物目录为空 | `[pipeline:upload] 产物目录为空：/tmp/s1-empty（build 产出 0 个文件，禁止投递）` → exit 1 |
| `REMOTE_SSH_TARGET` 未注入（= 环境没登记主机） | `REMOTE_SSH_TARGET 未设置（环境未登记目标机：基础设施 → 主机管理）` → exit 1 |
| `clean-remote.sh` 未注入保护名单 | `[pipeline:cleanup] 未注入 PROTECTED_VERSIONS —— 视为全保护，跳过清理` → exit 0（不删任何东西） |

验收后已清理 dev 上的临时根与临时脚本。

---

## 遗留与后续

| # | 事项 | 说明 |
|---|---|---|
| 1 | **真实流水线端到端** | dev 上目前没有任何流水线为 `upload`/`cleanup` 配脚本（`deploy_pipeline_actions` 为空），本次走单元 + 模板空跑验证；后续谁先在节点上配脚本，请按 `docs/operations/pipeline-boundary-scripts.md` §6 验收一次 |
| 2 | S3 runner 拉模式（5–8d） | 建议排在 S1 之后单独立项，本轮不涉及 |
| 3 | `deploy.service` 里是否还残留同款目标推导 | 已收敛到 `SshExecService`；如后续新增能力，禁止再按环境变量算第二份 |

---

trailer：`Release: docs/development/release-reviews/2026-10-13-pipeline-boundary-scripts.md`
