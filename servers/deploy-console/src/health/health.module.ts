import { Controller, Get, Module } from '@nestjs/common';
import { Public } from '@web-system/shared';

/**
 * 统一探活端点 `GET /health`（免鉴权）。
 * 结构与 gateway 版一致，见 specs/backend-health-endpoint/design.md §3.2。
 *
 * 本服务有 APP_GUARD（JwtAuthGuard）与全局前缀 `api`，故 `@Public()` 必需，
 * 且 main.ts 用 `setGlobalPrefix('api', { exclude: ['health'] })` 让 `/health` 裸路径生效
 * （否则端点变成 `/api/health`，与其余服务不一致）。
 */
@Public()
@Controller()
export class HealthController {
  @Get('health')
  heartbeat() {
    return {
      status: 'ok',
      service: 'deploy-console',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
