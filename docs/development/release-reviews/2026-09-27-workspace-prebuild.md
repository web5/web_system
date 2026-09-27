# 发布评审报告 · 构建入口按需预构建 workspace 依赖（2026-09-27）

```
阻塞: 0
重要: 2
```

> 触发面：`scripts/build-module.mjs`（发布链路构建脚本）+ `packages/{ui,shared,agent-core}` 构建配置
> 判据源：`docs/development/release-review-checklist.md`（A 运行面 / D 前端面 / E 特殊通道）
> 目标：消除发布端（prod `/data/web_system_git`）前端构建失败，并堵住「dist 陈旧静默用旧码」的隐患

---

## 变更内容

| 项 | 值 |
|---|---|
| 发布目录 | `/data/web_system_git`（prod git 目录） |
| 代码改动 | `scripts/build-module.mjs`（新增 `ensureWorkspaceDeps` 等）、`packages/{ui,shared,agent-core}` 的 `package.json` + 新增 `tsconfig.build.json` |
| 是否启停服务 | **否**（本次只改构建链路，不重启任何服务、不投递产物、不改版本表） |
| 线上影响 | **无**（portal/admin 产物仅在发布目录 `apps/*/dist` 重新生成，未拷贝到静态目录、未更新 `deploy_deployments`） |

---

## 背景与真因（两条，都只在发布端暴露）

| # | 表象 | 真因 |
|---|---|---|
| 1 | `[commonjs--resolver] Failed to resolve entry for package "@web-system/ui". The package may have incorrect main/module/exports specified` | workspace 包 `main` 指向 `dist/`，而 dist 是构建产物、**不入 git**；发布端从没构建过 ui。错误信息指向「包配置错」，极易误诊 |
| 2 | `packages/ui` 的 `tsc` 报 TS2582/TS2304（`describe`/`it`/`expect` 未定义），**退出码 2**，但仍 emit 出 dist（`noEmitOnError` 未开） | `src/**/*.spec.ts` 缺测试类型定义。本机不报是因根 `node_modules` 有 hoisted `@types/jest`，发布端没有 → **环境相关，必须治本** |

> 为什么不放进流水线 `PREBUILD_SHARED_PACKAGES`：该清单按 2026-09-21 用户定只收 shared/types，
> 「模块级依赖由模块自己负责」。构建入口 `build-module.mjs` 正是模块自己的构建脚本，按自身
> `package.json` 的 `workspace:*` 声明按需构建，符合该约定。

---

## A 运行面

| # | 判据 | 取证 | 结论 |
|---|---|---|---|
| A1 | 构建发生在发布目录 | prod 在 `/data/web_system_git` 执行 `node scripts/build-module.mjs portal`，日志中包路径为 `/data/web_system_git/packages/...` | ✅ |
| A2 | 发布目录 HEAD 与预期一致 | 验证时 `git log --oneline -1` = `b0d89e1`（分支 `fix/workspace-deps-prebuild`） | ✅ |
| A3 | **workspace 包走完整 build 脚本** | 执行 `npm run build`（包目录内），非裸 `npx tsc`。types/agent-message 的 build 是三段式（`tsc` + `tsc -p tsconfig.cjs.json` + 写 `dist/cjs/package.json`），只跑 tsc 会导致后端 require 的 cjs 缺失 | ✅ |
| A4 | 端口占用者 == pm2 进程 | 不涉及（无端口/进程变更） | N/A |
| A5 | ecosystem 登记 | 不涉及（无新服务） | N/A |

> ⚠️ **踩坑（prod 实测，只在发布端出现）**：最初用 `pnpm --filter <pkg> build`，pnpm 11.5.2 的
> `--filter` 会先跑 `runDepsStatusCheck`，依赖状态不一致时**隐式执行 `pnpm install`**，
> 结果 `ERR_PNPM_IGNORED_BUILDS` → exit 1，把「构建」牵连成「装依赖」。
> 改为包目录内 `npm run build`：仍走完整 build 脚本（满足 A3），且不触发 pnpm 依赖状态检查。

---

## D 前端面

| # | 判据 | 取证 | 结论 |
|---|---|---|---|
| D1 | 微前端三步齐全（构建 → 拷贝 → 改版本表） | 本次**只做第 1 步**，未拷贝产物、未更新 `deploy_deployments.current_version` → 线上仍是旧版，无影响 | ✅ 不适用（未发布） |
| D4 | 共享依赖产物存在 | `@web-system/ui` 与 `@web-system/agent-message` 的 dist 由预构建补齐（1980ms / 5535ms） | ✅ |

---

## E 特殊通道

| # | 判据 | 取证 | 结论 |
|---|---|---|---|
| E3 | 变更后有验证动作 | ① **prod 决定性验证**：清空 ui + agent-message dist 后跑 `build-module.mjs portal` → `BUILD_EXIT=0`（agent-message 1980ms / ui 5535ms 自动构建，portal 产物产出）；② admin（第二个消费者）`ADMIN_EXIT=0`（3m55s）→ 拓扑逻辑通用；③ 本机：幂等跳过、touch 源码触发重建、`SKIP_WORKSPACE_PREBUILD=1` 生效；④ 收尾 prod 已 `git checkout master`（`d9889ff`），tracked 脏 0，在线服务 10 | ✅ |

---

## 重要（不阻塞，建议跟进）

| 项 | 现象 | 影响 | 建议 |
|---|---|---|---|
| I1 | prod 的 `pnpm-workspace.yaml` 被 pnpm 11.5.2 **自动追加** `allowBuilds:` 段，值是占位文本 `set this to true or false`（昨晚 install 产生的脏改动） | 文件非法 → 每次 pnpm 命令触发依赖状态检查并失败；同时 pnpm 11 默认**不跑依赖的 build scripts**，涉及 esbuild、better-sqlite3、@swc/core、ssh2、vue-demi 等 14 个 → 换机重装后原生模块可能缺失 | 已在 prod `git checkout --` 恢复（工作区重新干净）；**根因未修**：需在仓库里显式声明 `onlyBuiltDependencies` 白名单（判断哪些包必须跑 build script，尤其 esbuild/better-sqlite3/ssh2），否则下次换机必踩 |
| I2 | 预构建按 mtime 判陈旧（源码 > 产物 +1s 即重建） | 依赖文件系统时间戳；若产物被镜像拷贝导致时间戳丢失，会每次重建（慢但正确）；若时钟回拨则可能漏重建 | 观察即可；出现可疑陈旧时用 `WORKSPACE_PREBUILD_FORCE=1` 强制全量重建 |

---

## 结论

阻塞项清零。本次**不发布、不重启服务**，线上零影响；修复的是发布端构建能力本身，
为后续 P0-2（投递/版本切换接入流水线）与 ③（public 资源 CDN 化）清掉前置阻塞。

修复后发布端前端构建从「必失败」变为「首次自动补齐 + 源码变更自动重建 + 无变更跳过」。
