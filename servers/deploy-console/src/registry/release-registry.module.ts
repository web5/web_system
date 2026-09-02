import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeployVersionEntity } from '../entities/deploy-version.entity';
import { DeployDeploymentEntity } from '../entities/deploy-deployment.entity';
import { ReleaseRegistryService } from './release-registry.service';

/**
 * 版本注册表工具模块（version/pointer 内置步骤的执行体）。
 * 与 tool-catalog `semantic` 分类的 service 工具对应（版本表/指针为发布语义真相源）。
 */
@Module({
  imports: [TypeOrmModule.forFeature([DeployVersionEntity, DeployDeploymentEntity])],
  providers: [ReleaseRegistryService],
  exports: [ReleaseRegistryService],
})
export class ReleaseRegistryModule {}
