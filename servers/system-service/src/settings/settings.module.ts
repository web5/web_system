import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SystemConfig } from '../config/system-config.entity';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { OperationLogsModule } from '../operation-logs/operation-logs.module';

@Module({
  imports: [TypeOrmModule.forFeature([SystemConfig]), OperationLogsModule],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
