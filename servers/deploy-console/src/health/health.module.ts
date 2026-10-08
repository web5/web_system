import { Controller, Get, Module } from '@nestjs/common';
import { Public } from '@web-system/shared';
import { CloudDbModule } from '../cloud-db/cloud-db.module';
import { CloudDbService } from '../cloud-db/cloud-db.service';

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
  constructor(private readonly cloudDb: CloudDbService) {}

  @Get('health')
  heartbeat() {
    return {
      status: 'ok',
      service: 'deploy-console',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }

  /**
   * 云数据库（prod 数据真相源）连通性探活 —— 发布前预检 / 排障用。
   *
   * 实际路径 `/api/health/cloud-db`（全局前缀 `api` 只 exclude 了裸 `health`，
   * 而裸路径会被 serve-static 的 SPA 回退吃掉，故统一走 `/api` 前缀）。
   *
   * 只暴露「通不通 + 延迟」，不回显主机与凭据（公网链路信息不外泄）。
   * 未启用时返回 `enabled:false`，运维据此判断当前是否处于「人工同步」模式。
   */
  @Get('health/cloud-db')
  async cloudDbPing() {
    const r = await this.cloudDb.ping();
    return {
      status: r.ok ? 'ok' : 'degraded',
      enabled: r.enabled,
      latencyMs: r.latencyMs,
      // 错误信息只保留错误码/类型，不回显主机端口
      error: r.error ? String(r.error).replace(/(\d+\.){3}\d+|[\w.-]+\.sql\.tencentcdb\.com/g, '<redacted>') : undefined,
      checkedAt: new Date().toISOString(),
    };
  }
}

@Module({ imports: [CloudDbModule], controllers: [HealthController] })
export class HealthModule {}
