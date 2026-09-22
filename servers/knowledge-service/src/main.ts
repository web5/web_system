import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { UnifiedExceptionFilter } from './common/filters/unified-exception.filter';
import { missingRequiredServiceUrls, serviceUrlFailFastHint } from '@web-system/shared';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);
  // 生产环境必需服务地址 fail-fast（specs/backend-consolidation §2.3 B4）：
  // dev/prod 的地址口径与本地不同（AUTH_SERVICE_URL：dev/prod=6001、本机=6101），
  // 静默走默认值会连错机器 —— 生产必须显式配，缺了直接拒绝启动。
  const missingServiceUrls = missingRequiredServiceUrls((key) => configService.get<string>(key));
  if (missingServiceUrls.length) {
    new Logger('Bootstrap').error(serviceUrlFailFastHint(missingServiceUrls));
    process.exit(1);
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // 统一异常过滤器：{ code, message, data }
  app.useGlobalFilters(new UnifiedExceptionFilter());

  const corsOrigins = configService.get('CORS_ORIGINS', '');
  app.enableCors({
    origin: corsOrigins || false,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  // Swagger
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Knowledge Service API')
    .setDescription('RAG 知识服务：集合/文档管理、检索')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api-docs', app, document);

  const port = Number(process.env.PORT || 6011);
  await app.listen(port);
  const logger = new Logger('KnowledgeService');
  logger.log(`Knowledge Service running on: http://localhost:${port}`);
  logger.log(`Swagger docs: http://localhost:${port}/api-docs`);
}
bootstrap();
