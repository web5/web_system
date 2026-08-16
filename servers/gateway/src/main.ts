import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { IndexHtmlService } from './deploy-version/index-html.service';
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
  const indexHtmlService = app.get(IndexHtmlService);

  // 版本化 index.html：读取 public/<pub>/index.html，注入当前环境/版本元信息（供未来灰度扩展）
  const sendIndex = async (pub: string, req: any, res: any) => {
    try {
      const html = await indexHtmlService.render(pub, req);
      res.setHeader('Cache-Control', 'no-cache');
      return res.type('html').send(html);
    } catch (e) {
      logger.error(`注入 index.html 失败(${pub}): ${e.message}`);
      return res.sendFile(join(__dirname, '..', 'public', pub, 'index.html'));
    }
  };

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
  // 注意：仅对带 content hash 的 /assets/* 设强缓存（内容变了文件名就变）
  // index.html 不设强缓存，依赖 etag 做条件请求，保证部署后能拿到最新 JS/CSS 路径
  app.use((req: any, res: any, next: () => void) => {
    if (req.method !== 'GET') return next();
    const path: string = req.path;
    // Vite 打包的 assets 都是带 hash 的文件，强缓存 1 年（覆盖根级与前缀级）
    if (path.startsWith('/assets/') || /^\/(portal|admin|mcp-admin)\/assets\//.test(path)) {
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

  // SPA 回退中间件 - 微前端模式：
  // / → shell（基座 index.html，注入模块清单）
  // /console/* → deploy-console（独立 SPA，不微前端化）
  // /admin/* /mcp-admin/* → 由基座路由处理（不再 gateway serve）
  // 模块 js/css 走 nginx /static/modules/，不经 gateway
  app.use(async (req: any, res: any, next: () => void) => {
    if (req.method !== 'GET') return next();
    const path: string = req.path;

    if (path.startsWith('/api') || path.startsWith('/docs') || path.startsWith('/swagger') || path.startsWith('/mini-scan') || path.startsWith('/health') || path.startsWith('/materials') || path.startsWith('/__version__') || path.startsWith('/__manifest__')) {
      return next();
    }

    // 基座静态资源（带扩展名）走 ServeStatic（public/shell/assets/*）
    if (extname(path)) {
      return next();
    }

    // deploy-console 独立 SPA
    if (path === '/console' || path.startsWith('/console/')) {
      return sendIndex('console', req, res);
    }

    // 根路径 → 基座 shell
    if (path === '/') {
      return sendIndex('shell', req, res);
    }

    // 其它路径（/login, /portal/*, /admin/*, /mcp-admin/* 等）→ 基座 shell 路由处理
    // 基座 router 会按 /:module/* 匹配并挂载对应微前端模块
    return sendIndex('shell', req, res);
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
