import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SystemConfig } from '../config/system-config.entity';
import { SettingsController } from './settings.controller';
import { InternalSettingsController } from './internal-settings.controller';
import { SettingsService } from './settings.service';
import { OperationLogsModule } from '../operation-logs/operation-logs.module';
import { InternalGuard } from '../auth/internal.guard';

@Module({
  imports: [TypeOrmModule.forFeature([SystemConfig]), OperationLogsModule],
  controllers: [SettingsController, InternalSettingsController],
  providers: [SettingsService, InternalGuard],
  exports: [SettingsService],
})
export class SettingsModule {}
