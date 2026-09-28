import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeployVersionEntity } from '../entities/deploy-version.entity';
import { DeployDeploymentEntity } from '../entities/deploy-deployment.entity';
import { DeployAppEntity } from '../entities/deploy-app.entity';
import { DeployAppEnvVersionEntity } from '../entities/deploy-app-env-version.entity';
import { ReleaseRegistryService } from './release-registry.service';

/**
 * 版本注册表工具模块（version/pointer 内置步骤的执行体）。
 * 与 tool-catalog `semantic` 分类的 service 工具对应（版本表/指针为发布语义真相源）。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      DeployVersionEntity,
      DeployDeploymentEntity,
      // 双写（2026-09-28）：前端 env-dir 应用的指针同步到 deploy_app_env_versions
      DeployAppEntity,
      DeployAppEnvVersionEntity,
    ]),
  ],
  providers: [ReleaseRegistryService],
  exports: [ReleaseRegistryService],
})
export class ReleaseRegistryModule {}
