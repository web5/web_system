import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeployController } from './deploy.controller';
import { InternalReleaseController } from './internal-release.controller';
import { DeployService } from './deploy.service';
import { AuditModule } from '../audit/audit.module';
import { EnvironmentModule } from '../environment/environment.module';
import { ModuleRegistryModule } from '../module-registry/module-registry.module';
import { ServerModule } from '../server/server.module';
// 后台模块部署需要「落地 + pm2 重启」：用 CommandService 取 pm2 / node 绝对路径
import { ShellModule } from '../shell/shell.module';
import { DeployTaskEntity } from '../entities/deploy-task.entity';
import { DeployVersionEntity } from '../entities/deploy-version.entity';
import { DeployDeploymentEntity } from '../entities/deploy-deployment.entity';
import { StageCommandModule } from '../stage-command/stage-command.module';

/**
 * 部署管理模块
 */
@Module({
  imports: [
    AuditModule,
    EnvironmentModule,
    ModuleRegistryModule,
    ServerModule,
    ShellModule,
    // 构建命令单一真相源：旧 deploy.sh 路径也改读这里，不再依赖 deploy_modules.buildCmd
    StageCommandModule,
    TypeOrmModule.forFeature([DeployTaskEntity, DeployVersionEntity, DeployDeploymentEntity]),
  ],
  controllers: [DeployController, InternalReleaseController],
  providers: [DeployService],
  exports: [DeployService],
})
export class DeployModule {}
