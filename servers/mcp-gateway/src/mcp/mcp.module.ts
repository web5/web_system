import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';
import { McpModuleEntity } from './entities/mcp-module.entity';
import { McpToolEntity } from './entities/mcp-tool.entity';
import { AdminController, DebugController } from '../admin/admin.controller';
import { AdminService } from '../admin/admin.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([McpModuleEntity, McpToolEntity]),
  ],
  controllers: [McpController, AdminController, DebugController],
  providers: [McpService, AdminService],
  exports: [McpService],
})
export class McpModule {}
