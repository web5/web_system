import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { McpApiKeyEntity } from './entities/mcp-api-key.entity';
import { McpKeyCodeEntity } from './entities/mcp-key-code.entity';
import { User } from '@web-system/shared';
import { ApiKeyService } from './api-key.service';
import { ApiKeyController } from './api-key.controller';
import { InternalKeyController } from './internal.controller';
import { MailService } from './mail.service';
import { InternalGuard } from './internal.guard';

@Module({
  imports: [TypeOrmModule.forFeature([McpApiKeyEntity, McpKeyCodeEntity, User]), ConfigModule],
  controllers: [ApiKeyController, InternalKeyController],
  providers: [ApiKeyService, MailService, InternalGuard],
  exports: [ApiKeyService],
})
export class ApiKeyModule {}
