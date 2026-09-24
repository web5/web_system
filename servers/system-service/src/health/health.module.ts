import { Controller, Get, Module } from '@nestjs/common';
import { Public } from '@web-system/shared';

/**
 * 统一探活端点 `GET /health`（免鉴权）。
 * 结构与 gateway 版一致，见 specs/backend-health-endpoint/design.md §3.2。
 *
 * 本服务有 APP_GUARD（AuthGuard + PermissionsGuard），`@Public()` 是必需的：
 * 否则探活会被 401 拦掉（AuthGuard 读 IS_PUBLIC_KEY 提前放行）。
 */
@Public()
@Controller()
export class HealthController {
  @Get('health')
  heartbeat() {
    return {
      status: 'ok',
      service: 'system-service',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
