import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * 内容中枢鉴权模块。
 *
 * 只注册 JwtModule + JwtAuthGuard，**不注册全局 APP_GUARD** ——
 * 内容中枢同时承载两类接口：
 *   · FinnewsController（/api/papers、/api/topics…）→ 服务间 service key，不鉴权
 *   · ContentController / ContentQualityController（/api/content/*）→ 运营后台，用 @UseGuards(JwtAuthGuard)
 * 全局 guard 会把前者也拦下来，破坏 MCP 链路。
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
      }),
    }),
  ],
  providers: [JwtAuthGuard],
  exports: [JwtAuthGuard, JwtModule],
})
export class ContentAuthModule {}
