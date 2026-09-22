import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { missingRequiredServiceUrls, serviceUrlFailFastHint } from '@web-system/shared';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  // 生产环境必需服务地址 fail-fast（specs/backend-consolidation §2.3 B4）：
  // dev/prod 的地址口径与本地不同（AUTH_SERVICE_URL：dev/prod=6001、本机=6101），
  // 静默走默认值会连错机器 —— 生产必须显式配，缺了直接拒绝启动。
  const missingServiceUrls = missingRequiredServiceUrls((key) => configService.get<string>(key));
  if (missingServiceUrls.length) {
    new Logger('Bootstrap').error(serviceUrlFailFastHint(missingServiceUrls));
    process.exit(1);
  }

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

  // CORS 配置
  app.enableCors({
    origin: configService.get('CORS_ORIGINS', ''),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Swagger 文档
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Todo Service API')
    .setDescription('Todo List 任务管理服务')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = configService.get('PORT', 6005);
  await app.listen(port);
  const logger = new Logger('TodoService');
  logger.log(`Todo Service is running on: http://localhost:${port}`);
  logger.log(`Swagger docs: http://localhost:${port}/docs`);
}

bootstrap();
