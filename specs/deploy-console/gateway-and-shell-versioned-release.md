# gateway 走标准流水线 + shell（微前端基座）按版本加载 + 微前端独立管理动作

> 状态：**规划（未实现）** —— 2026-09-15 与用户逐条确认方向，实现排在次日。
> 关联：`specs/pipeline-node-model/design.md`（终态 nodes 模型）、
> `specs/deploy-console/pipeline-edit-ui.md`（编辑页 UI 定稿）、
> `docs/development/from-zero-init-data.md`（种子数据口径）。

---

## 0. 一句话结论

三件事是**同一条主线**：gateway 与 shell（微前端基座）都由「就地 / 固定路径」收敛为
**「版本目录 + 指针」**，发布入口统一走**标准四节点流水线**，并给**微前端（shell）一个独立的管理动作**。
其余流程与动作**沿用现有流水线与模块部署，不另起炉灶**（用户 2026-09-15 明确）。

---

## 1. 现状（证据）

| 项 | 现状 | 证据 |
|---|---|---|
| gateway 发布形态 | 有流水线 `tpl-gateway-{local,dev,prod}`，产物投到 `servers/gateway/<COMMIT_ID>/`（**已是版本目录**），但**没有「落地 dist + 切指针」步骤** —— 流水线跑完只是产物就位，服务生效仍靠人工 | `scripts/migrations/p5-pipeline-shell-approval-3env.mjs:58-65`（注释"就地发布"）、`254-302`（release 节点只挂 `上传产物 + 写版本记录` 两个 action） |
| 后台生效路径 | 生效 = `applyBackendVersion()`：版本目录 → `servers/<dir>/dist` + pm2 重启；由控制台「部署 / 回滚」触发，**流水线不做** | `servers/deploy-console/src/deploy/deploy.service.ts:307-326`、`:396-410`、`deployVersion():267` |
| shell（基座）投递 | 已按版本目录投递（本机 `static/modules/shell/<COMMIT_ID>/`，远端 `remoteUploadScript` 也带 `/$VER`） | `p5...mjs:82-91`（MODULES.shell）、`:171-190`（remoteUploadScript） |
| shell 加载 | gateway 侧**优先版本目录**、取不到退回旧固定路径 `public/shell/index.html` | `servers/gateway/src/deploy-version/index-html.service.ts:130-141` |
| overlay（覆盖式）残留 | `localUploadScript` / `remoteOverlayScript` 的 overlay 分支代码还在，**但 MODULES 里没有任何条目置 `overlay: true`**（即当前无人使用，属死代码） | `p5...mjs:135`（`mod.overlay ?`）、`:192-210`、`grep overlay` 无 `overlay: true` |
| 微前端管理动作 | 模块详情页动作只有：发起发布 / 部署 / 回滚到此版本 / AI 验证 / 部署版本；**微前端与前端共用同一套，无专属动作** | `apps/deploy-console/src/views/ModuleDetail.vue:371, 445-453, 605-606, 641` |
| 模块注册表 | `shell` 的 `type` 是 `frontend`（不是 `micro-frontend`）；`admin` / `portal` 才是 `micro-frontend` | `scripts/modules.json:13-16` |

**结论**：gateway 与 shell 的"特例"其实只剩**生效环节**与**一处 legacy 兜底**，不是整条链路都要重写。

---

## 2. 目标形态

统一版本布局（本机与远端一致）：

```
本机  ~/web_system_release/servers/gateway/public/static/modules/<key>/<版本引用>/   # 前端类（含 shell）
      ~/web_system_release/servers/<dir>/<moduleKey>-<env>/<commit>/                 # 后台类（含 gateway）
远端  /data/web_system/servers/gateway/public/static/modules/<key>/<版本引用>/       # 前端类（含 shell）
      /data/web_system/servers/<dir>/<moduleKey>-<env>/<commit>/                     # 后台类（含 gateway）
```

- `<版本引用>` = `<流水线 key>/<commit>`（如 `shell-local/d8d7e2c`），解析见
  `servers/deploy-console/src/pipeline/release-paths.ts:parseReleaseRef()`。
- **生效一律靠指针**（`deploy_deployments.current_version`）：前端类切指针后 gateway 直读版本目录；
  后台类由 `applyBackendVersion()` 落地到 `dist` + pm2 重启。
- gateway 与 shell **都支持回滚**（版本目录在，指针可切回）。

---

## 3. 方案 A：gateway 改走标准流水线（版本目录 + 指针切换）

