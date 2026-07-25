import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { ProxyModule } from './proxy/proxy.module';
import { AuthModule } from './auth/auth.module';
import { StaticModule } from './static/static.module';
import { HealthModule } from './health/health.module';
import { SwaggerDocsModule } from './swagger-docs/swagger-docs.module';
import { ApiDocsModule } from './api-docs/api-docs.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    // 全局限流：每 IP 每分钟最多 100 次请求
    ThrottlerModule.forRoot([{
      ttl: 60_000,       // 时间窗口 60 秒
      limit: 100,        // 窗口内最多 100 次请求
    }]),
    HealthModule,
    ProxyModule,
    AuthModule,
    StaticModule,
    SwaggerDocsModule,
    ApiDocsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
