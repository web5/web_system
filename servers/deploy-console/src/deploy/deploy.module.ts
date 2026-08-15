import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeployController } from './deploy.controller';
import { DeployService } from './deploy.service';
import { AuditModule } from '../audit/audit.module';
import { EnvironmentModule } from '../environment/environment.module';
import { DeployTaskEntity } from '../entities/deploy-task.entity';
import { DeployVersionEntity } from '../entities/deploy-version.entity';
import { DeployDeploymentEntity } from '../entities/deploy-deployment.entity';

/**
 * 部署管理模块
 */
@Module({
  imports: [
    AuditModule,
    EnvironmentModule,
    TypeOrmModule.forFeature([DeployTaskEntity, DeployVersionEntity, DeployDeploymentEntity]),
  ],
  controllers: [DeployController],
  providers: [DeployService],
  exports: [DeployService],
})
export class DeployModule {}
