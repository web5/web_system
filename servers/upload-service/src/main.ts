import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as path from 'path';
import * as fs from 'fs';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

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

  // CORS
  app.enableCors();

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

  const port = process.env.PORT || 3006;
  await app.listen(port);
  console.log(
    `[Upload Service] Upload Service is running on: http://localhost:${port}`,
  );
  console.log(
    `[Upload Service] Swagger docs: http://localhost:${port}/docs`,
  );
}
bootstrap();
