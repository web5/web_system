import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeployDeploymentEntity } from './deploy-deployment.entity';
import { DeployModuleEntity } from './deploy-module.entity';
import { DeployCanaryRuleEntity } from './deploy-canary-rule.entity';
import { IndexHtmlService } from './index-html.service';
import { VersionController } from './version.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature(
      [DeployDeploymentEntity, DeployModuleEntity, DeployCanaryRuleEntity],
      'deploy',
    ),
  ],
  controllers: [VersionController],
  providers: [IndexHtmlService],
  exports: [IndexHtmlService],
})
export class DeployVersionModule {}
