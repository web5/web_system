import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

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
