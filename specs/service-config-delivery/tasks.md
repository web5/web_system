# 服务进程配置下发 · 任务清单

> 配套：`design.md`（§0 速览 / §4 设计 / §10 落位 / §11 验证 / §12 坑）｜ 分支：`feature/deploy-console-domain-split` ｜ 仅本地（local）验证

## 开工前（5 分钟）

- [ ] 读 `design.md` §0 速览 + §12 既有约定与坑（**不要跳过 §12**）
- [ ] 确认 `servers/deploy-console/.env` 里 `CONFIG_MASTER_KEY` 已配（配置中心加密主密钥）
- [ ] 确认发布目录位置：`RELEASE_WORKSPACE`（默认 `~/web_system_release`）
- [ ] 记下当前 `GATEWAY_SERVICE_KEY` 的值（它等于 gateway 的 `FINNEWS_SERVICE_KEY`，迁移时要用）

## P0-1 · 配置解析按用途拆分（密钥隔离的前提）

- [ ] `config.service.ts` 加常量 `RESERVED_LOCAL_KEYS`（`CONFIG_MASTER_KEY` / `MYSQL_*` / `PM2_*` 等）
- [ ] 新增 `resolveForScripts(envId, moduleKey)`：与 `resolve` 同语义但**跳过 `isSecret`**
- [ ] 新增 `resolveForProcess(envId, serviceKey)`：语义化命名（含明文密钥）
- [ ] 新增 `dispatchPayload(envId, serviceKey)`：返回 `{ key, value, scope }[]`（带来源作用域）
- [ ] `pipeline.service.ts:2056` `resolveInjectEnv` 改用 `resolveForScripts(...)`，日志注明「已排除 N 个密钥项」
- [ ] 单测：同一 `is_secret` 项只出现在 `resolveForProcess`，不出现在 `resolveForScripts`

**验收（V3）**：发布脚本里 dump 一份 env，看不到 `HY3_API_KEY` / `GATEWAY_SERVICE_KEY`。
**回退**：`PIPELINE_CONFIG_INJECT=false`（整体关脚本注入）。

## P0-2 · 下发实现（写 `.env.generated`）

- [ ] `deploy.service.ts` 新增 `writeGeneratedEnv(envId, moduleKey)`：
      - 渲染 `<RELEASE_WORKSPACE>/servers/<dir>/.env.generated`，权限 **0600**
      - 文件头注释：生成时间 + 每个键的来源作用域（`global` / `env:<id>` / `module:<env>/<mod>`）
      - 跳过 `RESERVED_LOCAL_KEYS`；**只写配置中心里存在的键**
      - 备份上一版为 `.env.generated.bak-<ts>`（保留最近 3 份）
- [ ] 挂到「部署 / 重启服务」动作：**下发成功才重启**（下发失败 → 不重启 + 明确日志）
- [ ] 审计：只记「下发了哪些键 + 内容 hash」，**绝不记明文**
- [ ] 不要在 deploy-console 自身上走下发路径（`design.md` §4.0：它会自杀式重启）

**回退**：删 `.env.generated` + 重启服务。

## P0-3 · dotenv 接入下发文件

- [ ] `servers/gateway/src/app.module.ts:38` → `envFilePath: ['../.env.generated', '../.env']`（**下发文件在前**）
- [ ] `servers/deploy-console/src/app.module.ts:38` 同上（P0 可先不改，留给后续）
- [ ] 验证优先级：下发文件里的键覆盖 `.env` 同名键

**验收（V1/V2）**：改配置中心值 → 下发 → 重启 gateway → 新值生效；
删掉 `.env.generated` → 重启 → 回到 `.env` 的值。

## P0-4 · `GATEWAY_SERVICE_KEY` 迁入配置中心

- [ ] 配置中心建两条 `module` 作用域条目（值相同，`is_secret=1`）：
      `env=local, module=deploy-console` 与 `env=local, module=gateway`
- [ ] console 侧改为「先查配置中心 `resolveForProcess`，取不到回落 `.env`」（**不下发、不重启自己**）
- [ ] gateway 侧不写 `.env`，靠下发得到
- [ ] 撤掉 `.env` 里为本次临时新增的 `GATEWAY_SERVICE_KEY`（gateway 与 console 两处）

**验收**：控制台手动「部署」shell → 日志出现「已通知 gateway 刷新缓存」；gateway 日志出现「版本缓存已失效」。

## P1 · 流水线脚本接入下发（可选，时机统一用）

- [ ] `config.controller.ts` 加 `@Public()` + `x-internal-key` 的 `GET internal/config/dispatch/:serviceKey?envId=`
- [ ] `restart` 相关脚本：在重启前 `curl` 该接口写入 `.env.generated`，**写失败即 fail-fast**
- [ ] 脚本输出一律 ASCII（console 的 bash 是单字节 locale）

**回退**：恢复脚本原文（迁移脚本备份）。

## P2 · `CONFIG_MASTER_KEY` 多机分发（独立小设计）

- [ ] 明确主密钥如何到各机器（**不要放进配置中心** —— 鸡生蛋）
- [ ] 落地方式与轮换流程

## 收尾

- [ ] 全量单测：`cd servers/deploy-console && npx jest`；`cd servers/gateway && npx jest`
- [ ] 端到端（V5）：同一服务在 `local` / `dev` 下发到不同值，互不影响
- [ ] 更新 `design.md` §10 的落位表为「已实施 + 锚点」
- [ ] `docs/development/local-dev-guide.md` 的已知问题/配置清单补一条：`.env.generated` 的来源与回退
- [ ] 分阶段提交（P0-1 / P0-2 / P0-3 / P0-4 各自可独立回退）

## 一行级短期替代（若这轮不想做 P0）

- [ ] gateway 内部端点鉴权**也接受 `INTERNAL_API_KEY`**（控制台已持有）→ 撤掉 `GATEWAY_SERVICE_KEY`
      （改动：gateway `.env` 加一行 + `proxy.controller.ts` 校验加一个候选）
