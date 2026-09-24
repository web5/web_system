import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MonitorController } from './monitor.controller';
import { MonitorService } from './monitor.service';
import { ConsoleInstanceSelfCheckService } from './console-instance-self-check.service';
import { EnvironmentModule } from '../environment/environment.module';
import { ServerModule } from '../server/server.module';
import { HostsModule } from '../hosts/hosts.module';
import { AuditModule } from '../audit/audit.module';
import { DeployServiceEnvEntity } from '../entities/deploy-service-env.entity';

/**
 * 服务监控与自助诊断模块
 *
 * 环境/主机的真相源是「基础设施 → 主机管理」（HostsModule），
 * 旧表 deploy_servers 仅作为发布侧的回退保留（见 deploy.service.resolveDeployServers）。
 */
@Module({
  imports: [
    EnvironmentModule,
    ServerModule,
    HostsModule,
    TypeOrmModule.forFeature([DeployServiceEnvEntity]),
    // 重启等运维操作需留审计
    AuditModule,
  ],
  controllers: [MonitorController],
  providers: [MonitorService, ConsoleInstanceSelfCheckService],
  exports: [MonitorService],
})
export class MonitorModule {}
