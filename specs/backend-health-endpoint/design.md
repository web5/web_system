# 后端服务统一 `GET /health` 探活端点

> 触发：deploy-console 服务监控页「响应」列大量 404，探活打的是 `/` 根路径，各服务无根路由 → 404 虽被判为「在线」但显示不友好、且无法区分「活着」与「真的健康」。
> 关联：`specs/deploy-console/monitor-health-single-ssh.md`（探活已收敛为单 SSH 会话）、`servers/gateway/src/health/health.controller.ts`（现有唯一实现，作为模板）
> 状态：已实现（commit da78932，分支 feature/backend-health-endpoint）；本地与 dev 均已实测通过

---

## 1 目标与非目标

**目标**

- G1：每个后端 NestJS 服务都提供**免鉴权** `GET /health`，返回统一结构，供监控探活 / 负载均衡 / 流水线 verify 使用。
- G2：监控页「响应」列从 404 变为 200，能区分「健康（200）」与「活着但无 health 端点（404，未升级的服务）」。
- G3：顺带受益 —— `deploy-console/src/services/services.service.ts:680` 的 `probeHealth` 默认打 `${upstream}/health`，此前各服务普遍没有该端点。

**非目标**

- 不做 Terminus 式深度健康检查（DB/Redis 探针）。全仓 `@nestjs/terminus` 依赖为 0，本期做**零依赖版**（与 gateway 现有一致）。深度探针列 P2。
- 不改鉴权体系、不动各服务既有守卫语义。

---

## 2 影响清单（批量整改）

| # | 服务目录 | 端口（ecosystem 权威） | 全局守卫 | 新端点是否需 `@Public` | 全局前缀影响 | 现状 |
|---|---|---|---|---|---|---|
| 1 | `servers/gateway` | 6000 | APP_GUARD AuthGuard + ThrottlerGuard | 已有 `@Public` | 无 | **已完成**（`/health` + `/api/health`），本期**不改** |
| 2 | `servers/auth-service` | 6101（dev/prod 6001） | 无（逐控制器 `@UseGuards(JwtAuthGuard)`） | 否（加更稳） | 无 | 新增 |
| 3 | `servers/user-service` | 6002 | 无（逐控制器） | 否 | 无 | 新增 |
| 4 | `servers/ai-service` | 6003 | 无 | 否 | 无 | 新增 |
| 5 | `servers/system-service` | 6004 | **APP_GUARD AuthGuard + PermissionsGuard** | **是**（否则 401） | 无 | 新增 |
| 6 | `servers/todo-service` | 6005 | 无 | 否 | 无 | 新增 |
| 7 | `servers/mcp-gateway` | 6006 | 无 Nest 守卫（`/mcp` 手写 Bearer） | 否 | 无（控制器自带 `api` 前缀） | 新增 |
| 8 | `servers/content-hub` | 6007 | 无 guard 文件 | 否 | 无（控制器自带 `api` 前缀） | 新增 |
| 9 | `servers/upload-service` | 6008 | 无（逐控制器） | 否 | 无 | 新增 |
| 10 | `servers/ai-agent` | 6010 | 无 | 否 | 无 | 新增 |
| 11 | `servers/knowledge-service` | 6011 | 无 | 否 | 无 | 新增 |
| 12 | `servers/deploy-console` | 6200 | **APP_GUARD JwtAuthGuard** | **是** | **有 `setGlobalPrefix('api')`** | 新增 + 前缀排除 |

**改动文件量预估**：新增 11 个 `health.controller.ts`、改 11 个 `app.module.ts`、共享包 2 个文件、deploy-console `main.ts` 1 处 + 探活服务 1 处。约 26 个文件。

**风险与缓解**

| 风险 | 缓解 |
|---|---|
| 全局守卫下漏加 `@Public` → /health 401，探活判「活着但 401」不判死（非 000 即 up），不会误报离线 | 验收逐服务 curl 断言 200 + 无 401 |
| `system-service` 的 PermissionsGuard 在 AuthGuard 之后读 `user.roles`，`@Public` 需在 AuthGuard 分支提前 return（现有 `auth.guard.ts:52-54` 已满足） | 同上 |
| deploy-console 全局前缀 `api` 会把 `/health` 变成 `/api/health` | `setGlobalPrefix('api', { exclude: ['health'] })` 双挂，保持与平台 `healthPath` 约定兼容 |
| 共享包下沉装饰器后各服务要按 `dist` 解析类型 | 改动后先 `pnpm --filter @web-system/shared build`；`SetMetadata` 是纯函数，无 pnpm 隔离下多 `@nestjs/common` 实例的风险（异常类/守卫才不能下沉） |
| 服务需重启才生效 | 见 §5 发布与验证 |

---

## 3 设计

### 3.1 免鉴权装饰器：下沉到共享包

现状：`@Public` / `IS_PUBLIC_KEY` 只存在于 6 个服务各自的 internal 目录（gateway / ai-service / ai-agent / knowledge-service / system-service / deploy-console），其余 6 个服务没有；**所有实现的 metadata key 字符串完全一致（`'isPublic'`）**，语义互通。

决策：**新增共享包导出，不在各服务复制第 7 份**。

