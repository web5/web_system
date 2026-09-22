import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
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
  const logger = new Logger('SystemService');

  // 全局异常过滤器
  app.useGlobalFilters(new AllExceptionsFilter());

  // 全局验证管道
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // CORS — 从环境变量读取，禁止硬编码 *
  const corsOrigins = configService.get('CORS_ORIGINS', '');
  app.enableCors({ origin: corsOrigins || false });

  // Swagger 文档
  const swaggerConfig = new DocumentBuilder()
    .setTitle('System Service API')
    .setDescription('系统服务 — 配置管理、操作日志、变变素材管理')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  await app.listen(process.env.PORT || 6004);
  logger.log(`System Service running on port ${process.env.PORT || 6004}`);
  logger.log(`Swagger docs: http://localhost:${process.env.PORT || 6004}/docs`);
}
bootstrap();
