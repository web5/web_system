# 配置驱动部署 · 任务清单

> 配套：`design.md` ｜ 分支：`feat/deploy-console-domain-split` ｜ 仅本地（local）验证

## P0 · 配置中心全量注入脚本变量

- [ ] `resolveStageVars` 展开 `config`（保护键除外）到脚本变量
- [ ] 新增开关 `PIPELINE_CONFIG_INJECT`（默认开，关=回退旧行为）
- [ ] 保护键清单常量化 + 单测（保护键不可被覆盖）
- [ ] 单测：global < env < module 三级覆盖生效

验收：配置中心写 `env=local` 的自定义键 → 流水线日志能读到该变量。

## P1 · 部署位置字段落库并生效

- [ ] `deploy_apps` 加 `deploy_root` / `default_artifact_path`
- [ ] `deploy_services` 加 `deploy_root` / `default_artifact_path`
- [ ] `ModuleRegistryService` 透出这两个字段
- [ ] 单测：`DEPLOY_TARGET` 由字段推导；未配时为空串（双轨回退）

验收：给 `admin` 配 `deploy_root` → 流水线变量 `DEPLOY_TARGET` 非空。

## P2 · 网关静态根可配

- [ ] gateway 读 `STATIC_PUBLIC_ROOT`（缺省回落现有 `public`）
- [ ] `PUBLIC_ROOT` / `ServeStaticModule.rootPath` 统一走该配置
- [ ] 单测/验证：不配时行为与现状逐字节一致

验收：改 `STATIC_PUBLIC_ROOT` 指向工作区 → `/static/modules/...` 从新根加载。

## P3 · pm2 入口可配

- [ ] `deploy_services` 加 `pm2_script`
- [ ] 注入 `PM2_SCRIPT` / `PM2_CWD`
- [ ] restart 链路读取这两个变量（未配回落 `dist/main.js` + 现有 cwd）

验收：配错 `PM2_SCRIPT` → 明确 fail-fast 日志；不配 → 行为不变。

## 收尾

- [ ] 全量单测（deploy-console + gateway）
- [ ] 本地端到端：admin@local 发布 → 落盘 → manifest → 页面刷新
- [ ] runbook 补配置清单说明
- [ ] 分阶段提交（每阶段可独立回退）
