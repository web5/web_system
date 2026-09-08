import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeployReleaseEventEntity } from '../entities/deploy-release-event.entity';
import { PipelineModule } from '../pipeline/pipeline.module';
import { ReleaseHookController } from './release-hook.controller';
import { ReleaseHookService } from './release-hook.service';

/**
 * CI/CD 发布触发模块。
 *
 * 依赖 PipelineModule：触发端点只是「发布意图」的入口，
 * 真正的执行引擎仍是流水线（不另起炉灶，避免绕过治理）。
 */
@Module({
  imports: [TypeOrmModule.forFeature([DeployReleaseEventEntity]), PipelineModule],
  controllers: [ReleaseHookController],
  providers: [ReleaseHookService],
  exports: [ReleaseHookService],
})
export class ReleaseHookModule {}