### 3.1 目标链路

```
流水线 tpl-gateway-<env>：
  git（拉取代码）→ build（npx tsc）→ gate（发布确认）→ release
release 节点 actions：
  ① shell：上传产物      → servers/gateway/gateway-<env>/<commit>/
  ② service：写版本记录  → deploy_versions
  ③ service：部署生效    → applyBackendVersion（版本目录 → dist + pm2 restart）+ 切指针   ← 新增
```

即：把**现在人工在控制台点「部署」的那一步**纳入流水线的 release 节点，
与「发布」语义一致（流水线跑完 = 已生效，可回滚）。

### 3.2 改动点

| # | 文件 | 改动 |
|---|---|---|
| A1 | `servers/deploy-console/src/pipeline/` 的 action 工具集（现有 `write-version`） | 新增 `apply-version`（或 `deploy-version`）service action：内部复用 `DeployService.deployVersion()`（已含"先落地后改指针"与 remote 分支 `applyBackendRemote`） |
| A2 | `scripts/migrations/p5-pipeline-shell-approval-3env.mjs` | gateway 的 `localPath` 语义更正（去掉"就地发布"注释，改为版本目录口径）；release 节点 actions 追加 ③ |
| A3 | 新迁移脚本 `scripts/migrations/p6-gateway-release-apply.mjs` | 给已存在的 `tpl-gateway-{local,dev,prod}` 三条模板的 release 节点补 ③（幂等，可重跑） |
| A4 | `scripts/modules.json` | gateway 条目无需改类型；确认 `pm2: "gateway"` 与实际进程名一致 |

### 3.3 风险（必须处理）

1. **gateway 是静态产物宿主**：`servers/gateway/public/static/modules/**` 与 `servers/gateway/dist`
   是**两个独立目录**，落地 `dist` 不会动静态产物；但 **pm2 restart gateway 会短暂中断所有微前端与 API 流量**
   → 发布窗口需在 UI 提示（"重启期间网关短暂不可用"），并避开业务高峰。
2. **自举差异**：deploy-console **不能**走自家流水线（重启会杀掉正在跑流水线的进程，见
   `scripts/release-deploy-console.sh:4-8`）。gateway **不存在**这个问题（流水线由 console 进程执行），
   可以安全纳入 ③ —— 这是本次改动成立的前提。
3. **阻塞项 P0**：后台构建产物没进版本目录（见 §6），**必须先修**，否则 ③ 会把空目录落地到 `dist` → gateway 变砖。

---

## 4. 方案 B：远端 shell 按版本加载

### 4.1 目标

远端（dev / prod）的基座 shell 与本机一致：**按版本目录加载**，去掉对旧固定路径
`public/shell/index.html` 的依赖（legacy 兜底限期保留，观察一个发布周期后移除）。

### 4.2 现状核对（实现第一步先做，别急着改代码）

```bash
ssh <dev-host>  'ls /data/web_system/servers/gateway/public/static/modules/shell/ | head'
ssh <prod-host> 'ls /data/web_system/servers/gateway/public/static/modules/shell/ | head'
# 期望：看到 <流水线key>/<commit> 形态的版本目录；若只有散装文件或空 → 远端从未版本化投递过
```

并核对远端 gateway 的 `PUBLIC_ROOT`（应与 `/data/web_system/servers/gateway/public` 一致）与
`deploy_deployments` 的 shell 指针（**中心库，本机与远端共用同一条指针**）。

### 4.3 改动点

| # | 文件 | 改动 |
|---|---|---|
| B1 | `servers/gateway/src/deploy-version/index-html.service.ts:130-141` | 保留版本目录优先，legacy 兜底加**告警日志**（便于观察是否还有环境在走兜底） |
| B2 | `p5...mjs` 的 overlay 分支（`:135, :192-210`） | **删除死代码**（MODULES 无 `overlay: true`），避免后人误以为基座是覆盖式发布 |
| B3 | 控制台「环境」Tab | shell 模块的环境行显示"当前生效版本"，与指针一致（便于核对远端是否已按版本加载） |
| B4 | 文档 | §远端 shell 版本化章节（落 `docs/development/local-release-runbook.md` 或本文件 §4） |

### 4.4 风险

- 远端旧固定路径若仍被 nginx / CDN 引用 → 切换后 404。核对清单：nginx 静态规则、任何硬编码 `/shell/index.html` 的地方。
- gateway 的 `htmlCache` / `versionCache` 有 TTL → 切指针后**不是立即生效**，UI 需说明"最长 TTL 后生效"
  （或提供清缓存动作 —— 即方案 C 的动作可顺带做这件事）。

