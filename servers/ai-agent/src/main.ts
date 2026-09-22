import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { UnifiedExceptionFilter } from './common/filters/unified-exception.filter';
import { json, urlencoded } from 'body-parser';
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

  // 请求体大小限制：默认 100kb 太小，OCR 图片 base64 几 MB 必超
  // 提升到 20mb 以容纳 OCR 拍照识别（base64 图片 ~1.3x 原图大小）
  app.use(json({ limit: '20mb' }));
  app.use(urlencoded({ limit: '20mb', extended: true }));

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
