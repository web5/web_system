import { Module } from '@nestjs/common';
import { ProxyModule } from '../proxy/proxy.module';
import { ApiAuthController, ApiUsersController, ApiAiController } from './api-docs.controller';

@Module({
  imports: [ProxyModule],
  controllers: [ApiAuthController, ApiUsersController, ApiAiController],
})
export class ApiDocsModule {}
