import { createHmac } from 'node:crypto';
import {
  DEFAULT_RUN_TOKEN_TTL_SEC,
  RUN_TOKEN_PREFIX,
  __clearRevokedForTest,
  describeVerifyFailure,
  issueRunToken,
  looksLikeRunToken,
  revokeRunTokens,
  revokeRunToken,
  verifyRunToken,
} from './run-token';

const SECRET = 'run-token-test-secret-0123456789';

/** 手工构造令牌（测「过期」「畸形」这类正常路径签不出来的载荷） */
function craft(claims: Record<string, unknown>, opts?: { secret?: string; raw?: string }): string {
  if (opts?.raw !== undefined) return opts.raw;
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64(claims);
  const sig = createHmac('sha256', opts?.secret ?? SECRET)
    .update(`${head}.${body}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${RUN_TOKEN_PREFIX}${head}.${body}.${sig}`;
}

describe('run 短期令牌（流水线脚本凭据）', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.RUN_TOKEN_SECRET = SECRET;
    __clearRevokedForTest();
  });
  afterEach(() => {
    process.env = { ...saved };
    __clearRevokedForTest();
  });

  it('无签名密钥 → 签发返回 null（调用方回落静态 key，不阻断发布）', () => {
    delete process.env.RUN_TOKEN_SECRET;
    delete process.env.CONFIG_MASTER_KEY;
    delete process.env.JWT_SECRET;
    expect(issueRunToken({ runId: 'r1', env: 'prod', moduleKey: 'portal' })).toBeNull();
  });

  it('签发 → 校验通过，且载荷带 runId/env/moduleKey', () => {
    const issued = issueRunToken({ runId: 'run-42', env: 'prod', moduleKey: 'portal' });
    expect(issued).not.toBeNull();
    expect(issued!.token.startsWith(RUN_TOKEN_PREFIX)).toBe(true);
    const v = verifyRunToken(issued!.token);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.claims.runId).toBe('run-42');
    expect(v.claims.env).toBe('prod');
    expect(v.claims.moduleKey).toBe('portal');
    expect(v.claims.jti).toBe(issued!.jti);
    // 默认 TTL 2h：既不能短到跑不完一次发布，也不能长到泄露后敞开一整天
    expect(v.claims.exp - v.claims.iat).toBe(DEFAULT_RUN_TOKEN_TTL_SEC);
  });

  it('RUN_TOKEN_TTL_SEC 可覆盖有效期', () => {
    process.env.RUN_TOKEN_TTL_SEC = '600';
    const issued = issueRunToken({ runId: 'r', env: 'dev', moduleKey: 'admin' });
    const v = verifyRunToken(issued!.token);
    expect(v.ok && v.claims.exp - v.claims.iat).toBe(600);
  });

  it('非 run 令牌（静态 key）→ not-run-token，调用方据此回落静态比对', () => {
    const r = verifyRunToken('static-internal-key');
    expect(r).toEqual({ ok: false, reason: 'not-run-token' });
    expect(looksLikeRunToken('static-internal-key')).toBe(false);
    expect(looksLikeRunToken(`${RUN_TOKEN_PREFIX}xxxx`)).toBe(true);
  });

  it('签名被篡改 → bad-signature（换密钥签的同形令牌也不认）', () => {
    const issued = issueRunToken({ runId: 'r', env: 'dev', moduleKey: 'admin' });
    const [h, p] = issued!.token.slice(RUN_TOKEN_PREFIX.length).split('.');
    const forged = `${RUN_TOKEN_PREFIX}${h}.${p}.${'A'.repeat(43)}`;
    expect(verifyRunToken(forged).ok).toBe(false);
    expect(verifyRunToken(forged)).toMatchObject({ reason: 'bad-signature' });

    // 用另一个密钥签的同形令牌：跨环境串用必须无效
    const now = Math.floor(Date.now() / 1000);
    const other = craft(
      { jti: 'x', runId: 'r', env: 'dev', moduleKey: 'admin', iat: now, exp: now + 60 },
      { secret: 'another-secret' },
    );
    expect(verifyRunToken(other)).toMatchObject({ ok: false, reason: 'bad-signature' });
  });

  it('过期 → expired（脚本跑超时后不该还能切指针）', () => {
    const now = Math.floor(Date.now() / 1000);
    const t = craft({ jti: 'j-exp', runId: 'r', env: 'prod', moduleKey: 'portal', iat: now - 7200, exp: now - 60 });
    expect(verifyRunToken(t)).toMatchObject({ ok: false, reason: 'expired' });
    expect(describeVerifyFailure('expired')).toMatch(/过期/);
  });

  it('撤销 → revoked，且撤销幂等', () => {
    const issued = issueRunToken({ runId: 'r', env: 'prod', moduleKey: 'portal' });
    expect(verifyRunToken(issued!.token).ok).toBe(true);
    revokeRunToken(issued!.jti);
    expect(verifyRunToken(issued!.token)).toMatchObject({ ok: false, reason: 'revoked' });
    revokeRunToken(issued!.jti); // 幂等
    revokeRunToken(''); // 空 jti 不炸
    expect(verifyRunToken(issued!.token)).toMatchObject({ ok: false, reason: 'revoked' });
  });

  it('批量撤销：一次 run 签的多枚令牌一起失效（编排模式每动作一枚）', () => {
    const a = issueRunToken({ runId: 'r', env: 'prod', moduleKey: 'portal' });
    const b = issueRunToken({ runId: 'r', env: 'prod', moduleKey: 'portal' });
    expect(a!.jti).not.toBe(b!.jti); // jti 必须唯一，否则撤销会误伤
    revokeRunTokens([a!.jti, b!.jti]);
    expect(verifyRunToken(a!.token)).toMatchObject({ ok: false, reason: 'revoked' });
    expect(verifyRunToken(b!.token)).toMatchObject({ ok: false, reason: 'revoked' });
  });

  it('载荷缺 jti/runId → malformed（不接受"半个身份"的令牌）', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(
      verifyRunToken(craft({ runId: 'r', iat: now, exp: now + 60 })),
    ).toMatchObject({ ok: false, reason: 'malformed' });
    expect(
      verifyRunToken(craft({ jti: 'j', iat: now, exp: now + 60 })),
    ).toMatchObject({ ok: false, reason: 'malformed' });
  });

  it('畸形输入（空/缺段/非 base64）→ 对应 reason 且不抛异常', () => {
    expect(verifyRunToken('')).toMatchObject({ reason: 'not-run-token' });
    expect(verifyRunToken(`${RUN_TOKEN_PREFIX}abc`)).toMatchObject({ reason: 'malformed' });
    expect(verifyRunToken(`${RUN_TOKEN_PREFIX}a.b.c`)).toMatchObject({ reason: 'malformed' });
    expect(() => verifyRunToken(`${RUN_TOKEN_PREFIX}!!!.!!!.!!!`)).not.toThrow();
  });

  it('失败文案不泄露令牌内容', () => {
    const issued = issueRunToken({ runId: 'r', env: 'prod', moduleKey: 'portal' });
    revokeRunToken(issued!.jti);
    const r = verifyRunToken(issued!.token);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const msg = describeVerifyFailure(r.reason);
    expect(msg).not.toContain(issued!.token);
    expect(msg).not.toContain(SECRET);
  });
});