---

## 5. 方案 C：微前端（shell）的独立管理动作

### 5.1 定义（推荐方案）

在**模块详情页**对 `type = micro-frontend`（含 shell，shell 的 `type` 见 §5.3）新增一个专属动作：

> **「发布并生效」**（区别于现有的「部署」）

职责边界（**不发明新流程**，只是把现有后台动作串起来并加一个微前端专属提示）：

1. 复用 `deployApi.deployVersion()`（前端类 = 切指针；shell 走同一条）；
2. **额外**：通知 gateway 使清单缓存失效（当前 `resolveModulesManifest` / `htmlCache` 有 TTL，
   切指针后要等 TTL 才生效；该动作让运维能主动"立刻生效"）；
3. **UI 提示影响面**：shell 是基座 —— 发布它会影响**所有微前端的加载**，需二次确认（prod 强制 `confirm`）。

### 5.2 为什么需要单独一个动作

- 微前端（含基座）的"生效"依赖 gateway 的**清单注入 + 缓存**，语义与后台服务"落地 dist + 重启"不同；
- shell 的改动影响面最大（所有子应用），值得单独确认与单独提示；
- 现有「部署」按钮对这些差异**没有任何区分**（`ModuleDetail.vue:605` / `:641` 都一样）。

### 5.3 改动点

| # | 文件 | 改动 |
|---|---|---|
| C1 | `apps/deploy-console/src/views/ModuleDetail.vue` | 版本历史行 / 环境行：对 micro-frontend 类型渲染「发布并生效」按钮（现有「部署」保留给后台语义） |
| C2 | `apps/deploy-console/src/api/index.ts` | 新增 `refreshManifest(env)`（或复用现有清单接口） |
| C3 | `servers/gateway`（或 deploy-console 代理） | 提供"清清单/HTML 缓存"的接口（若已有则直接复用） |
| C4 | `scripts/modules.json` | **待确认**：shell 的 `type` 是否由 `frontend` 改为 `micro-frontend`（改了会进 manifest 列表，需评估对 `resolveModulesManifest` 的影响） |

---

## 6. 阻塞项 P0：后台构建产物没进版本目录（必须先修）

**根因已定位（2026-09-15）**：`dist` 曾被清理过只剩 `tsconfig.tsbuildinfo`，而 `mcp-gateway/tsconfig.json`
开了 `"incremental": true` → 第二次 `tsc` 读到 tsbuildinfo 判定"已是最新"，**只更新 tsbuildinfo、不产出 JS**。
现场证据：`~/web_system_release/servers/mcp-gateway/dist.bak-1789481803569/` 里只有 `tsconfig.tsbuildinfo`。
相关背景：`BUILD_OUTPUT_DIR = <ws>/servers/<dir>/dist`（`pipeline.service.ts:248`），即**假定"就地构建"**。

**已落地的保护（P0-1，防止把坏产物落地 / 投成版本目录）**：

| 位置 | 保护 |
|---|---|
| `deploy.service.ts:assertArtifactUsable()` | 落地前校验：目录不可读 / 为空 / **只有 tsbuildinfo** → 直接报错，**不动现有 dist、不改指针**（宁可不落地，也不变砖） |
| `deploy.service.ts` 的远程分支 `applyBackendRemote` | 打包前同样校验，不把空目录 tar 到远端 |
| `p5...mjs` 的四段投递脚本 | `$SRC` 非空断言（本机/远端 × 版本式/overlay），源头拒绝把空产物投成版本目录 |
| `deploy-artifact-guard.spec.ts` | 4 条测试：空目录 / 只有 tsbuildinfo / 有真产物 / **回滚同样受保护** |

**P0-2 已修复（2026-09-17）**：build 节点执行**前清空整个产物目录**（`cleanBuildOutputDir()`，
纯函数，在 `runStageCommand()` 里 `nodeKey === 'build'` 时调用），保证每次全量重编，
`tsbuildinfo` 无从残留。三候选里选了 ①（不改各服务 tsconfig、不改 `BUILD_OUTPUT_DIR` 契约，改动面最小）。
测试 `pipeline-build-clean.spec.ts`（5 条）。

**实测验证**：`mcp-gateway` 清理后全量重编，`dist` 产出 `main.js`（1205B）+ `admin/` `mcp/` 等，
重启后 `MCP Gateway running on http://localhost:6006` —— 该服务此前一直跑着 09-15 遗留的占位产物
（`main.js` 内容只有一行 `// T2-B`），本次一并恢复。

