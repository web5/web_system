import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationLogEntity } from '../entities/notification-log.entity';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { SystemSettingsModule } from '../system-settings/system-settings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([NotificationLogEntity]),
    // 通知渠道配置来自系统设置（页面可配，DB 优先、env 兜底）
    SystemSettingsModule,
  ],
  controllers: [NotificationController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
