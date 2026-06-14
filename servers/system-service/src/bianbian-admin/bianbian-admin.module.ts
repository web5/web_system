import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BianbianMaterial } from './entities/bianbian-material.entity';
import { BianbianAdminController } from './bianbian-admin.controller';
import { BianbianAdminService } from './bianbian-admin.service';

@Module({
  imports: [TypeOrmModule.forFeature([BianbianMaterial])],
  controllers: [BianbianAdminController],
  providers: [BianbianAdminService],
  exports: [BianbianAdminService],
})
export class BianbianAdminModule {}
