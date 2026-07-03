import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { join, extname } from 'path';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
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
  console.log(`🚀 Gateway is running on: http://${host === '0.0.0.0' ? '0.0.0.0' : 'localhost'}:${port}`);
  console.log(`📚 Swagger docs: http://localhost:${port}/docs`);
  console.log(`📋 全部服务文档: http://localhost:${port}/swagger`);
  if (publicUrl) {
    console.log(`🌐 Public access: ${publicUrl}`);
  }
}

bootstrap();
