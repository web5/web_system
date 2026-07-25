import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { join, extname } from 'path';
import compression from 'compression';
import { createProxyMiddleware } from 'http-proxy-middleware';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);

  const port = configService.get('PORT', 3000);
  const host = configService.get('HOST', '0.0.0.0');
  const corsOrigins = configService.get('CORS_ORIGINS', '*');
  const publicUrl = configService.get('PUBLIC_URL', '');

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

  // 上传文件静态资源代理（/uploads/* → user-service）
  // 注意：必须在 SPA 回退中间件之前注册
  const userServiceUrl = configService.get('USER_SERVICE_URL', 'http://localhost:3002');
  app.use(
    '/uploads',
    createProxyMiddleware({
      target: userServiceUrl,
      changeOrigin: true,
      timeout: 10000,
    }),
  );

  // /mini-scan — 微信原生扫码器扫描 QR 码后的处理
  // 用户用微信"扫一扫"扫描登录二维码时，此 URL 会在微信内置浏览器中打开
  // 此处重定向到微信 OAuth 授权，完成登录后确认 ticket，PC 端轮询获取 token
  app.use((req: any, res: any, next: () => void) => {
    if (req.method !== 'GET') return next();
    const path: string = req.path;

    if (path.startsWith('/mini-scan')) {
      const ticket = typeof req.query.ticket === 'string' ? req.query.ticket : '';
      if (!ticket) return res.redirect('/');
      // 重定向到微信 OAuth，将 ticket 编码到 redirect URL 中
      const redirectUrl = `/api/auth/wechat/authorize?redirect=${encodeURIComponent('/?mini_scan_ticket=' + ticket)}`;
      return res.redirect(redirectUrl);
    }

    // SPA 回退中间件 - 处理前端路由回退
    // API/文档路由跳过
    if (path.startsWith('/api') || path.startsWith('/docs') || path.startsWith('/swagger')) {
      return next();
    }
    // 有扩展名的静态资源跳过（由 ServeStaticModule 处理）
    if (extname(path)) {
      return next();
    }
    // 管理后台 SPA 回退
    if (path.startsWith('/admin') || path === '') {
      return res.sendFile(join(__dirname, '..', 'public', 'admin', 'index.html'));
    }
    // Portal SPA 回退
    res.sendFile(join(__dirname, '..', 'public', 'index.html'));
  });

  // 网关自身 Swagger 文档
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Gateway API')
    .setDescription('API 网关 - 健康检查 & 路由代理')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  await app.listen(port, host);
  console.log(`[Gateway] Gateway is running on: http://${host === '0.0.0.0' ? '0.0.0.0' : 'localhost'}:${port}`);
  console.log(`[Gateway] Swagger docs: http://localhost:${port}/docs`);
  console.log(`[Gateway] 全部服务文档: http://localhost:${port}/swagger`);
  if (publicUrl) {
    console.log(`[Gateway] Public access: ${publicUrl}`);
  }
}

bootstrap();
