import { Module } from '@nestjs/common';
import { ModuleRegistryModule } from '../module-registry/module-registry.module';
import { ReleaseRegistryModule } from '../registry/release-registry.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { FactModule } from '../fact/fact.module';
import { CommonModule } from '../common/common.module';
import { ProbeModule } from '../probe/probe.module';
import { ReleaseVerifyService } from './release-verify.service';

/**
 * 发布后验证（verify_release）模块 —— L1 只读。
 *
 * 依赖全部是**现有模块的只读能力**，因此这里不注册任何 TypeORM feature：
 * 一旦出现 `@InjectRepository`，就意味着它开始自己解释数据，
 * 与本模块"复用既有真相源"的原则相悖。单测里的只读断言会守住这条。
 * （CommonModule/ProbeModule 用于 manifest 比对：urlFor 读配置、fetchGatewayManifest 是 GET。）
 */
@Module({
  imports: [ModuleRegistryModule, ReleaseRegistryModule, PipelineModule, FactModule, CommonModule, ProbeModule],
  providers: [ReleaseVerifyService],
  exports: [ReleaseVerifyService],
})
export class ReleaseVerifyModule {}
