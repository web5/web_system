import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentRun } from './entities/agent-run.entity';
import { ModelPricing } from './entities/model-pricing.entity';
import { RunMetrics } from './entities/run-metrics.entity';
import { AgentLogService } from './agent-log.service';
import { AgentLogController } from './agent-log.controller';
import { AgentLogInternalController } from './agent-log.internal.controller';
import { DictPricingProvider } from './dict-pricing.provider';
import { AuthModule } from '../auth/auth.module';

@Module({
  // ModelPricing 实体保留注册：表与存量数据留档，只是不再有 CRUD 入口（单价改由字典维护）
  imports: [TypeOrmModule.forFeature([AgentRun, ModelPricing, RunMetrics]), AuthModule],
  providers: [AgentLogService, DictPricingProvider],
  controllers: [AgentLogController, AgentLogInternalController],
  exports: [AgentLogService, TypeOrmModule],
})
export class AgentLogModule {}
