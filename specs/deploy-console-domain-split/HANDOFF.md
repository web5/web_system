# 双域重构 · 交接文档（新对话开工入口）

> 分支：`feat/deploy-console-domain-split`（基于 master）
> 建立：2026-09-19 ｜ 前置阅读：`design.md`（模型与接口）→ `tech-design.md`（分期与技术取舍）→ `progress.md`（已完成证据）
> 本文只回答三件事：**现在到哪了 / 接下来按什么顺序做 / 怎么验证与回退**。

---

## 0. 一句话现状

主干（数据模型 → API → 前端页面 → gateway manifest → shell 按 envId 加载）**已打通并验证**；
但**运行时闭环还差最后一环**：流水线产物**还没有真正落到 `<key>/<envId>/<version>/`**
（开关 `PIPELINE_APP_ENV_DIR` 默认关闭）。今天看到的 `byEnv` 数据是 **p11 迁移脚本搬运的历史产物**，
不是流水线新写出来的 —— **再跑一次真实发布，新产物到不了 manifest**。

---

## 1. 已完成（附验证方式）

### 1.1 微前端域 —— ✅ 完整

| 能力 | 证据 / 入口 |
|---|---|
| 站点 + 环境（envId 自增、内置 dev/local/prod、解析回退 dev） | V4。`servers/deploy-console/src/envs/` |
| 应用 CRUD + shell 挂载路由（跨应用同路径冲突阻断） | `servers/deploy-console/src/apps/` |
| 版本指针 + **A′ 两行入口指针** | V6。`src/apps/entry-pointer.ts`（单测 8/8 锁定写法） |
| 产物投递激活 `<key>/<envId>/<version>/` | V5。`src/apps/app-artifact.service.ts`（单测 7/7） |
| 删除环境时占用阻断 | V7 |
| 前端 4 页去 mock | `AppManager/AppDetail/EnvironmentManager/EnvironmentDetail.vue` |

### 1.2 API 网关域 —— ✅ 完整（含 09-19 新增的「部署动作」）

| 能力 | 证据 / 入口 |
|---|---|
| 服务 CRUD + 12 个服务种子（key 沿用旧 module key） | `src/services/`，`/api/services` → total=12 |
| 转发规则（前缀级）+ 接口清单（UPSERT 只补空字段） | V8 |
| 服务×环境指向 + 手动探活（未配主机 fail-fast） | `src/envs/` 的 `service-routes` |
| DB 驱动转发 + 未登记接口策略 | V9/V10。`servers/gateway/src/dynamic-route/`（单测 18） |
| **部署动作（重启 + 探活，与构建发布分离）** | `POST /api/services/:key/deploy`；`ServicesService.deploy()` |

### 1.3 gateway 运行时 / 迁移

| 项 | 状态 |
|---|---|
| manifest 改 `envs/byEnv`（HTML 注入与端点**同源**） | ✅ 实测 `/__manifest__?site=dev` |
| shell 按 envId 加载 + `x-env-id` | ✅ `apps/shell/src/main.ts` |
| EnvSwitcher 接真实环境 + 审计（不阻断切换） | ✅ `packages/ui/src/components/EnvSwitcher.vue` |
| **M8 双读开关 `DEPLOY_LEGACY_READ`** | ✅ `IndexHtmlService.buildManifest()` |
| M1–M3 / M4-lite / M5 / M6 / M7 / M12 迁移 | ✅ 幂等脚本 `scripts/migrations/p1*.mjs` |
| **M9 旧表 DROP** | ⏸️ 阻塞，见 §3 |

---

## 2. 三个关键开关（最容易误判"已完成"的地方）

| 开关 | 默认 | release 当前值 | 含义 |
|---|---|---|---|
| `PIPELINE_APP_ENV_DIR` | **关** | 未设置 | 开=流水线投递后追加「写 envId 目录 + 改指针」。**未开 → 产物仍写旧布局 `<key>/<version>/`** |
| `GATEWAY_DB_ROUTES` | **关** | 未设置 | 开=`deploy_service_routes` 参与转发。未开=网关走硬编码路由（双轨零破坏，符合预期） |
| `DEPLOY_LEGACY_READ` | 关（=走新表） | 未设置 | 开=manifest 只从旧表读（回退通道）。**默认关闭即"走新表"，是想要的状态** |

