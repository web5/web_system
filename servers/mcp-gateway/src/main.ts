import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // MCP 请求 body 可能较大
    bodyParser: true,
  });
  const configService = app.get(ConfigService);

  // 调大 JSON body 限制（MCP 工具调用可能携带大参数）
  app.useBodyParser('json', { limit: '10mb' });

  // CORS
  const corsOrigins = configService.get('CORS_ORIGINS', '');
  app.enableCors({
    origin: corsOrigins ? corsOrigins.split(',') : false,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'MCP-Session-Id'],
  });

  const port = Number(process.env.PORT ?? 6006);
  await app.listen(port);
  const logger = new Logger('McpGateway');
  logger.log(`MCP Gateway running on: http://localhost:${port}`);
  logger.log(`MCP endpoint: http://localhost:${port}/mcp`);
  logger.log(`Admin API:   http://localhost:${port}/api/modules`);
}
bootstrap();
