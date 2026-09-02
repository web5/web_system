import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeployToolEntity } from '../entities/deploy-tool-catalog.entity';
import { ToolCatalogService } from './tool-catalog.service';
import { ToolCatalogController } from './tool-catalog.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([DeployToolEntity]),
    // 工具管理写操作需审计
    AuditModule,
  ],
  controllers: [ToolCatalogController],
  providers: [ToolCatalogService],
  exports: [ToolCatalogService],
})
export class ToolCatalogModule {}
