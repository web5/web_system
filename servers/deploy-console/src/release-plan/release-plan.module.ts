import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ModuleRegistryModule } from '../module-registry/module-registry.module';
import { ArtifactStoreModule } from '../artifact/artifact-store.module';
import { ReleaseLockModule } from '../release-lock/release-lock.module';
import { ReleaseRegistryModule } from '../registry/release-registry.module';
import { ApprovalModule } from '../approval/approval.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { FactModule } from '../fact/fact.module';
import { ReleasePlanService } from './release-plan.service';

/**
 * 发布提案（release_plan）模块 —— L1 只读 dry-run。
 *
 * 依赖全部是**现有模块的只读能力**，因此这里不注册任何 TypeORM feature：
 * 一旦出现 `@InjectRepository`，就意味着它开始自己解释数据，
 * 与本模块"复用既有真相源"的原则相悖。单测里的只读断言会守住这条。
 */
@Module({
  imports: [
    ConfigModule,
    ModuleRegistryModule,
    ArtifactStoreModule,
    ReleaseLockModule,
    ReleaseRegistryModule,
    ApprovalModule,
    PipelineModule,
    FactModule,
  ],
  providers: [ReleasePlanService],
  exports: [ReleasePlanService],
})
export class ReleasePlanModule {}
