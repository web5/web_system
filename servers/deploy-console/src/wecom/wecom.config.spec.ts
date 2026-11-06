import { resolveWecomConfig, WecomConfigError } from './wecom.config';

const valid = {
  WECOM_APPROVE_ENABLED: '1',
  WECOM_APPROVE_MODE: 'oauth',
  CONSOLE_PUBLIC_BASE_URL: 'https://dev.kedouai.com/console/',
  WECOM_CORP_ID: 'corp-id',
  WECOM_AGENT_ID: '1000002',
  WECOM_SECRET: 'secret',
  JWT_SECRET: 'jwt-secret',
  USER_SERVICE_URL: 'http://127.0.0.1:6002/',
  INTERNAL_API_KEY: 'internal-key',
};

describe('resolveWecomConfig（T2-a / V12 启动自检）', () => {
  it('开关关闭：立即早退，不读取也不校验任何其它键', () => {
    const cfg = resolveWecomConfig({ WECOM_APPROVE_ENABLED: '0' });
    expect(cfg.enabled).toBe(false);
    expect(cfg.corpId).toBe('');
    expect(cfg.publicBaseUrl).toBe('');
  });

  it('开关未配置（undefined）等同关闭', () => {
    expect(resolveWecomConfig({}).enabled).toBe(false);
  });

  it("只有严格 '1' 才启用，'true' 不启用", () => {
    expect(resolveWecomConfig({ ...valid, WECOM_APPROVE_ENABLED: 'true' }).enabled).toBe(false);
  });

  it('启用但缺 CONSOLE_PUBLIC_BASE_URL：拒绝启用（防 localhost 死链）', () => {
    expect(() => resolveWecomConfig({ ...valid, CONSOLE_PUBLIC_BASE_URL: '' })).toThrow(
      WecomConfigError,
    );
    expect(() => resolveWecomConfig({ ...valid, CONSOLE_PUBLIC_BASE_URL: '  ' })).toThrow(
      /CONSOLE_PUBLIC_BASE_URL/,
    );
  });

  it('oauth 缺任一企微凭证：拒绝启用', () => {
    expect(() => resolveWecomConfig({ ...valid, WECOM_SECRET: '' })).toThrow(/WECOM_SECRET/);
    expect(() => resolveWecomConfig({ ...valid, WECOM_CORP_ID: '' })).toThrow(/WECOM_CORP_ID/);
  });

  it('signed-link 缺 ticket secret：拒绝启用', () => {
    expect(() =>
      resolveWecomConfig({ ...valid, WECOM_APPROVE_MODE: 'signed-link', WECOM_APPROVE_TICKET_SECRET: '' }),
    ).toThrow(/WECOM_APPROVE_TICKET_SECRET/);
  });

  it('oauth 可用 JWT_SECRET 回退作 HMAC 密钥；两者都无则拒绝', () => {
    expect(resolveWecomConfig(valid).ticketSecret).toBe('jwt-secret');
    expect(() => resolveWecomConfig({ ...valid, JWT_SECRET: '' })).toThrow(/HMAC/);
  });

  it('正常配置：去尾斜杠、默认 TTL 900、user-service 去尾斜杠', () => {
    const cfg = resolveWecomConfig(valid);
    expect(cfg.enabled).toBe(true);
    expect(cfg.publicBaseUrl).toBe('https://dev.kedouai.com/console');
    expect(cfg.userServiceUrl).toBe('http://127.0.0.1:6002');
    expect(cfg.linkTtlSec).toBe(900);
    expect(cfg.internalApiKey).toBe('internal-key');
  });

  it('非法 TTL 回落 900，合法自定义生效', () => {
    expect(resolveWecomConfig({ ...valid, WECOM_LINK_TTL_SEC: 'abc' }).linkTtlSec).toBe(900);
    expect(resolveWecomConfig({ ...valid, WECOM_LINK_TTL_SEC: '120' }).linkTtlSec).toBe(120);
  });
});
