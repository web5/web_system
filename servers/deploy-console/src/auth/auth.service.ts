import { Injectable, Logger, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

/**
 * 认证服务（IAM 一期 · T4）。
 *
 * 变更：登录**代理给 auth-service**，控制台不再持有口令、不再自签令牌。
 * 好处：账号、口令、角色、系统归属只有一处真相源；运维账号改密码 / 被禁用立即生效。
 *
 * 契约保持 `{ token, user }` 不变 —— 控制台前端无需改造即可继续工作。
 *
 * 逃生开关：`CONSOLE_ALLOW_LEGACY_LOGIN=1` 时回到 `.env` 的 `ADMIN_USER/ADMIN_PASS`
 * 自签（仅用于统一登录故障期间应急，事后必须关闭并排查）。
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {}

  private get authBase(): string {
    return (
      this.configService.get<string>('AUTH_SERVICE_URL') || 'http://127.0.0.1:6101'
    ).replace(/\/+$/, '');
  }

  /** 是否启用本地口令逃生通道 */
  private get legacyEnabled(): boolean {
    return (this.configService.get<string>('CONSOLE_ALLOW_LEGACY_LOGIN') ?? '') === '1';
  }

  /**
   * 登录：优先走 auth-service（system=deploy），失败或逃生开关开启时回落本地口令。
   */
  async login(
    username: string,
    password: string,
  ): Promise<{ token: string; user: { username: string; roles: string[]; systems?: string[] } }> {
    if (this.legacyEnabled && this.validateUser(username, password)) {
      this.logger.warn('⚠️ 使用本地口令逃生通道登录（CONSOLE_ALLOW_LEGACY_LOGIN=1），请尽快关闭');
      const token = this.jwtService.sign({
        username,
        sub: username,
        roles: ['admin'],
        systems: ['deploy'],
      });
      return { token, user: { username, roles: ['admin'], systems: ['deploy'] } };
    }

    let res: Response;
    try {
      res = await fetch(`${this.authBase}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, system: 'deploy' }),
        signal: AbortSignal.timeout(8000),
      });
    } catch (e) {
      this.logger.error(`调用 auth-service 登录失败: ${(e as Error).message}`);
      throw new UnauthorizedException('认证服务不可用，请稍后重试');
    }

    if (res.status === 403) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      throw new ForbiddenException(body?.message || '该账号不属于运维控制台');
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(
        `auth-service 登录失败: ${res.status} ${text.slice(0, 200)}（目标 ${this.authBase}）`,
      );
      throw new UnauthorizedException('用户名或密码错误');
    }

    const data = (await res.json()) as {
      accessToken: string;
      user?: { username?: string; roles?: string[] };
    };
    if (!data?.accessToken) {
      throw new UnauthorizedException('认证服务返回异常');
    }
    return {
      token: data.accessToken,
      user: {
        username: data.user?.username || username,
        roles: data.user?.roles || [],
      },
    };
  }

  /** 本地口令校验（仅逃生通道使用） */
  validateUser(username: string, password: string): boolean {
    const adminUser = this.configService.get<string>('ADMIN_USER') || 'admin';
    const adminPass = this.configService.get<string>('ADMIN_PASS');
    return !!adminPass && username === adminUser && password === adminPass;
  }
}
