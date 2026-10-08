import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeployCanaryRuleEntity } from '../entities/deploy-canary-rule.entity';
import { CanaryService } from './canary.service';
import { CanaryController } from './canary.controller';
import { AuditModule } from '../audit/audit.module';
import { CloudDbModule } from '../cloud-db/cloud-db.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([DeployCanaryRuleEntity]),
    AuditModule,
    // 配置镜像双写（M4）：把本地写的配置行同步到云数据库
    CloudDbModule,
  ],
  providers: [CanaryService],
  controllers: [CanaryController],
  exports: [CanaryService],
})
export class CanaryModule {}
