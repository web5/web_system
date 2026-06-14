import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { BianbianRecord } from './entities/bianbian-record.entity';
import { BianbianService } from './bianbian.service';
import { BianbianController } from './bianbian.controller';
import { ImageGenClient } from './image-gen.client';

@Module({
  imports: [TypeOrmModule.forFeature([BianbianRecord]), HttpModule],
  controllers: [BianbianController],
  providers: [BianbianService, ImageGenClient],
  exports: [BianbianService],
})
export class BianbianModule {}
