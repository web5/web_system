import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ProxyModule } from './proxy/proxy.module';
import { AuthModule } from './auth/auth.module';
import { StaticModule } from './static/static.module';

@Module({
  imports: [
    // 配置模块
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    // 代理模块 - 转发请求到后台服务
    ProxyModule,
    // 认证模块 - JWT 验证
    AuthModule,
    // 静态资源模块
    StaticModule,
  ],
})
export class AppModule {}