```ts
// packages/shared/src/auth/public.decorator.ts（新增）
import { SetMetadata } from '@nestjs/common';
/** 标记路由/控制器无需登录即可访问（key 与既有实现一致，可直接替换） */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

```ts
// packages/shared/src/index.ts（追加导出）
export { Public, IS_PUBLIC_KEY } from './auth/public.decorator';
```

- 12 个服务**均已**声明 `"@web-system/shared": "workspace:*"`，无需改 package.json。
- 既有 6 份本地装饰器**本期不动**（语义等价，替换属额外改动面），仅新增端点统一 import 共享版；后续收敛另立任务。

### 3.2 统一响应结构（与 gateway 现有一致）

```ts
@Public()
@Controller()
export class HealthController {
  @Get('health')
  heartbeat() {
    return {
      status: 'ok',
      service: '<moduleKey>',   // 如 'auth-service'
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }
}
```

- 无 `@UseGuards`、无业务依赖注入 → 启动期零新增依赖，无崩溃风险。
- gateway 版额外有 `@SkipThrottle()`（它有全局 ThrottlerGuard）；其余服务无限流，不加。

### 3.3 deploy-console 前缀

`servers/deploy-console/src/main.ts:42`：`app.setGlobalPrefix('api', { exclude: ['health'] })` —— 既保留 `/api/*` 现状，又让 `/health` 裸路径生效（与其余 11 个服务一致，探活命令可统一打 `/health`）。

### 3.4 监控探活切换

`servers/deploy-console/src/monitor/monitor.service.ts` 的批量探活命令：探测路径由 `/` 改为 `/health`，判活口径不变（非 `000` 即 `up`）。

语义对照（页面「响应」列）：

| 响应码 | 含义 |
|---|---|
| `200` | 服务已升级，health 端点正常 |
| `404` | 端口在监听（进程活着），但该服务尚无 `/health`（未升级/前缀未排除） |
| `401` | `/health` 存在但被鉴权拦住 —— 属配置缺陷，应修 |
| `000` | 连不上，服务离线 |

不改前端（`ServiceMonitor.vue` 直接展示 `response` 原文）。

---

## 4 分期

- **P0**：共享装饰器 + 11 个服务新增 `HealthController` + deploy-console 前缀排除 + 探活路径切 `/health`。
- **P1**：本地（release 目录）重启并逐个验证 200；dev 环境同步。
- **P2（未定）**：Terminus 深度探针（DB/Redis）、把 6 份本地 `@Public` 收敛为共享版、监控页把 404 显示为「存活（无 health 端点）」。

---

## 5 发布与验证

发布铁律（见 memory）：服务实际从 `~/web_system_release` 运行；改完必须 **构建 → 同步发布目录 → 干净重启 → 核对端口占用者 == pm2 pid** 才生效。

- 构建：`packages/shared` 先 build；各服务 `npm run build`。
- 验证（每个服务）：`curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:<port>/health` 断言 `200`；并确认响应体 `status=ok`、`service` 与模块 key 一致。
- 端到端：deploy-console 探活刷新 → 响应列应为 200（未升级的服务为 404）。

### 5.0 dev 实测结果（2026-09-24）

- dev 11 个服务（6000–6011）`/health` 全部 200；`GET /console/api/monitor/health?env=dev` 的响应列**由 404 全部变为 200**（10 个有地址的服务）。
- dev 控制台直连 `curl 127.0.0.1:6200/health` → `{"status":"ok","service":"deploy-console"}`，证明前缀排除生效。
- 发布方式：产物 rsync 到 `/data/web_system/servers/<svc>/dist` + `packages/{shared,types,mcp-core}/dist`，
  再 `env -i` 干净重启各 pm2 进程（旧 dist 备份为 `dist.bak-1790230544`）；控制台走 `publish-deploy-console.sh --env dev`。
- 注意：user-service 启动约需 11s（权限 seed），探活/重启脚本的等待时间要留够，否则误判未启动。

### 5.1 本地实测结果（2026-09-24）

| 端口 | 服务 | `/health` |
|---|---|---|
| 6000 | gateway | 200（既有实现） |
| 6101 | auth-service | 200 |
| 6002 | user-service | 200 |
| 6003 | ai-service | 200 |
| 6004 | system-service | 200（全局守卫下 `@Public` 生效，非 401） |
| 6005 | todo-service | 200 |
| 6006 | mcp-gateway | 200 |
| 6007 | content-hub | 200 |
| 6008 | upload-service | 200 |
| 6010 | ai-agent | 200 |
| 6011 | knowledge-service | 200 |
| 6200 | deploy-console | 200（前缀排除生效，未落到 `/api/health`） |

控制台本机探活 `GET /api/monitor/local/health` 全部 `up / 200`；响应体 `service` 字段与模块 key 一致。

**过程中踩到的环境坑（非代码问题）**：本地 `packages/types` 与 `packages/mcp-core` 的 `dist` 长期陈旧 ——
`types/dist` 缺 `preferences` 导致 auth-service 编译报 TS2353，`mcp-core/dist` 缺失导致 mcp-gateway 报 TS2307
「Cannot find module」。两个都在各自 `npm run build` 后消失（与 memory「workspace 包必须跑完整 build」一致）。

## 6 待确认

- Q1：本期是否只做本地 + dev，prod 另排？（倾向：本地 + dev；prod 走发布流程另排）
- Q2：`/health` 是否需带 `version`（git 短 hash）便于核对发布版本？（倾向：暂不加，避免构建期耦合）
- Q3：共享装饰器下沉后，是否同期替换既有 6 份本地实现？（倾向：否，另立收敛任务）
