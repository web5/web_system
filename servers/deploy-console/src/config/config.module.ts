import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigItemEntity } from '../entities/config-item.entity';
import { ConfigSnapshotEntity } from '../entities/config-snapshot.entity';
import { AuditModule } from '../audit/audit.module';
import { ConfigService } from './config.service';
import { ConfigController } from './config.controller';
import { ConfigSelfCheckService } from './config-self-check.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ConfigItemEntity, ConfigSnapshotEntity]),
    // 配置变更必须留审计（密钥只记"已变更"，明文不入审计）
    AuditModule,
  ],
  controllers: [ConfigController],
  // ConfigSelfCheckService：启动期主密钥自检（design §5.2，密钥错即 fail-fast）
  providers: [ConfigService, ConfigSelfCheckService],
  exports: [ConfigService],
})
export class ConfigCenterModule {}
