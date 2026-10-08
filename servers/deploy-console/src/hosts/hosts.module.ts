import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeployHostEntity } from '../entities/deploy-host.entity';
import { DeployServiceEnvEntity } from '../entities/deploy-service-env.entity';
import { AuditModule } from '../audit/audit.module';
import { CloudDbModule } from '../cloud-db/cloud-db.module';
import { HostsService } from './hosts.service';
import { HostsController } from './hosts.controller';

/** 主机管理（服务环境指向的地址来源，page-spec §9.3 / Q17 方案 D） */
@Module({
  imports: [
    TypeOrmModule.forFeature([DeployHostEntity, DeployServiceEnvEntity]),
    AuditModule,
    // 配置镜像双写（M4）：把本地写的配置行同步到云数据库
    CloudDbModule,
  ],
  providers: [HostsService],
  controllers: [HostsController],
  exports: [HostsService],
})
export class HostsModule {}
