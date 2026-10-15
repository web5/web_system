import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json } from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import { runBootstrap } from './bootstrap/load';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  // ── 阶段 0/1：自举（两阶段启动，设计 §3.6）────────────────────────────
  // 必须在 AppModule **求值之前**完成：ConfigModule 与 TypeORM 都在 import 期或
  // 模块装饰器里读 env，静态 import 会让它们读到「还没合并配置中心」的旧值。
  // 故 AppModule 改为下面的动态 import —— 这不是风格偏好，是顺序依赖。
  await runBootstrap();

  const { AppModule } = await import('./app.module');

  // rawBody：CI/CD 触发端点需用**原始请求体**做 HMAC 验签
  // （重新序列化 JSON 会因键顺序/空白差异导致签名永远不匹配）
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const configService = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // 读取端口配置，默认 6200
  const port = configService.get<number>('PORT') || 6200;
  const isProduction = configService.get<string>('NODE_ENV') === 'production';

  // 启用 CORS（来源白名单来自环境变量 CORS_ORIGINS，禁止 origin:'*' / origin:true）
  const corsOrigins = (configService.get<string>('CORS_ORIGINS', '') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.use(
    cors({
      origin: corsOrigins.length ? corsOrigins : false,
      credentials: true,
    }),
  );

  // 安全头
  app.use(helmet());

  // 压缩响应
  app.use(compression());

  // 全局前缀 /api；排除 /health —— 探活需与其它服务一致的裸路径
  // （否则端点变成 /api/health，流水线 verify 与监控探活都要各写一套）
  app.setGlobalPrefix('api', { exclude: ['health'] });

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

  // 全局异常过滤器（铁律：每个微服务必须注册，未捕获异常统一结构化返回）
  app.useGlobalFilters(new AllExceptionsFilter());

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

bootstrap().catch((e: unknown) => {
  // 启动失败必须**非 0 退出**且只留一条错误：pm2 依退出码判定要不要重试，
  // 堆栈打两遍会让日志里分不清「启动失败」还是「运行中崩了」。
  // 自举缺键的修复指引由 runBootstrap 打印在前面，这里不再重复。
  new Logger('Bootstrap').error(`console 启动失败：${(e as Error)?.message || e}`);
  process.exit(1);
});
