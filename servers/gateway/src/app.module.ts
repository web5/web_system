import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ProxyModule } from './proxy/proxy.module';
import { AuthModule } from './auth/auth.module';
import { StaticModule } from './static/static.module';
import { SpaModule } from './spa/spa.module';
import { HealthModule } from './health/health.module';
import { SwaggerDocsModule } from './swagger-docs/swagger-docs.module';
import { ApiDocsModule } from './api-docs/api-docs.module';

@Module({
  imports: [
    // 配置模块
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    // 心跳检测
    HealthModule,
    // 代理模块 - 转发请求到后台服务
    ProxyModule,
    // 认证模块 - JWT 验证
    AuthModule,
    // 静态资源模块
    StaticModule,
    // SPA 回退 - 必须在 StaticModule 之后
    SpaModule,
    // Swagger 文档聚合
    SwaggerDocsModule,
    // 统一 API 文档（展示所有业务接口 + 代理转发）
    ApiDocsModule,
  ],
})
export class AppModule {}
