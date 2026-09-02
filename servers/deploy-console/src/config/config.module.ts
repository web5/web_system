import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigItemEntity } from '../entities/config-item.entity';
import { ConfigSnapshotEntity } from '../entities/config-snapshot.entity';
import { ConfigService } from './config.service';
import { ConfigController } from './config.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ConfigItemEntity, ConfigSnapshotEntity])],
  controllers: [ConfigController],
  providers: [ConfigService],
  exports: [ConfigService],
})
export class ConfigCenterModule {}
