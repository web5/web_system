---
name: be-developer
description: web_system 后端开发技能 — NestJS 微服务（gateway/auth/user/ai/ai-agent/system/todo/upload/content-hub/mcp-gateway/deploy-console）接口/数据/安全/部署任务的标准执行方式。触发：新增或修改服务、接口、数据层、安全横切、部署。
version: 1.0.0
---

# web_system 后端开发（be-developer）

## 职责

把后端任务按 web_system 工程架构落地：架构前置审查 → 影响面定位 → 安全/质量铁律自查 → 超时与数据层核对 → 联调发布。通用后端工程质量按 `be-dev-common`（ai-agent-kit `references/be-dev-common.md`）执行，本卡只写 web_system 特有部分。

## 触发条件

- 新增/修改微服务、REST 接口、数据实体与迁移、安全横切（CORS/鉴权/日志/异常）、部署发布。

## 工作流

1. **架构前置**：涉及选型/库表/跨服务/安全方案 → 先加载 `tech-review` 审查；小改动直连实现。
2. **定位与影响面**：确认改动落在哪个服务（端口表见 CODEBUDDY）；**横切关注点改前 grep 全部服务**（CORS `enableCors` / 异常过滤器 `useGlobalFilters` / `console.` / JWT_SECRET 校验），不能只改"刚好触及"的一个。
3. **编码（铁律自查）**：按 CODEBUDDY「AI 编程规范」表逐类自查——安全铁律（CORS 白名单/DTO 校验/Logger/异常脱敏/JWT 启动校验）、代码质量（TS strict 禁 any/无用依赖）、部署铁律；通用未覆盖项按 be-dev-common §二。
4. **超时核对**：三层超时（前端 shared `API_TIMEOUT` / gateway `proxy.service.ts PROXY_TIMEOUT` / service 调用第三方 `.client.ts`）；AI 类接口（`/api/ai/*` 等）必须传 `PROXY_TIMEOUT.AI_TASK`，否则被 30s 默认截断。
5. **数据层**：TypeORM 实体/迁移；写操作幂等与事务边界；先查执行计划再建索引；避免 N+1（循环查库）。详见各服务与 be-dev-common §一(6)。
6. **联调验证**：本地按端口表起服务（`./start-local.sh` 或分服务）；完成声明 = 调接口/跑测试的证据。
7. **发布**：后端服务走发布流水线（`POST /api/pipelines`，env=local）；**deploy-console 自身走传统发布**（构建 dist + pm2 restart，勿走流水线，防自杀式 restart）。发布目录 `~/web_system_release`。详见 `docs/development/local-release-runbook.md`。
8. **提交铁律**：只 `git add` 本次工作文件；提 PR 用根 `.env` 的 `GITHUB_PR_TOKEN`（详见 CODEBUDDY 提交铁律与 `docs/development/admin-dev.md` §五）。

## 覆盖核对（已有资产 ↔ 通用规则）

| 通用规则（be-dev-common §二） | web_system 落点 | 状态 |
|---|---|---|
| CORS / 异常脱敏 / 入参 DTO / 日志 / 密钥 / TS strict / 认证 | CODEBUDDY 安全铁律 + 代码质量铁律 | 已覆盖（项目优先） |
| 超时分层 / 配置收口 shared / 横切扫全量 / 魔法数字 | CODEBUDDY 开发规则（§2/§3/§1） | 已覆盖 |
| 幂等（写接口/消费端） | 无专项文档 | **按通用层补充** |
| 异步异常兜底（unhandled rejection） | 无专项文档 | **按通用层补充** |
| 事务边界 / 连接释放 | 无专项文档 | **按通用层补充** |
| 查询优化（执行计划/N+1/索引） | 无专项文档 | **按通用层补充** |
| 密码哈希 / 注入防护 / 速率限制 | 视具体服务实现 | 按通用层核对 |
| 部署/发布 | CODEBUDDY 部署铁律 + 发布手册 + 流水线 | 已覆盖（项目优先） |

## 不做什么

- 不写 `any` / `console.log` / 裸 CORS（`*` 或无参 `enableCors`）/ 硬编码魔法数字。
- 不在 `tsconfig.json` 加 `paths` 映射引用 shared（会污染 nest build 产物）。
- 不跨端拷贝配置（收口 `@web-system/shared`）；不用 `pm2 --update-env` 传播旧环境变量。
- deploy-console 自身不经流水线发布。
- 提 PR 不混入无关未提交文件；token 不明文写入可提交文件。

## 参考文档

| 文档 | 何时加载 |
|------|---------|
| CODEBUDDY.md（开发规则 / AI 编程规范 / 部署铁律 / 微前端四步 / 提交铁律） | 任何后端任务（常驻） |
| `.codebuddy/references/coding-best-practices.md` | 编码细则 |
| `docs/development/local-release-runbook.md` / `deploy-pipeline-dev.md` / `admin-dev.md` | 发布/流水线/提 PR |
| be-dev-common（ai-agent-kit `references/be-dev-common.md`） | 通用工程质量规则 |
