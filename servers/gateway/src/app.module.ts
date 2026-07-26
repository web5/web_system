import { Module, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { ProxyModule } from './proxy/proxy.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/auth.guard';
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
    // 重要：Guard 顺序决定了执行顺序，先全局鉴权再限流
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements OnModuleInit {
  private readonly logger = new Logger(AppModule.name);

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const jwtSecret = this.configService.get('JWT_SECRET', '');
    if (!jwtSecret || jwtSecret === 'change_me_in_dev') {
      this.logger.error(
        'JWT_SECRET 未设置或为默认值，将拒绝启动！请在 .env 中设置安全的 JWT_SECRET。',
      );
      process.exit(1);
    }
    this.logger.log('JWT_SECRET 校验通过');
  }
}
