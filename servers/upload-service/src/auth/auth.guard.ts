import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';

/**
 * JWT 鉴权守卫
 *
 * 从 Authorization 头中提取 Bearer token，验证 JWT 签名（HS256）。
 * 使用与 auth-service 相同的 JWT_SECRET。
 */
@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      throw new UnauthorizedException('未提供认证令牌');
    }

    const [scheme, token] = authHeader.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('认证格式错误，需要 Bearer token');
    }

    try {
      const payload = this.verifyToken(token);
      request.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('认证令牌无效或已过期');
    }
  }

  /**
   * 简易 JWT 验证（不依赖 @nestjs/jwt，减少包依赖）
   * 若环境变量中有 JWT_SECRET，使用 HS256；否则记录警告
   */
  private verifyToken(token: string): any {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT structure');
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET 环境变量未设置，无法验证令牌');
    }

    // 验证签名
    const signaturePart = parts[2];
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${parts[0]}.${parts[1]}`)
      .digest('base64url');

    if (signaturePart !== expectedSignature) {
      throw new Error('Invalid signature');
    }

    // 解析 payload
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf-8'),
    );

    // 检查过期时间
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      throw new Error('Token expired');
    }

    return payload;
  }
}
