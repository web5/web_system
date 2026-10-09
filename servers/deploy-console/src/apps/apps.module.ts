import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeployAppEntity } from '../entities/deploy-app.entity';
import { DeployAppRouteEntity } from '../entities/deploy-app-route.entity';
import { DeployAppEnvVersionEntity } from '../entities/deploy-app-env-version.entity';
import { DeployModuleEntity } from '../entities/deploy-module.entity';
import { AppsService } from './apps.service';
import { AppsController } from './apps.controller';
import { EnvsModule } from '../envs/envs.module';
import { AuditModule } from '../audit/audit.module';
import { CloudDbModule } from '../cloud-db/cloud-db.module';
import { ReleaseRegistryModule } from '../registry/release-registry.module';
import { ShellModule } from '../shell/shell.module';
import { EnvArtifactService } from './env-artifact.service';
import { CommonModule } from '../common/common.module';

/**
 * 应用域模块（微前端）：应用 + shell 挂载路由 + 版本指针（含入口指针写入）。
 * 依赖 EnvsModule 校验环境存在性（环境是加载维度，应用必须落在某个环境上）。
 */
@Module({
  imports: [
    // 配置镜像双写（M4）：把本地写的配置行同步到云数据库
    CloudDbModule,
    // 版本指针写入的唯一入口（含 prod 云库镜像，2026-10-09 收敛）
    ReleaseRegistryModule,
    // 远端静态根读写要用命令执行通道（ssh），诊断 #3
    ShellModule,
    // gateway 版本缓存失效通知（诊断 #16）
    CommonModule,
    TypeOrmModule.forFeature([
      DeployAppEntity,
      DeployAppRouteEntity,
      DeployAppEnvVersionEntity,
      // 历史模块注册表（应用种子导入用，P4 退役后移除）
      DeployModuleEntity,
    ]),
    EnvsModule,
    AuditModule,
  ],
  controllers: [AppsController],
  providers: [AppsService, EnvArtifactService],
  exports: [AppsService, EnvArtifactService],
})
export class AppsModule {}
