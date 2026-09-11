import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentRun } from './entities/agent-run.entity';
import { ModelPricing } from './entities/model-pricing.entity';
import { RunMetrics } from './entities/run-metrics.entity';
import { AgentLogService } from './agent-log.service';
import { AgentLogController } from './agent-log.controller';
import { AgentLogInternalController } from './agent-log.internal.controller';
import { ModelPricingService } from './pricing.service';
import { ModelPricingCatalog } from './model-pricing.catalog';
import { ModelPricingController } from './pricing.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([AgentRun, ModelPricing, RunMetrics]), AuthModule],
  providers: [AgentLogService, ModelPricingService, ModelPricingCatalog],
  controllers: [AgentLogController, AgentLogInternalController, ModelPricingController],
  exports: [AgentLogService, TypeOrmModule],
})
export class AgentLogModule {}
