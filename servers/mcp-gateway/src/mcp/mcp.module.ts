import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';
import { McpModuleEntity } from './entities/mcp-module.entity';
import { McpToolEntity } from './entities/mcp-tool.entity';
import { McpApiKeyEntity } from './entities/mcp-api-key.entity';
import { McpKeyCodeEntity } from './entities/mcp-key-code.entity';
import { ApiKeyService } from './api-key.service';
import { ApiKeyController } from './api-key.controller';
import { MailService } from './mail.service';
import { AdminController, DebugController } from '../admin/admin.controller';
import { AdminService } from '../admin/admin.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      McpModuleEntity,
      McpToolEntity,
      McpApiKeyEntity,
      McpKeyCodeEntity,
    ]),
  ],
  controllers: [McpController, AdminController, DebugController, ApiKeyController],
  providers: [McpService, AdminService, ApiKeyService, MailService],
  exports: [McpService],
})
export class McpModule {}
