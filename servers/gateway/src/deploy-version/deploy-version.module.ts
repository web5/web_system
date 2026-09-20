import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeployDeploymentEntity } from './deploy-deployment.entity';
import { DeployModuleEntity } from './deploy-module.entity';
import { DeployCanaryRuleEntity } from './deploy-canary-rule.entity';
import { IndexHtmlService } from './index-html.service';
import { VersionController } from './version.controller';
import {
  DeployAppEntity,
  DeployAppEnvVersionEntity,
  DeployEnvEntity,
  DeploySiteEntity,
} from '../dynamic-route/entities';

@Module({
  imports: [
    TypeOrmModule.forFeature(
      [
        DeployDeploymentEntity,
        DeployModuleEntity,
        DeployCanaryRuleEntity,
        // 双域重构 P3：manifest 的站点 / 环境 / 应用 / 版本指针（仓储按模块作用域注册，故在此再声明一次）
        DeploySiteEntity,
        DeployEnvEntity,
        DeployAppEntity,
        DeployAppEnvVersionEntity,
      ],
      'deploy',
    ),
  ],
  controllers: [VersionController],
  providers: [IndexHtmlService],
  exports: [IndexHtmlService],
})
export class DeployVersionModule {}
