import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException, ForbiddenException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hasSystem } from '@web-system/shared';

/**
 * JWT 策略（IAM 一期 · T4）。
 *
 * 变更：由「console 自签、只认自己那一个口令」改为**校验 auth-service 签发的统一 JWT**。
 * 因此：
 *  - 密钥**必须**是 `JWT_SECRET`，与 auth-service / gateway 同源，缺失即抛错（V6）；
 *  - 不再有 `'deploy-console-secret-key-change-in-production'` 兜底 —— 那个兜底意味着
 *    任何人都能伪造 token；
 *  - `role` 不再硬编码为 admin，改由 payload 的 roles 推导；
 *  - 必须属于 `deploy` 系统才能进控制台（C 端/纯运营账号被挡在门外）。
 *
 * 逃生开关：环境变量 `CONSOLE_ALLOW_LEGACY_LOGIN=1` 时，仍允许用 `.env` 口令登录
 * （见 AuthService）。默认关闭 —— 只在统一登录出问题时临时开启，问题解决后必须关掉。
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(configService: ConfigService) {
    const secret = configService.get<string>('JWT_SECRET');
    if (!secret) {
      // 启动即失败：宁可起不来，也不能悄悄用一个大家都知道的默认密钥
      throw new Error(
        'deploy-console 缺少 JWT_SECRET（IAM 一期：与 auth-service 同源校验统一令牌，不再使用内置默认密钥）',
      );
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  /**
   * 验证 JWT payload。
   * auth-service 签发的 payload：{ sub, username, roles, systems, type }
   */
  async validate(payload: any) {
    if (!payload?.username) {
      throw new UnauthorizedException('无效的令牌');
    }
    // refresh token 不能当 access token 用
    if (payload.type && payload.type !== 'access') {
      throw new UnauthorizedException('令牌类型不正确');
    }
    const systems: string[] = Array.isArray(payload.systems) ? payload.systems : [];
    if (!hasSystem({ systems }, 'deploy')) {
      this.logger.warn(`拒绝非运维系统账号访问控制台: ${payload.username} systems=${JSON.stringify(systems)}`);
      throw new ForbiddenException('该账号不属于运维控制台（deploy）');
    }
    const roles: string[] = Array.isArray(payload.roles) ? payload.roles : [];
    return {
      username: payload.username,
      sub: payload.sub,
      roles,
      systems,
      role: roles.includes('super_admin') ? 'super_admin' : 'admin',
    };
  }
}
