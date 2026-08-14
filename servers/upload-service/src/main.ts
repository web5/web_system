import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as path from 'path';
import * as fs from 'fs';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);

  // 全局异常过滤器
  app.useGlobalFilters(new AllExceptionsFilter());

  // 全局验证管道
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // CORS — 从环境变量读取，禁止硬编码 * 或无参 enableCors
  const corsOrigins = configService.get('CORS_ORIGINS', '');
  app.enableCors({
    origin: corsOrigins || false,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  });

  // 确保上传根目录存在
  const uploadsRoot = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsRoot)) {
    fs.mkdirSync(uploadsRoot, { recursive: true });
  }

  // 静态文件服务（提供上传文件的访问）
  app.useStaticAssets(uploadsRoot, {
    prefix: '/uploads',
  });

  // Swagger 文档
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Upload Service API')
    .setDescription('公共文件上传服务 — 支持头像、画板、变变等场景')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = process.env.PORT || 6008;

  // JWT_SECRET 启动时校验
  if (!process.env.JWT_SECRET) {
    const logger = new Logger('UploadService');
    logger.error('JWT_SECRET 环境变量未设置，拒绝启动');
    process.exit(1);
  }

  await app.listen(port);
  const logger = new Logger('UploadService');
  logger.log(`Upload Service is running on: http://localhost:${port}`);
  logger.log(`Swagger docs: http://localhost:${port}/docs`);
}
bootstrap();
