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
// 内部发布接口的「切指针」（发布节点脚本调用）复用版本注册表
import { ReleaseRegistryModule } from '../registry/release-registry.module';
// 内部发布接口的「env-dir 应用激活」（写磁盘入口指针 + 应用环境版本表）复用应用域
import { AppsModule } from '../apps/apps.module';
// 配置中心：部署前把解析结果下发给服务进程（写 .env.generated），见 DeployService.writeGeneratedEnv
import { ConfigCenterModule } from '../config/config.module';

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
    ReleaseRegistryModule,
    AppsModule,
    // 配置中心（下发配置到服务 .env.generated）
    ConfigCenterModule,
    TypeOrmModule.forFeature([DeployTaskEntity, DeployVersionEntity, DeployDeploymentEntity]),
  ],
  controllers: [DeployController, InternalReleaseController],
  providers: [DeployService],
  exports: [DeployService],
})
export class DeployModule {}
