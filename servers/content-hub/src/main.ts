import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);

  app.useBodyParser('json', { limit: '10mb' });

  /**
   * 全局校验管道 —— DTO 上的 class-validator 装饰器必须挂上管道才生效，
   * 不挂的话 `class ArxivDigestBatchDto` 只是一层类型提示，运行时不做任何校验。
   *
   * whitelist + forbidNonWhitelisted：拒绝未声明字段，避免调用方误传
   * 拼错的参数（如 `abstract` 写成 `abstrct`）被静默忽略 —— 静默忽略是
   * 「幻觉判定失效但没人发现」这类问题的典型来源。
   */
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const corsOrigins = configService.get('CORS_ORIGINS', '');
  app.enableCors({
    origin: corsOrigins ? corsOrigins.split(',') : false,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  const port = Number(process.env.PORT ?? 6007);
  await app.listen(port);
  const logger = new Logger('ContentHub');
  logger.log(`ContentHub service running on: http://localhost:${port}`);
  logger.log(`财经 API: http://localhost:${port}/api/topics`);
}
bootstrap();
