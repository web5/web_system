import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * JWT 策略
 * 从 Bearer Token 中解析并验证用户信息
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') || 'deploy-console-secret-key-change-in-production',
    });
  }

  /**
   * 验证 JWT payload，返回用户信息
   */
  async validate(payload: any) {
    if (!payload.username) {
      throw new UnauthorizedException('无效的令牌');
    }
    return { username: payload.username, role: 'admin' };
  }
}