配置文件：`web_system_release/servers/deploy-console/.env`、`web_system_release/servers/gateway/.env`。

---

## 3. 后续三阶段（建议顺序 A → B → C）

### A. 打通运行时闭环（**先做这个**）

**目标**：让一次**真实流水线**发布的产物落到 `<key>/<envId>/<commit>/` 并刷新 manifest，
同时清算 tech-design 的遗留复验点 —— **T1 入口指针至今是用手造文件复验的，还没用真实构建产物验证过**。

步骤：
1. 给 release console 加开关并重启：
   ```bash
   # 在 /Users/geekwen/web_system_release/servers/deploy-console/.env 追加
   PIPELINE_APP_ENV_DIR=1
   pm2 restart web-deploy-console
   ```
2. 发起一次真实发布（用 admin 或 portal，目标环境 dev）。
3. 验收（三条必须全绿）：
   ```bash
   # ① 产物落盘
   ls -1 ~/web_system_release/servers/gateway/public/static/modules/admin/dev/
   # ② 指针是 A′ 两行（export * + export { default }）
   cat ~/web_system_release/servers/gateway/public/static/modules/admin/dev/index.js
   # ③ manifest 更新
   curl -s 'http://localhost:6000/__manifest__?site=dev' \
     | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['byEnv'])"
   ```
4. **回退**：删掉 `PIPELINE_APP_ENV_DIR=1` 并 `pm2 restart web-deploy-console` → 行为回到改造前（逐字节一致）。

### B. M9 旧表退役（**必须在 A 之后**）

理由：流水线不写 envId 目录时动 M9，等于把"半接好的运行时"和历史数据一起拆，出问题两处都卡住。

顺序（每步独立可停、独立回退）：

| 步骤 | 旧表 | 解锁动作 | 难度 |
|---|---|---|---|
| B1 | `deploy_env_service_routes` | 种子已跑完 → 删种子代码（改为"新表有数据则跳过"） | 低 |
| B2 | `deploy_servers` | 「主机管理」页（对应新表 `deploy_hosts`）上线后删 `ServerModule` | 中 |
| B3 | `deploy_environments` | **6 处** `environmentApi.list()` 改为 `envsApi.list()/sites()`：Dashboard / CanaryCenter / PipelineDetail / ConfigCenter / DiagnoseCenter / PipelineCenter | 中 |
| B4 | `deploy_modules` | ① `deployApi.modules()`×4 ② `moduleApi.list()`（ConfigCenter）③ `moduleApi.branches()`（BranchSelect）→ 切 apps/services；`ModuleRegistryService` 兜底已就绪可直接移除 | 中高 |
| B5 | `deploy_deployments` | **最难**：gateway `getCurrentVersion()` 用它加载 shell 基座版本 + 流水线写版本。须先给 shell 建新版本账本（如 `deploy_app_env_versions` 或独立账本）并双写 | 高 |

⚠️ **铁律**：`deploy-console` 的 TypeORM 开了 `synchronize: true` —— **只要实体文件还在，
DROP 表后服务启动会自动重建**。必须「删实体 + 删引用」与「DROP」同批完成。

### C. 网关 DB 路由上线

`GATEWAY_DB_ROUTES=1` 后，把 `ProxyController` 里的硬编码转发逐条换成 `deploy_service_routes` 规则
（双轨并存、逐条迁移、出问题关瞬时恢复）。依赖 B4（服务/路由数据已在 `deploy_services`/`deploy_service_routes`）。

---

## 4. 关键文件地图

| 域 | 位置 |
|---|---|
| 环境域（站点/环境/指向） | `servers/deploy-console/src/envs/` |
| 应用域（应用/路由/指针/投递） | `servers/deploy-console/src/apps/` |
| 服务域（服务/规则/接口/部署） | `servers/deploy-console/src/services/` |
| 跨域寻址 | `servers/deploy-console/src/target/` |
| 10 张新表实体 | `servers/deploy-console/src/entities/deploy-*.entity.ts` |
| gateway DB 路由 | `servers/gateway/src/dynamic-route/` |
| gateway manifest（**唯一来源**） | `servers/gateway/src/deploy-version/index-html.service.ts` → `buildManifest()` |
| 模块读取适配层 | `servers/deploy-console/src/module-registry/module-registry.service.ts` |
| 迁移脚本 | `scripts/migrations/p11-*.mjs`、`p12-*.mjs` |
| 前端 API 层 | `apps/deploy-console/src/api/index.ts`（`envsApi` / `appsApi` / `servicesApi`） |
| 共享 UI | `packages/ui/src/components/EnvSwitcher.vue`、`src/composables/env.ts` |

