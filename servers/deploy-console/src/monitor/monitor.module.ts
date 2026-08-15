import { Module } from '@nestjs/common';
import { MonitorController } from './monitor.controller';
import { MonitorService } from './monitor.service';
import { EnvironmentModule } from '../environment/environment.module';

/**
 * 服务监控模块
 */
@Module({
  imports: [EnvironmentModule],
  controllers: [MonitorController],
  providers: [MonitorService],
  exports: [MonitorService],
})
export class MonitorModule {}
