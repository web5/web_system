import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { BianbianRecord } from './entities/bianbian-record.entity';
import { BianbianService } from './bianbian.service';
import { BianbianController } from './bianbian.controller';
import { ImageGenClient } from './image-gen.client';
import { UploadStoreClient } from './upload-store.client';

@Module({
  imports: [TypeOrmModule.forFeature([BianbianRecord]), HttpModule, ConfigModule],
  controllers: [BianbianController],
  providers: [BianbianService, ImageGenClient, UploadStoreClient],
  exports: [BianbianService],
})
export class BianbianModule {}
