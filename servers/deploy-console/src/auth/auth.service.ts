import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

/**
 * 认证服务
 * 负责用户验证和 JWT 令牌生成
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * 验证用户凭据
   * 对比环境变量中的 ADMIN_USER 和 ADMIN_PASS
   */
  validateUser(username: string, password: string): boolean {
    const adminUser = this.configService.get<string>('ADMIN_USER') || 'admin';
    const adminPass = this.configService.get<string>('ADMIN_PASS') || 'deploy2026';
    return username === adminUser && password === adminPass;
  }

  /**
   * 登录，生成 JWT 令牌
   */
  async login(username: string) {
    const payload = { username, sub: username };
    const token = this.jwtService.sign(payload);
    return {
      token,
      user: {
        username,
        role: 'admin',
      },
    };
  }
}
