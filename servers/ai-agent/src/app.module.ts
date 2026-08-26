import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as path from 'path';
import { AuthModule } from './auth/auth.module';
import { AgentModule } from './agent/agent.module';
import { OcrModule } from './ocr/ocr.module';
import { McpModule } from './mcp/mcp.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [path.resolve(__dirname, '../.env')],
    }),
    AuthModule,
    AgentModule,
    OcrModule,
    McpModule,
  ],
})
export class AppModule {}
