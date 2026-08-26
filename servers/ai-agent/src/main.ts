import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { UnifiedExceptionFilter } from './common/filters/unified-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);

  // 全局验证管道
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // 全局异常过滤器：统一响应格式 { code, message, data }
  app.useGlobalFilters(new UnifiedExceptionFilter());

  // CORS — 从环境变量读取，禁止硬编码 *
  const corsOrigins = configService.get('CORS_ORIGINS', '');
  app.enableCors({
    origin: corsOrigins || false,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  // Swagger 文档
  const swaggerConfig = new DocumentBuilder()
    .setTitle('AI Agent Service API')
    .setDescription('AI Agent 编排服务 - 统一承载 AI 分析/编排能力（合同风险识别等）')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api-docs', app, document);

  const port = configService.get<number>('PORT', 6010);
  await app.listen(port);
  const logger = new Logger('AIAgentService');
  logger.log(`AI Agent Service is running on: http://localhost:${port}`);
  logger.log(`Swagger docs: http://localhost:${port}/api-docs`);
}
bootstrap();
