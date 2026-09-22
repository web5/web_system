import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { UnifiedExceptionFilter } from './common/filters/unified-exception.filter';
import * as path from 'path';
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

  // CORS — 从环境变量读取，禁止硬编码 *
  const corsOrigins = configService.get('CORS_ORIGINS', '');
  app.enableCors({
    origin: corsOrigins || false,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  // 静态资源服务 — AI 生成的图片通过 /uploads/ 访问
  app.useStaticAssets(path.join(process.cwd(), 'uploads'), {
    prefix: '/uploads',
  });

  // Swagger 文档
  const config = new DocumentBuilder()
    .setTitle('AI Service API')
    .setDescription('AI 对话服务 - 聊天 & 对话管理')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document);

  const port = process.env.PORT || 6003;
  await app.listen(port);
  const logger = new Logger('AIService');
  logger.log(`AI Service is running on: http://localhost:${port}`);
  logger.log(`Swagger docs: http://localhost:${port}/api-docs`);
}
bootstrap();