**顺带修（同日巡检）**：`deploy_modules.pm2` 与 pm2 真实进程名普遍不一致 ——
注册表写 `gateway` / `user-service`，实际是 `web-gateway` / `web-user`。
后果：`gateway` 侥幸被第二个候选 `web-gateway` 兜住；但 `user-service` 的三个候选
（`user-service` / `web-user-service` / `user-service`）**全部落空** → 重启静默失败、
发布显示成功但服务没起来。已用 `scripts/migrations/p7-backend-pm2-names.mjs`（幂等）修正 11 项，
种子 `scripts/modules.json` 同步。

---

## 7. 改动清单汇总

| 方案 | 文件 | 类型 |
|---|---|---|
| A | pipeline service action 新增 `apply-version`（复用 `DeployService.deployVersion`） | 后端 |
| A | `scripts/migrations/p6-gateway-release-apply.mjs`（新，幂等） | 迁移 |
| A | `p5...mjs` gateway 条目注释/语义更正 | 迁移 |
| B | `servers/gateway/src/deploy-version/index-html.service.ts`（legacy 兜底告警） | 后端 |
| B | `p5...mjs` 删除 overlay 死代码 | 迁移 |
| C | `ModuleDetail.vue` 微前端专属动作 + `api/index.ts` | 前端 |
| C | gateway 清单缓存失效接口 | 后端 |
| P0 | 后台构建产物落点 + 落地前非空断言 | 后端 |

---

## 8. 风险与回滚

| 风险 | 影响 | 处置 |
|---|---|---|
| gateway 重启中断流量 | 所有微前端 + API 短暂不可用 | UI 提示发布窗口；保留人工窗口 |
| 版本目录产物为空（P0） | 落地后服务变砖 | 落地前非空断言 + `dist.bak-<ts>` 备份（已有）+ 一键回滚 |
| 远端 shell 切版本后 404 | 基座白屏 | 保留 legacy 兜底一个发布周期；先 ssh 核对再切 |
| 清单缓存 TTL | 切指针不立即生效 | 方案 C 提供主动失效动作 |

回滚策略：③ 步骤失败 → 流水线直接 fail（不做部分生效）；`applyBackendVersion` 已有 `dist.bak-<ts>` 备份与
`rollbackVersion`（已支持指定目标版本）可一键回退。

---

## 9. 验收清单（可测）

1. `tpl-gateway-local` 跑通：流水线结束后 `servers/gateway/dist/main.js` 存在且为**新版本**，`deploy_deployments` 指针已更新（无需人工点部署）。
2. 回滚：控制台「回滚到此版本」→ gateway 回到上一个版本，`pm2 list` 显示 `gateway` online。
3. 远端 shell：ssh 到 dev/prod，`static/modules/shell/<版本引用>/index.html` 存在；访问网关首页返回的是**版本目录里的** HTML（legacy 兜底未命中，日志无告警）。
4. 微前端动作：对 `admin` 点「发布并生效」→ 清单立即反映新版本（不等 TTL）。
5. P0：任意后台模块跑一次流水线，版本目录里**有编译产物**（断言非空通过）。

---

## 10. 次日实施顺序

1. **P0 排查与修复**：后台构建产物落点 + 落地前非空断言（含单测）。
2. **A1**：pipeline service action `apply-version`（复用 `deployVersion`）+ 单测。
3. **A3**：迁移脚本给 `tpl-gateway-*` 补 ③；本机跑 `tpl-gateway-local` 验收（jm 环境）。
4. **B**：ssh 核对远端 shell 版本目录 → 加 legacy 告警 → 删 overlay 死代码。
5. **C**：微前端「发布并生效」动作（前端 + 清缓存接口）。
6. **文档回写**：本文件状态改为「已实现」+ 补实测结果；`design.md` 变更日志。

---

## 11. 待确认（实现前拍板）

1. **gateway 发布是否允许流水线自动重启**？（建议允许，但需 UI 提示中断窗口；prod 是否需要审批节点默认开启）
2. **shell 的 `type` 是否改为 `micro-frontend`**？（改 → 进 gateway manifest 列表，需评估副作用）
3. **「发布并生效」是否包含清缓存**？（建议包含，否则动作价值打折）
4. **远端 shell 的 legacy 兜底保留多久**？（建议一个发布周期）
