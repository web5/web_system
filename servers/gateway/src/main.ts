import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { join, extname } from 'path';
import compression from 'compression';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);
  const logger = new Logger('Gateway');

  const port = configService.get('PORT', 6000);
  const host = configService.get('HOST', '0.0.0.0');
  const corsOrigins = configService.get('CORS_ORIGINS', '');
  const publicUrl = configService.get('PUBLIC_URL', '');

  // 安全头（X-Frame-Options, X-Content-Type-Options, HSTS 等）
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        connectSrc: ["'self'", 'https://api.kedouai.com'],
      },
    },
  }));

  // CORS 配置
  app.enableCors({
    origin: corsOrigins === '*' ? true : corsOrigins.split(','),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  });

  // Gzip 压缩中间件 — 提升 JS/CSS/JSON 传输速度（通常压缩率 70%+）
  // SSE 流式响应跳过压缩，否则会破坏流式数据
  app.use(
    compression({
      level: 6,
      threshold: 256,
      filter: (req, res) => {
        if (req.headers['x-no-compression']) return false;
        // SSE 流不压缩
        const ct = (res.getHeader('Content-Type') as string) || '';
        if (ct.startsWith('text/event-stream')) return false;
        // 不压缩图片（已压缩过，浪费 CPU）
        if (/image\/(png|jpg|jpeg|gif|webp)/.test(ct)) return false;
        return compression.filter(req, res);
      },
    }),
  );

  // 静态资源强缓存中间件
  // 注意：仅对 /assets/* 设强缓存（带 content hash，内容变了文件名就变）
  // index.html 不设强缓存，依赖 etag 做条件请求，保证部署后能拿到最新 JS/CSS 路径
  app.use((req: any, res: any, next: () => void) => {
    if (req.method !== 'GET') return next();
    const path: string = req.path;
    // Vite 打包的 /assets/* 都是带 hash 的文件，强缓存 1 年
    if (path.startsWith('/assets/')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
    next();
  });

  // 请求日志中间件 — 记录每个请求的方法、路径、状态码和耗时
  app.use((req: any, res: any, next: () => void) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.log(`${req.method} ${req.path} → ${res.statusCode} (${duration}ms)`);
    });
    next();
  });

  // SPA 回退中间件 - 处理前端路由回退
  // API/文档路由跳过
  app.use((req: any, res: any, next: () => void) => {
    if (req.method !== 'GET') return next();
    const path: string = req.path;

    if (path.startsWith('/api') || path.startsWith('/docs') || path.startsWith('/swagger') || path.startsWith('/mini-scan') || path.startsWith('/health') || path.startsWith('/materials')) {
      return next();
    }
    // 有扩展名的静态资源跳过（由 ServeStaticModule 处理）
    if (extname(path)) {
      return next();
    }
    // 管理后台 SPA 回退
    if (path.startsWith('/admin')) {
      return res.sendFile(join(__dirname, '..', 'public', 'admin', 'index.html'));
    }
    // MCP 管理界面 SPA 回退（和 admin 一致，走 gateway serve-static 托管）
    if (path === '/mcp-admin' || path.startsWith('/mcp-admin/')) {
      return res.sendFile(join(__dirname, '..', 'public', 'mcp-admin', 'index.html'));
    }
    // 根路径 → 重定向到 /portal/
    if (path === '/') {
      return res.redirect(301, '/portal/');
    }
    // Portal SPA 回退：仅 /portal/ 开头的路径（或 /portal 不带斜杠）
    // 不在 /portal/ 下的路径不返回 Portal HTML，由 NestJS 自行 404
    if (path === '/portal' || path.startsWith('/portal/')) {
      return res.sendFile(join(__dirname, '..', 'public', 'portal', 'index.html'));
    }
    // 其他未匹配路径交给 NestJS 处理（404 或后续路由）
    next();
  });

  // 全局异常过滤器 — 生产环境掩码内部错误信息
  app.useGlobalFilters(new AllExceptionsFilter());

  // 统一响应格式 { code, data, message }
  app.useGlobalInterceptors(new TransformInterceptor());

  // 网关自身 Swagger 文档
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Gateway API')
    .setDescription('API 网关 - 健康检查 & 路由代理')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  await app.listen(port, host);
  logger.log(`Gateway is running on: http://${host === '0.0.0.0' ? '0.0.0.0' : 'localhost'}:${port}`);
  logger.log(`Swagger docs: http://localhost:${port}/docs`);
  logger.log(`全部服务文档: http://localhost:${port}/swagger`);
  if (publicUrl) {
    logger.log(`Public access: ${publicUrl}`);
  }
}

bootstrap();
