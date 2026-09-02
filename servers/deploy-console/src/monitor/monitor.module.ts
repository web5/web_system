import { Module } from '@nestjs/common';
import { MonitorController } from './monitor.controller';
import { MonitorService } from './monitor.service';
import { EnvironmentModule } from '../environment/environment.module';
import { ServerModule } from '../server/server.module';
import { AuditModule } from '../audit/audit.module';

/**
 * 服务监控与自助诊断模块
 */
@Module({
  imports: [
    EnvironmentModule,
    ServerModule,
    // 重启等运维操作需留审计
    AuditModule,
  ],
  controllers: [MonitorController],
  providers: [MonitorService],
  exports: [MonitorService],
})
export class MonitorModule {}
