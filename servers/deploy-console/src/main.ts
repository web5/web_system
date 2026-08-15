import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json } from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // 读取端口配置，默认 6200
  const port = configService.get<number>('PORT') || 6200;
  const isProduction = configService.get<string>('NODE_ENV') === 'production';

  // 启用 CORS（允许所有来源）
  app.use(cors({ origin: true, credentials: true }));

  // 安全头
  app.use(helmet());

  // 压缩响应
  app.use(compression());

  // 全局前缀 /api
  app.setGlobalPrefix('api');

  // 请求体解析（支持 SSE 需要较大限制）
  app.use(json({ limit: '10mb' }));

  // 全局验证管道
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  // Swagger 文档只在非 production 环境启用
  if (!isProduction) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('部署控制台 API')
      .setDescription('部署控制台后端接口文档')
      .setVersion('1.0.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
    logger.log('Swagger 文档已启用: /api/docs');
  }

  await app.listen(port);
  logger.log(`服务已启动，监听端口: ${port}`);
}

bootstrap();
