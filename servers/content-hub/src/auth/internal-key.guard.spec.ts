import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InternalKeyGuard } from './internal-key.guard';

const KEY = 'secret-key-64hex-for-test';

function makeContext(authorization?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: authorization ? { authorization } : {} }),
    }),
  } as unknown as ExecutionContext;
}

/** 只认 CONTENT_HUB_SERVICE_KEY（新名）的配置 */
function makeGuard(key: string): InternalKeyGuard {
  const config = { get: (k: string) => (k === 'CONTENT_HUB_SERVICE_KEY' ? key : '') };
  return new InternalKeyGuard(config as unknown as ConfigService);
}

describe('InternalKeyGuard', () => {
  it('Bearer 与 CONTENT_HUB_SERVICE_KEY 全等时放行', () => {
    expect(makeGuard(KEY).canActivate(makeContext(`Bearer ${KEY}`))).toBe(true);
  });

  it('token 不匹配时拒绝', () => {
    expect(() => makeGuard(KEY).canActivate(makeContext('Bearer wrong-key'))).toThrow(
      UnauthorizedException,
    );
  });

  it('缺少 Authorization 头时拒绝', () => {
    expect(() => makeGuard(KEY).canActivate(makeContext())).toThrow(UnauthorizedException);
  });

  it('非 Bearer 类型（如 Basic）拒绝', () => {
    expect(() => makeGuard(KEY).canActivate(makeContext('Basic abc'))).toThrow(
      UnauthorizedException,
    );
  });

  it('Bearer 后缺 token 时拒绝', () => {
    expect(() => makeGuard(KEY).canActivate(makeContext('Bearer'))).toThrow(UnauthorizedException);
  });

  it('key 未配置（空）时全部拒绝 —— 安全默认，不静默放行', () => {
    expect(() => makeGuard('').canActivate(makeContext(`Bearer ${KEY}`))).toThrow(
      UnauthorizedException,
    );
  });

  it('兼容旧名 FINNEWS_SERVICE_KEY', () => {
    const config = { get: (k: string) => (k === 'FINNEWS_SERVICE_KEY' ? KEY : '') };
    const guard = new InternalKeyGuard(config as unknown as ConfigService);
    expect(guard.canActivate(makeContext(`Bearer ${KEY}`))).toBe(true);
  });
});
