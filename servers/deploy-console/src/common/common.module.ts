import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { InternalGuardService } from './internal-guard.service';
import { GatewayCacheService } from './gateway-cache.service';

/**
 * 通用设施模块。
 *
 * 目前只放 `InternalGuardService`（诊断 #7）。做成模块而非纯函数导出，
 * 是因为**限流器必须持有进程内状态**才能跨请求计数 —— 每次 new 出来的
 * limiter 等于没限流。这里保证它是单例。
 */
@Module({
  imports: [AuditModule],
  providers: [InternalGuardService, GatewayCacheService],
  exports: [InternalGuardService, GatewayCacheService],
})
export class CommonModule {}
