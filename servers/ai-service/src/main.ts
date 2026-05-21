import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 全局验证管道
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // 启用 CORS
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  // Swagger 文档
  const config = new DocumentBuilder()
    .setTitle('AI Service API')
    .setDescription('AI 对话服务接口文档')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.setup('api-docs', app, config);

  const port = process.env.PORT || 3003;
  await app.listen(port);
  console.log(`AI Service is running on: http://localhost:${port}`);
  console.log(`Swagger docs: http://localhost:${port}/api-docs`);
}
bootstrap();
