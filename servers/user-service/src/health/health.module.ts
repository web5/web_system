import { Controller, Get, Module } from '@nestjs/common';
import { Public } from '@web-system/shared';

/**
 * 统一探活端点 `GET /health`（免鉴权）。
 * 结构与 gateway 版一致，见 specs/backend-health-endpoint/design.md §3.2。
 */
@Public()
@Controller()
export class HealthController {
  @Get('health')
  heartbeat() {
    return {
      status: 'ok',
      service: 'user-service',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
