import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from './jwt-auth.guard';
import { InternalKeyGuard } from './internal-key.guard';

/**
 * 内容中枢鉴权模块。
 *
 * 注册 JwtModule + JwtAuthGuard + InternalKeyGuard，**不注册全局 APP_GUARD** ——
 * 内容中枢同时承载两类接口，鉴权口径不同，混在一个全局 guard 里会互相打断：
 *   · FinnewsController / InstitutionController / wechat / lhb → 服务间直连，
 *     用 `@UseGuards(InternalKeyGuard)` 校验 Bearer <CONTENT_HUB_SERVICE_KEY>
 *   · ContentController / ContentQualityController 的管理接口 → 运营后台，
 *     用 `@UseGuards(JwtAuthGuard)` 校验 admin 用户 JWT
 * 两类都不全局挂载，由各 controller / 方法按需声明。
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
  providers: [JwtAuthGuard, InternalKeyGuard],
  exports: [JwtAuthGuard, JwtModule, InternalKeyGuard],
})
export class ContentAuthModule {}
