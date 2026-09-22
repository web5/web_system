import { Module } from '@nestjs/common';
import { OperationLogsModule } from '../operation-logs/operation-logs.module';
import { SettingsModule } from '../settings/settings.module';
import { InternalStorageController } from './internal-storage.controller';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';

/**
 * 存储配置域：上传根目录的读写 / 校验 / 安全目录浏览。
 *
 * 复用 `SettingsModule`（配置表读写只有一份实现）与 `OperationLogsModule`（浏览留痕）。
 */
@Module({
  imports: [SettingsModule, OperationLogsModule],
  controllers: [StorageController, InternalStorageController],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