---

## 5. 环境与验证命令（新对话直接复用）

```bash
# 服务由 pm2 纳管（不是裸 node 进程）
pm2 restart web-deploy-console     # 6200
pm2 restart web-gateway            # 6000

# 后端改动必须同步 dist 再重启才生效
cp -R ~/workspace/web_system/servers/deploy-console/dist/. ~/web_system_release/servers/deploy-console/dist/
cp -R ~/workspace/web_system/servers/gateway/dist/.      ~/web_system_release/servers/gateway/dist/
cp -R ~/workspace/web_system/apps/deploy-console/dist/.  ~/web_system_release/apps/deploy-console/dist/

# 单测
cd servers/deploy-console && npx jest src/apps/ src/services/ src/target/
cd servers/gateway        && npx jest src/dynamic-route/

# 前端类型检查
cd apps/deploy-console && npx vue-tsc --noEmit && npm run build
```

**取本地调试 token**（console 的 `ADMIN_PASS` 已废弃，走 auth-service，无法用固定口令登录）：

```bash
cd ~/web_system_release/servers/deploy-console && node -e "
const fs=require('fs'),jwt=require('jsonwebtoken');
const secret=(fs.readFileSync('.env','utf8').match(/^JWT_SECRET=(.+)$/m)||[])[1].trim();
const t=jwt.sign({sub:'v',username:'admin',roles:['admin'],systems:['deploy'],type:'access'},secret,{expiresIn:'30m'});
console.log(t);"
# 注意 systems 必须含 'deploy'，否则 403「该账号不属于运维控制台」
```

> manifest 端点的响应是 **`{code:0,data:{...}}`** 包了一层 —— 校验时记得取 `data`。

---

## 6. 已知坑（别重复踩）

1. **`synchronize: true`**：删表前必须先删实体，否则启动即重建（见 §B 铁律）。
2. **新前端 + 旧后端会 404**：改前端后若后端未 `pm2 restart`，页面会报「加载 X 失败」。
   判据：`curl http://localhost:6200/api/apps` → 404=旧进程，401=新进程（待鉴权）。
3. **`Duplicate entry 'dev' for key 'deploy_environments.PRIMARY'`**：既有噪音，非本分支引入
   （pm2 error log 里 476 次，最早 2026-09-01）。成因：旧表主键是单列 `id`，而 `ensureModuleEnvs()`
   去重只按 `module_key` 过滤。被 `try/catch` 吞掉，不影响功能；该表属 B3 待删，不建议单独打补丁。
4. **`publicPath`**：`pipeline.service.ts:264` 有 `publicPath || moduleKey` 回落。
   `admin` 的 `public_path` 曾被 M4-lite 种子漏写（已补为 `'admin'`，与回落值等价）。
5. **ModuleRegistry type 值域**：必须落在 `backend` / `frontend` / `micro-frontend` 三者内
   （下游按它决定 `servers/` vs `apps/` 构建目录）。映射见 `module-registry.service.ts:appKindToType`。
6. **不要在流水线 `moduleKey` 未切 `targetRef` 前改共享流水线** —— 会破坏正在运行的 release 实例。
7. **数据备份**：`/tmp/p12-backup-1789822789116.json`（48 条模板，数据库内容，git 恢复不了），保留。

---

## 7. 新对话开工 checklist

- [ ] `git checkout feat/deploy-console-domain-split` 并确认工作区干净
- [ ] 读 `progress.md` 的「验收判据证据」与「M9 阻塞清单」
- [ ] 确认三个开关现状（`grep -E 'PIPELINE_APP_ENV_DIR|GATEWAY_DB_ROUTES|DEPLOY_LEGACY_READ' <两个 .env>`）
- [ ] 从 **§3-A** 开始：开开关 → 真实发布 → 三条验收
- [ ] A 通过后进入 **§3-B**，按 B1→B5 顺序，每步独立提交
