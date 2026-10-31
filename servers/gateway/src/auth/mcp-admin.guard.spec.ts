/**
 * 回归锁：MCP 管理端点的 admin 鉴权（fix/mcp-admin-auth-mask）
 *
 * 事故现象（2026-10-31 实测，prod + dev 都有）：
 *   `GET https://kedouai.com/api/mcp/modules` → **200**，无任何凭证就拿到全部模块定义
 *   （含 base_url / auth_type / auth_config 明文）；`POST /api/mcp/debug` → 201 且真的按调用方
 *   给的 URL 发请求。成因：ProxyController 整体 @Public()（认证交给各微服务），
 *   而 mcp-gateway 的 AdminController **一处鉴权都没有**。
 *
 * 本 spec 锁两层：
 *   ① 判据本身 —— 无 token / 验签失败 / refresh token / 非 admin 系统的四道分支；
 *   ② 接线 —— 守卫真的挂在那两条 /api/mcp* 路由上，「挂上了但 Nest 解析不到实例」是
 *      @UseGuards(Class) 最经典的静默失效（Nest 找不到 injectable 时是把守卫 filter 掉，
 *      不报错 → 看起来加了、其实没有）。故用守卫元数据做断言，且反向断言其余 /api/* 未被波及。
 */
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { McpAdminGuard } from './mcp-admin.guard';
import { ProxyController } from '../proxy/proxy.controller';

function makeGuardWithReq(authorization?: string, payload?: any, error?: Error) {
  const jwtService = {
    verifyAsync: jest.fn(async () => {
      if (error) throw error;
      return payload;
    }),
  };
  const req: any = { headers: authorization ? { authorization } : {} };
  const context: any = { switchToHttp: () => ({ getRequest: () => req }) };
  return { guard: new McpAdminGuard(jwtService as any), context, jwtService, req };
}

const ADMIN_PAYLOAD = { sub: 1, username: 'admin', type: 'access', systems: ['admin'] };

describe('McpAdminGuard 判据（与 content-hub JwtAuthGuard 同口径）', () => {
  it('V1 无 Authorization → 401「缺少登录凭证」，且不验签', async () => {
    const { guard, context, jwtService } = makeGuardWithReq(undefined);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guard.canActivate(context)).rejects.toThrow('缺少登录凭证');
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('V1b 非 Bearer 方案（如 Basic）→ 401「缺少登录凭证」', async () => {
    const { guard, context } = makeGuardWithReq('Basic YWRtaW46YWRtaW4=');
    await expect(guard.canActivate(context)).rejects.toThrow('缺少登录凭证');
  });

  it('V2 验签失败（伪造/过期）→ 401「登录凭证无效或已过期」', async () => {
    const { guard, context } = makeGuardWithReq('Bearer bad.token', undefined, new Error('jwt expired'));
    await expect(guard.canActivate(context)).rejects.toThrow('登录凭证无效或已过期');
  });

  it('V3 refresh token 当 access token 用 → 401「令牌类型不正确」', async () => {
    const { guard, context } = makeGuardWithReq('Bearer refresh.token', {
      sub: 1,
      type: 'refresh',
      systems: ['admin'],
    });
    await expect(guard.canActivate(context)).rejects.toThrow('令牌类型不正确');
  });

  it('V4 C 端 portal 账号（systems 不含 admin）→ 403，不是 401', async () => {
    const { guard, context } = makeGuardWithReq('Bearer portal.token', {
      sub: 9,
      type: 'access',
      systems: ['portal'],
    });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(context)).rejects.toThrow('该账号不属于运营后台（admin）');
  });

  it('V4b systems 缺失 / 非数组 → 403（不得当成 admin 放过）', async () => {
    for (const systems of [undefined, null, 'admin', [], ['deploy']]) {
      const { guard, context } = makeGuardWithReq('Bearer t', { sub: 9, type: 'access', systems });
      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('V5 admin access token → 放行，并把 payload 挂到 req.user（供下游/日志用）', async () => {
    const { guard, context, req } = makeGuardWithReq('Bearer good.token', ADMIN_PAYLOAD);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.user).toEqual(ADMIN_PAYLOAD);
  });

  it('V6 老 token 没有 type 字段 → 仍放行（只拦「明确不是 access」的）', async () => {
    const { guard, context } = makeGuardWithReq('Bearer old.token', { sub: 1, systems: ['admin'] });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('V7 跨系统账号（admin + deploy）→ 放行', async () => {
    const { guard, context } = makeGuardWithReq('Bearer t', {
      sub: 1,
      type: 'access',
      systems: ['deploy', 'admin'],
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});

describe('McpAdminGuard 接线（防「加了等于没加」）', () => {
  const proto = ProxyController.prototype as Record<string, any>;
  const guardOf = (handler: string) =>
    (Reflect.getMetadata(GUARDS_METADATA, proto[handler]) || []).map((g: any) => g?.name ?? g);

  it('V8 两条 /api/mcp* 路由都挂了 McpAdminGuard', () => {
    expect(guardOf('proxyMcpExact')).toContain('McpAdminGuard');
    expect(guardOf('proxyMcpWildcard')).toContain('McpAdminGuard');
  });

  it('V9 其余 /api/* 代理路由一条都没被波及（守卫只认 mcp）', () => {
    const others = Object.getOwnPropertyNames(proto).filter(
      (n) => n.startsWith('proxy') && !n.includes('Mcp') && typeof proto[n] === 'function',
    );
    expect(others.length).toBeGreaterThan(10); // 兜底：别因为改名导致这条断言空转
    for (const name of others) {
      expect(guardOf(name)).not.toContain('McpAdminGuard');
    }
  });

  it('V10 守卫没有提到 class 级（否则 /api/* 全锁死）', () => {
    const classGuards = (Reflect.getMetadata(GUARDS_METADATA, ProxyController) || []).map(
      (g: any) => g?.name ?? g,
    );
    expect(classGuards).not.toContain('McpAdminGuard');
    // 既有行为不变：class 级仍只有 TokenBlacklistGuard
    expect(classGuards).toContain('TokenBlacklistGuard');
  });
});
