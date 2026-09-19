import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeployServiceEntity } from '../entities/deploy-service.entity';
import { DeployServiceRouteEntity } from '../entities/deploy-service-route.entity';
import { DeployEndpointEntity } from '../entities/deploy-endpoint.entity';
import { DeployServiceEnvEntity } from '../entities/deploy-service-env.entity';
import { DeployEnvEntity } from '../entities/deploy-env.entity';
// 种子导入用（迁移 M4/M6-lite，P4 正式迁移后解耦）
import { DeployModuleEntity } from '../entities/deploy-module.entity';
import { DeployEnvServiceRouteEntity } from '../entities/deploy-env-service-route.entity';
import { ServicesService } from './services.service';
import { ServicesController } from './services.controller';
import { AuditModule } from '../audit/audit.module';
import { Pm2Module } from '../pm2/pm2.module';
import { ShellModule } from '../shell/shell.module';

/**
 * 服务域模块（API 网关）：服务 + 转发规则 + 接口清单 + 服务×环境（只读）+ 探活。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      DeployServiceEntity,
      DeployServiceRouteEntity,
      DeployEndpointEntity,
      DeployServiceEnvEntity,
      DeployEnvEntity,
      DeployModuleEntity,
      DeployEnvServiceRouteEntity,
    ]),
    AuditModule,
    // 部署动作所需：pm2 进程名单解析 + 命令执行（与流水线 restart 同链路）
    Pm2Module,
    ShellModule,
  ],
  controllers: [ServicesController],
  providers: [ServicesService],
  exports: [ServicesService],
})
export class ServicesModule {}
