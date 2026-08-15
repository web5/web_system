import { Module } from '@nestjs/common';
import { ConfigController } from './config.controller';
import { ConfigService_ } from './config.service';
import { AuditModule } from '../audit/audit.module';

/**
 * 配置管理模块
 */
@Module({
  imports: [AuditModule],
  controllers: [ConfigController],
  providers: [ConfigService_],
  exports: [ConfigService_],
})
export class ConfigModule {}
