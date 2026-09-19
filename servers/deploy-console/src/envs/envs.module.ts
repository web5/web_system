import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeploySiteEntity } from '../entities/deploy-site.entity';
import { DeployEnvEntity } from '../entities/deploy-env.entity';
import { DeployAppEnvVersionEntity } from '../entities/deploy-app-env-version.entity';
import { DeployServiceEnvEntity } from '../entities/deploy-service-env.entity';
import { DeployServiceEntity } from '../entities/deploy-service.entity';
import { EnvsService } from './envs.service';
import { EnvsController } from './envs.controller';
import { AuditModule } from '../audit/audit.module';

/**
 * 环境域模块（微前端加载维度）：站点 + 环境 + 环境详情承载的后端服务指向。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      DeploySiteEntity,
      DeployEnvEntity,
      DeployAppEnvVersionEntity,
      DeployServiceEnvEntity,
      DeployServiceEntity,
    ]),
    AuditModule,
  ],
  controllers: [EnvsController],
  providers: [EnvsService],
  exports: [EnvsService],
})
export class EnvsModule {}
